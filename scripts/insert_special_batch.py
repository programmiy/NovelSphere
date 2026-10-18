#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LANOVEL Special Batch Inserter
어시스턴트가 대화창에서 직접 번역한 JSON 배열 결과를 읽어
special_batch_queue 테이블에 격리 적재하고 상태를 갱신하는 스크립트.
"""

import sys
import os
import json
import time

# 운영 DB에 특별 적재 쓰기 권한 부여
os.environ["ALLOW_PROD_DB_WRITE"] = "1"

# Windows 콘솔 인코딩 대응
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from server.database import SessionLocal
from server.models import SpecialBatchQueue

STAGING_DIR = os.path.join(APP_ROOT, 'scripts', 'special_staging')
STATE_FILE = os.path.join(STAGING_DIR, 'staging_state.json')
PENDING_FILE = os.path.join(STAGING_DIR, 'pending_batch.json')
DEFAULT_TRANSLATED_FILE = os.path.join(STAGING_DIR, 'translated_batch.json')


def clean_translation_text(text: str) -> str:
    if not text:
        return ""
    text = text.strip()
    # 양끝 따옴표 과잉 보정 등
    return text


def insert_batch(translated_data: list, pending_info: dict) -> int:
    db = SessionLocal()
    inserted_count = 0
    now = int(time.time())

    batch_id = pending_info["batch_id"]
    url = pending_info["chapter_url"]
    folder_name = pending_info["folder_name"]
    chapter_title = pending_info["chapter_title"]
    chapter_index = pending_info["chapter_index"]

    orig_map = {it["id"]: it["text"] for it in pending_info.get("items", [])}
    trans_map = {}

    for t in translated_data:
        tid = str(t.get("id"))
        ttext = t.get("translated") or t.get("text") or ""
        trans_map[tid] = clean_translation_text(ttext)

    try:
        for it in pending_info.get("items", []):
            pid = it["id"]
            orig = it["text"]
            trans = trans_map.get(pid, "")

            if not trans:
                print(f"⚠️ 경고: 문단 {pid}의 번역문이 비어 있습니다. 원문으로 폴백하지 않고 스킵합니다.")
                continue

            q_item = SpecialBatchQueue(
                batch_id=batch_id,
                url=url,
                folder_name=folder_name,
                chapter_title=chapter_title,
                chapter_index=chapter_index,
                pid=pid,
                original_text=orig,
                translated_text=trans,
                status="staged",
                created_at=now,
                promoted_at=None
            )
            db.add(q_item)
            inserted_count += 1

        db.commit()

        # 히스토리 아카이브 저장
        history_path = os.path.join(STAGING_DIR, f"history_{batch_id}.json")
        archive_payload = {
            "metadata": pending_info,
            "translations": translated_data,
            "inserted_count": inserted_count,
            "created_at": now
        }
        with open(history_path, 'w', encoding='utf-8') as f:
            json.dump(archive_payload, f, ensure_ascii=False, indent=2)

        # 상태 갱신: 오프셋 전진 또는 회차 완결 처리
        if os.path.exists(STATE_FILE):
            with open(STATE_FILE, 'r', encoding='utf-8') as f:
                state = json.load(f)
            
            if pending_info.get("is_chapter_finished", False):
                # 해당 회차가 끝났으면 다음 회차를 위해 초기화
                state["current_chapter_url"] = None
                state["current_offset"] = 0
            else:
                state["current_offset"] = pending_info.get("next_offset", 0)
            
            state["last_completed_batch_id"] = batch_id
            state.pop("pending_batch_id", None)

            with open(STATE_FILE, 'w', encoding='utf-8') as f:
                json.dump(state, f, ensure_ascii=False, indent=2)

        # pending_batch.json 정리
        if os.path.exists(PENDING_FILE):
            os.remove(PENDING_FILE)

        return inserted_count

    except Exception as e:
        db.rollback()
        raise e
    finally:
        db.close()


if __name__ == '__main__':
    translated_source = sys.argv[1] if len(sys.argv) > 1 else DEFAULT_TRANSLATED_FILE

    if not os.path.exists(PENDING_FILE):
        print("❌ 현재 대기 중인 pending_batch.json 파일이 없습니다. 먼저 fetch_special_batch.py를 실행하세요.")
        sys.exit(1)

    with open(PENDING_FILE, 'r', encoding='utf-8') as f:
        pending_info = json.load(f)

    if not os.path.exists(translated_source):
        print(f"❌ 번역 결과 파일이 없습니다: {translated_source}")
        sys.exit(1)

    with open(translated_source, 'r', encoding='utf-8') as f:
        translated_data = json.load(f)

    cnt = insert_batch(translated_data, pending_info)
    print("=" * 65)
    print(f"✅ [특별 적재 완료] {cnt}건의 문단이 special_batch_queue에 성공적으로 격리 적재되었습니다!")
    print(f" * 소설    : {pending_info['novel_title']}")
    print(f" * 회차    : 제 {pending_info['chapter_index']}화 - {pending_info['chapter_title']}")
    print(f" * 배치 ID : {pending_info['batch_id']}")
    print(f" * 상태    : staged (전용 검수 페이지 /special_batch 에서 확인 가능)")
    print("=" * 65)

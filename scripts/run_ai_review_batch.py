#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LANOVEL AI Review Batch Processor
대규모 코퍼스(45만+ 문장) 중 이상/오염 번역을 검출하여
최신 Gemini 모델(gemini-3.8-flash)로 재번역한 뒤
AI Review Studio(ai_review_queue)에 실시간 적재하는 배치 러너 스크립트.
"""

import sys
import os
import time
import json
import argparse

# Windows 콘솔 인코딩 대응
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
        sys.stderr.reconfigure(encoding='utf-8')
    except Exception:
        pass

# 프로젝트 루트 경로 추가
APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from server.database import SessionLocal
from server.models import AiReviewQueue
from server.services.abnormal_service import get_abnormal_translations_data
from server.routers.ai_review import clean_ai_translation
from server.services.translation_engine import call_gemini_api
from server.settings import settings


def parse_args():
    parser = argparse.ArgumentParser(description="LANOVEL AI Review 검수 큐 배치 번역기")
    parser.add_argument("--model", type=str, default=getattr(settings, "gemini_retranslation_model", "gemini-3.8-flash") or "gemini-3.8-flash",
                        help="사용할 Gemini 모델명 (기본값: gemini-3.8-flash)")
    parser.add_argument("--batch-size", type=int, default=20,
                        help="1회 API 호출당 묶을 문장 수 (기본값: 20)")
    parser.add_argument("--limit", type=int, default=0,
                        help="처리할 최대 문장 수 (0이면 전체 처리)")
    parser.add_argument("--folder", type=str, default="",
                        help="특정 소설(폴더명)만 지정하여 처리 (기본값: 전체 소설)")
    parser.add_argument("--delay", type=float, default=2.0,
                        help="배치 간 안전 딜레이 초 (기본값: 2.0초)")
    parser.add_argument("--dry-run", action="store_true",
                        help="실제 API 호출 없이 대상 문장 목록만 집계")
    return parser.parse_args()


def main():
    args = parse_args()
    print("=" * 65)
    print("🚀 [LANOVEL AI Review Batch Processor]")
    print(f" * 대상 모델       : {args.model}")
    print(f" * 배치 크기       : {args.batch_size}문장/호출")
    print(f" * 필터 폴더       : {args.folder if args.folder else '전체 소설'}")
    print(f" * 최대 처리 제한  : {f'{args.limit}건' if args.limit > 0 else '제한 없음 (전체)'}")
    print(f" * 호출 간 딜레이  : {args.delay}초")
    print(f" * Dry Run 모드    : {'예 (호출 안 함)' if args.dry_run else '아니오 (실제 실행)'}")
    print("=" * 65)

    if not settings.gemini_api_key and not args.dry_run:
        print("❌ [오류] GEMINI_API_KEY가 설정되어 있지 않습니다. .env 파일을 확인해 주세요.")
        sys.exit(1)

    db = SessionLocal()
    try:
        print("\n🔍 1. DB에서 이상/오염 번역 전수 수집 중... (약 5~15초 소요)")
        start_scan = time.time()
        abnormal_data = get_abnormal_translations_data(None, db)
        scan_time = time.time() - start_scan
        print(f"   -> 수집 완료 ({scan_time:.2f}초 소요)")

        # 기존 큐에 이미 등록된 translation_id 목록 조회
        queued_ids = {row[0] for row in db.query(AiReviewQueue.translation_id).all()}
        print(f"   -> 현재 ai_review_queue에 이미 등록된 문장 수: {len(queued_ids)}건")

        raw_items = []
        folder_summary = {}

        for folder_name, groups in abnormal_data.items():
            if folder_name.startswith('_'):
                continue
            if args.folder and folder_name != args.folder:
                continue

            for group in groups:
                for item in group.get('items', []):
                    item_id = item.get('id')
                    if item_id and item_id not in queued_ids:
                        raw_items.append(item)
                        folder_summary[folder_name] = folder_summary.get(folder_name, 0) + 1

        total_available = len(raw_items)
        print(f"\n📊 2. 신규 적재 대상 이상 번역: 총 {total_available}건")

        if folder_summary:
            print("   [소설별 대상 건수 상위]")
            for f_name, count in sorted(folder_summary.items(), key=lambda x: x[1], reverse=True)[:8]:
                print(f"    - {f_name}: {count}건")

        if total_available == 0:
            print("\n✨ 모든 이상 번역이 이미 검수 큐에 등록되어 있거나 처리할 대상이 없습니다.")
            return

        if args.limit > 0:
            target_items = raw_items[:args.limit]
            print(f"\n⚠️  --limit 적용: 총 {total_available}건 중 {len(target_items)}건만 처리합니다.")
        else:
            target_items = raw_items

        total_batches = (len(target_items) + args.batch_size - 1) // args.batch_size
        print(f"\n📦 3. 배치 계획: 총 {len(target_items)}건 -> {total_batches}개 배치 (배치당 {args.batch_size}건)")

        if args.dry_run:
            print("\n💡 Dry Run 완료. 실제 API 호출을 진행하려면 --dry-run 옵션을 제외하고 실행하세요.")
            return

        api_url = f"https://generativelanguage.googleapis.com/v1beta/models/{args.model}:generateContent?key={settings.gemini_api_key}"

        print(f"\n🔥 4. {args.model} 일괄 재번역 및 검수 큐 적재 시작!")
        print("-" * 65)

        processed_count = 0
        success_batches = 0
        failed_batches = 0
        overall_start = time.time()

        for b_idx in range(total_batches):
            batch_start_time = time.time()
            batch = target_items[b_idx * args.batch_size : (b_idx + 1) * args.batch_size]
            b_num = b_idx + 1

            originals = [it.get('original') or '' for it in batch]
            originals_json = json.dumps(originals, ensure_ascii=False)

            prompt = f"""다음 일본어 소설 문장들을 한국어로 번역해줘. 의역을 최소화하고 원문의 형태, 문체, 어조(뉘앙스)를 최대한 원형 그대로 살려서(직역에 가깝게) 번역해줘. 고유명사도 원문의 발음을 최대한 유지해야 해.
특히 원문에 작은 히라가나(ぁ, ぃ, ぅ, ぇ, ぉ, っ 등)가 쓰여 발음을 길게 늘이거나 강조하는 뉘앙스가 있다면, 한국어 번역에서도 모음을 연장해서(예: '말이야' -> '말이야아') 그 느낌을 정확히 반영해줘.
결과는 반드시 입력된 원문 배열과 동일한 길이의 JSON 배열(Array of strings) 형식으로만 출력해줘. 백틱이나 마크다운 없이 순수 JSON 배열만 출력해.

원문 목록:
{originals_json}
"""
            new_texts = []
            call_err = None

            try:
                res = call_gemini_api(api_url, prompt)
                if res and "candidates" in res and res["candidates"]:
                    parts = res["candidates"][0].get("content", {}).get("parts", [])
                    if parts:
                        raw_text = parts[0].get("text", "").strip()
                        if raw_text.startswith("```json"): raw_text = raw_text[7:]
                        elif raw_text.startswith("```"): raw_text = raw_text[3:]
                        if raw_text.endswith("```"): raw_text = raw_text[:-3]

                        try:
                            new_texts = json.loads(raw_text.strip())
                        except json.JSONDecodeError:
                            call_err = "JSON 파싱 실패"
            except Exception as e:
                call_err = str(e)

            # 결과 처리 및 큐 DB 삽입
            batch_now = int(time.time())
            for idx, item in enumerate(batch):
                trans_text = ""
                if isinstance(new_texts, list) and idx < len(new_texts):
                    trans_text = clean_ai_translation(new_texts[idx])

                if not trans_text:
                    if call_err:
                        trans_text = clean_ai_translation(item.get('translated') or '') + f" [AI 재번역 실패: {call_err[:40]}]"
                    else:
                        trans_text = clean_ai_translation(item.get('translated') or '') + " [AI 재번역 파싱 실패]"
                else:
                    trans_text = clean_ai_translation(trans_text)

                new_queue = AiReviewQueue(
                    translation_id=item['id'],
                    original_text=item.get('original') or '',
                    old_translated_text=clean_ai_translation(item.get('translated') or ''),
                    ai_translated_text=trans_text.strip(),
                    status='pending_review',
                    model_used=args.model,
                    created_at=batch_now,
                    updated_at=batch_now
                )
                db.add(new_queue)

            db.commit()

            batch_elapsed = time.time() - batch_start_time
            processed_count += len(batch)

            if call_err:
                failed_batches += 1
                status_icon = "⚠️"
                extra_msg = f"({call_err[:30]})"
            else:
                success_batches += 1
                status_icon = "✅"
                extra_msg = ""

            progress_pct = (processed_count / len(target_items)) * 100
            total_elapsed = time.time() - overall_start
            avg_per_batch = total_elapsed / b_num
            remaining_batches = total_batches - b_num
            eta_seconds = int(remaining_batches * avg_per_batch)
            eta_str = f"{eta_seconds // 60}분 {eta_seconds % 60}초" if eta_seconds >= 60 else f"{eta_seconds}초"

            print(f"[{b_num:3d}/{total_batches}] {status_icon} {len(batch):2d}건 완료 ({batch_elapsed:.2f}s) {extra_msg} | 누적: {processed_count:4d}/{len(target_items)} ({progress_pct:5.1f}%) | 잔여 예상: {eta_str}")

            if b_num < total_batches and args.delay > 0:
                time.sleep(args.delay)

        total_time = time.time() - overall_start
        print("-" * 65)
        print("🎉 [배치 번역 및 큐 적재 완료!]")
        print(f" * 총 적재 문장 수 : {processed_count}건")
        print(f" * 성공 배치      : {success_batches}개 / 실패: {failed_batches}개")
        print(f" * 총 소요 시간    : {int(total_time // 60)}분 {int(total_time % 60)}초")
        print(" * 웹 UI 검수 주소 : http://localhost:8001/ai_review")
        print("=" * 65)

    finally:
        db.close()


if __name__ == "__main__":
    main()

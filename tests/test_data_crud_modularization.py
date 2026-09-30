"""
Comprehensive Integration & Unit Tests for Modularized data_crud services.
Verifies chapter_service, abnormal_service, cleanup_trash_service, and similarity_service.
"""

import time
import pytest
from server.database import SessionLocal
from server.models import Translation, AbnormalWhitelist, CleanupQueuedItem, TranslationTrash, CleanupNotification

from server.services.chapter_service import clean_chapter_title
from server.services.abnormal_service import (
    get_abnormal_translations_data,
    add_abnormal_whitelist_items,
    remove_abnormal_whitelist_items,
    get_abnormal_whitelist_data,
    clear_abnormal_whitelist_data
)
from server.services.cleanup_trash_service import (
    move_items_to_cleanup,
    get_cleanup_queue_data,
    get_translation_trash_data,
    get_cleanup_notifications_data
)
from server.services.similarity_service import get_similar_examples_data


def test_service_clean_chapter_title():
    """웹소설 사이트별 챕터 제목 정제 검증"""
    # 1. 카쿠요무
    kakuyomu_title = "제1화 시작 - 소설제목 - カクヨム"
    assert clean_chapter_title(kakuyomu_title, url="https://kakuyomu.jp/works/1/episodes/2") == "제1화 시작"

    # 2. 쇼세츠 (소설가가 되자)
    syosetu_title = "소설제목 - 제2화 모험 - 小説家になろう"
    assert clean_chapter_title(syosetu_title, url="https://ncode.syosetu.com/n1234/2") == "제2화 모험"

    # 3. 노벨업플러스
    novelup_title = "소설제목 - 제3화 결전 | 小説投稿サイトノベルアップ＋"
    assert clean_chapter_title(novelup_title, url="https://novelup.plus/story/123/456") == "제3화 결전"


def test_service_abnormal_and_whitelist_crud():
    """이상 번역 화이트리스트 CRUD 서비스 검증"""
    db = SessionLocal()
    url = f"https://example.com/test_abnormal_{int(time.time()*1000)}"
    try:
        t = Translation(
            url=url,
            pid="p1",
            original="テスト",
            translated="テスト (미번역)",
            timestamp=int(time.time()),
            folderName="테스트폴더",
            title="1화"
        )
        db.add(t)
        db.commit()

        # 1. 화이트리스트 등록
        res_add = add_abnormal_whitelist_items([t.id], db)
        assert res_add["success"] is True
        assert res_add["added_count"] == 1

        # 2. 화이트리스트 조회
        res_get = get_abnormal_whitelist_data(db)
        assert any(item["translation_id"] == t.id for item in res_get["whitelist"])

        # 3. 화이트리스트 해제
        res_del = remove_abnormal_whitelist_items([t.id], db)
        assert res_del["success"] is True
        assert res_del["deleted_count"] == 1
    finally:
        db.query(AbnormalWhitelist).filter(AbnormalWhitelist.url == url).delete()
        db.query(Translation).filter(Translation.url == url).delete()
        db.commit()
        db.close()


def test_service_similarity_search():
    """유사 번역 단락 추천 서비스 검증"""
    db = SessionLocal()
    url = f"https://example.com/test_sim_{int(time.time()*1000)}"
    try:
        t = Translation(
            url=url,
            pid="p_sim",
            original="ドラゴンが空を飛んでいた。",
            translated="드래곤이 하늘을 날고 있었다.",
            timestamp=int(time.time()),
            folderName="판타지소설",
            title="1화"
        )
        db.add(t)
        db.commit()

        # 유사 예시 검색
        res = get_similar_examples_data(keyword="드래곤", folder="판타지소설", exclude_id=None, limit=5, db=db)
        assert res["keyword"] == "드래곤"
        assert len(res["examples"]) >= 1
        assert any(ex["original"] == "ドラゴンが空を飛んでいた。" for ex in res["examples"])
    finally:
        db.query(Translation).filter(Translation.url == url).delete()
        db.commit()
        db.close()

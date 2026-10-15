"""
Unit & Integration tests for SQLite FTS5 Trigram Hybrid Routing and Search Optimization.
Verifies:
1. 1~2 character query defense (LIKE fallback prevents empty results).
2. 3+ character query ultra-fast Trigram FTS5 lookup.
3. Column-specific filtering (original vs translated).
4. Folder filtering and exclude_id handling.
5. Error resilience and automatic LIKE fallback.
6. count_translation_occurrences correctness.
7. similarity_service and dictionary_service end-to-end integration.
"""

import time
import pytest
import sqlite3
from datetime import datetime
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from server.models import Base, Translation
from server.services.search_helper import (
    search_translation_ids,
    count_translation_occurrences,
)
from server.services.similarity_service import (
    get_top5_expressions,
    get_similar_examples_data,
)
from server.services.dictionary_service import (
    search_dictionary_corpus,
    get_sentence_word_breakdown,
)
from server.services.corpus_ai_service import synthesize_translation


@pytest.fixture
def fts_test_db():
    """Sets up an in-memory SQLite database configured with Trigram FTS5 and test records."""
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    with engine.begin() as conn:
        conn.exec_driver_sql("""
            CREATE VIRTUAL TABLE translations_fts USING fts5(
                original,
                translated,
                content='translations',
                content_rowid='id',
                tokenize='trigram'
            );
        """)
        conn.exec_driver_sql("""
            CREATE TRIGGER translations_ai AFTER INSERT ON translations BEGIN
                INSERT INTO translations_fts(rowid, original, translated) VALUES (new.id, new.original, new.translated);
            END;
        """)

    now = datetime.now()
    records = [
        Translation(
            url="http://test/1", pid="p1",
            original="勇者の魔力が暴走した。",
            translated="용사의 마력이 폭주했다.",
            folderName="판타지A", title="1화", timestamp=now
        ),
        Translation(
            url="http://test/2", pid="p2",
            original="大魔導士のエルフが微笑んだ。",
            translated="대마도사인 엘프가 미소지었다.",
            folderName="판타지A", title="2화", timestamp=now
        ),
        Translation(
            url="http://test/3", pid="p3",
            original="スライムを倒して経験値を得た。",
            translated="슬라임을 쓰러뜨리고 경험치를 얻었다.",
            folderName="이세계B", title="1화", timestamp=now
        ),
        Translation(
            url="http://test/4", pid="p4",
            original="魔王軍の幹部が現れた。",
            translated="마왕군의 간부가 나타났다.",
            folderName="이세계B", title="2화", timestamp=now
        ),
    ]
    session.add_all(records)
    session.commit()

    # Rebuild FTS
    with engine.begin() as conn:
        conn.exec_driver_sql("INSERT INTO translations_fts(translations_fts) VALUES('rebuild');")

    yield session
    session.close()


def test_short_query_hybrid_routing(fts_test_db):
    """
    1~2글자 검색어(예: '魔力', '용사')가 Trigram 토큰 부재에도 불구하고
    LIKE 폴백을 통해 정상 검색되는지 검증 (결과 0건 방어).
    """
    # 2글자 일본어 한자
    ids_2ja = search_translation_ids(fts_test_db, query="魔力", limit=10)
    assert len(ids_2ja) == 1
    t = fts_test_db.query(Translation).filter(Translation.id == ids_2ja[0]).first()
    assert "魔力" in t.original

    # 2글자 한국어 단어
    ids_2ko = search_translation_ids(fts_test_db, query="용사", limit=10)
    assert len(ids_2ko) == 1
    t = fts_test_db.query(Translation).filter(Translation.id == ids_2ko[0]).first()
    assert "용사" in t.translated

    # 1글자 단어
    ids_1char = search_translation_ids(fts_test_db, query="魔", limit=10)
    assert len(ids_1char) >= 2


def test_trigram_fts_query(fts_test_db):
    """
    3글자 이상 검색어('エルフ', '슬라임')가 FTS5 Trigram MATCH를 타고
    정확하고 빠르게 반환되는지 검증.
    """
    t0 = time.time()
    ids_elf = search_translation_ids(fts_test_db, query="エルフ", limit=10)
    elapsed_ms = (time.time() - t0) * 1000

    assert len(ids_elf) == 1
    assert elapsed_ms < 20.0  # Must be fast
    t = fts_test_db.query(Translation).filter(Translation.id == ids_elf[0]).first()
    assert "エルフ" in t.original

    # 3글자 한국어
    ids_slime = search_translation_ids(fts_test_db, query="슬라임", limit=10)
    assert len(ids_slime) == 1
    t2 = fts_test_db.query(Translation).filter(Translation.id == ids_slime[0]).first()
    assert "슬라임" in t2.translated


def test_column_filtering(fts_test_db):
    """특정 컬럼(original 또는 translated) 전용 검색 검증."""
    # '엘프'는 translated에만 존재
    ids_orig = search_translation_ids(fts_test_db, query="엘프", column="original")
    assert len(ids_orig) == 0

    ids_trans = search_translation_ids(fts_test_db, query="엘프", column="translated")
    assert len(ids_trans) == 1


def test_folder_and_exclude_id(fts_test_db):
    """폴더 필터 및 특정 ID 제외 필터 연동 검증."""
    # '魔' 검색 시 판타지A에 2개, 이세계B에 1개
    ids_folder_a = search_translation_ids(fts_test_db, query="魔", folder="판타지A")
    for tid in ids_folder_a:
        t = fts_test_db.query(Translation).filter(Translation.id == tid).first()
        assert t.folderName == "판타지A"

    # exclude_id 테스트
    all_ids = search_translation_ids(fts_test_db, query="魔")
    if all_ids:
        exclude_target = all_ids[0]
        filtered_ids = search_translation_ids(fts_test_db, query="魔", exclude_id=exclude_target)
        assert exclude_target not in filtered_ids


def test_error_resilience_fallback_without_fts():
    """FTS 가상 테이블이 아예 없는 순수 DB에서도 LIKE로 자동 폴백되는 내결함성 검증."""
    raw_conn = sqlite3.connect(":memory:")
    raw_conn.execute("CREATE TABLE translations (id INTEGER PRIMARY KEY, original TEXT, translated TEXT, folderName TEXT)")
    raw_conn.execute("INSERT INTO translations VALUES (1, 'テストです', '테스트입니다', 'folder1')")

    # translations_fts가 없는 상태에서 3글자 검색 요청
    matched = search_translation_ids(raw_conn, query="テスト", limit=10)
    assert matched == [1]

    # count_translation_occurrences 폴백
    tot, nov = count_translation_occurrences(raw_conn, query="テスト")
    assert tot == 1
    assert nov == 1
    raw_conn.close()


def test_count_translation_occurrences(fts_test_db):
    """총 등장 횟수 및 관련 소설 수(novel_count) 집계 정확도 검증."""
    # 2글자 쿼리 ('마력')
    tot2, nov2 = count_translation_occurrences(fts_test_db, query="마력")
    assert tot2 == 1
    assert nov2 == 1

    # 3글자 쿼리 ('エルフ')
    tot3, nov3 = count_translation_occurrences(fts_test_db, query="エルフ")
    assert tot3 == 1
    assert nov3 == 1


def test_similarity_service_integration(fts_test_db):
    """similarity_service의 get_top5_expressions 및 get_similar_examples_data 통합 검증."""
    top5 = get_top5_expressions(keyword="魔力", folder="판타지A", db=fts_test_db)
    assert isinstance(top5, list)
    if top5:
        assert any(item["word"] in ("용사", "마력", "폭주") for item in top5)

    data = get_similar_examples_data(
        keyword="エルフ",
        folder="판타지A",
        exclude_id=None,
        limit=5,
        db=fts_test_db,
        include_top5=True
    )
    assert data["keyword"] == "エルフ"
    assert len(data["examples"]) >= 1
    assert "エルフ" in data["examples"][0]["original"]


def test_dictionary_service_integration(fts_test_db):
    """dictionary_service의 search_dictionary_corpus 및 word breakdown 통합 검증."""
    res = search_dictionary_corpus(keyword="エルフ", folder="판타지A", db=fts_test_db)
    assert res["keyword"] == "エルフ"
    assert res["total_occurrences"] >= 1
    assert len(res["examples"]) >= 1

    # 단어 분해 시 search_translation_ids 연동 검증
    tokens = get_sentence_word_breakdown("エルフが微笑んだ。", folder="판타지A", db=fts_test_db)
    assert len(tokens) > 0


def test_corpus_ai_tier1_fts_synthesis():
    """corpus_ai_service의 Tier 1 Trigram FTS5 템플릿 검색 동작 검증."""
    res = synthesize_translation("「くっ……殺せ！」")
    assert res["tier_used"] in ("tier1_exact", "tier1_template")
    assert res["confidence"] >= 75.0

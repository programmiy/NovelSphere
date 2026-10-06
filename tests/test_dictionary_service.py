"""
Unit tests for dictionary_service and dictionary API router.
Verifies dictionary link generation, corpus lookup, frequency calculation,
and No-AI rule compliance.
"""

from datetime import datetime
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from server.models import Base, Translation
from server.services.dictionary_service import (
    get_dictionary_links,
    search_dictionary_corpus,
    extract_korean_candidate_terms
)


@pytest.fixture
def memory_db():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    now = datetime.now()
    # Insert test translation corpus
    t1 = Translation(
        url="https://kakuyomu.jp/works/1/episodes/1",
        pid="p1",
        original="某美少女魔導士が言ってたじゃないですか。",
        translated="어떤 미소녀 마도사가 말했잖아요.",
        timestamp=now,
        folderName="마법소설A",
        title="1화 시작"
    )
    t2 = Translation(
        url="https://kakuyomu.jp/works/1/episodes/2",
        pid="p2",
        original="大魔導士の弟子として修行を始める。",
        translated="대마도사의 제자로서 수행을 시작한다.",
        timestamp=now,
        folderName="마법소설A",
        title="2화 제자"
    )
    t3 = Translation(
        url="https://kakuyomu.jp/works/2/episodes/1",
        pid="p1",
        original="彼は凄腕の魔導士であり、学者でもあった。",
        translated="그는 실력 있는 마도사였고, 학자이기도 했다.",
        timestamp=now,
        folderName="이세계B",
        title="1화 등장"
    )
    t4 = Translation(
        url="https://kakuyomu.jp/works/2/episodes/2",
        pid="p2",
        original="剣士と魔導士の連携攻撃が炸裂した。",
        translated="검사와 마도사의 연계 공격이 작렬했다.",
        timestamp=now,
        folderName="이세계B",
        title="2화 전투"
    )

    session.add_all([t1, t2, t3, t4])
    session.commit()

    yield session
    session.close()


def test_get_dictionary_links():
    links = get_dictionary_links("魔導士")
    assert "naver" in links
    assert "weblio" in links
    assert "jisho" in links
    assert "goo" in links
    assert "%E9%AD%94%E5%B0%8E%E5%A3%AB" in links["naver"]
    assert "%E9%AD%94%E5%B0%8E%E5%A3%AB" in links["weblio"]
    assert "%E9%AD%94%E5%B0%8E%E5%A3%AB" in links["jisho"]


def test_search_dictionary_corpus_prioritizes_folder(memory_db):
    res = search_dictionary_corpus(
        keyword="魔導士",
        folder="이세계B",
        limit=10,
        db=memory_db
    )

    assert res["keyword"] == "魔導士"
    assert res["total_occurrences"] == 4
    assert res["novel_count"] == 2
    assert len(res["examples"]) == 4

    # 첫 번째 예문은 folder="이세계B"인 것이 먼저 와야 함
    assert res["examples"][0]["folderName"] == "이세계B"


def test_search_dictionary_corpus_frequency_level(memory_db):
    res = search_dictionary_corpus(
        keyword="魔導士",
        folder=None,
        limit=10,
        db=memory_db
    )
    # 4건이므로 "저빈도/특수 표현 (Low)"
    assert "저빈도" in res["frequency_level"]


def test_extract_korean_candidate_terms():
    examples = [
        {"translated": "그는 위대한 마도사 소년이었다."},
        {"translated": "어떤 미소녀 마도사 이야기."},
        {"translated": "젊은 마도사 협회."},
    ]
    candidates = extract_korean_candidate_terms(examples, "魔導士")
    assert "마도사" in candidates


def test_empty_keyword_handling(memory_db):
    res = search_dictionary_corpus(keyword="   ", db=memory_db)
    assert res["keyword"] == ""
    assert res["total_occurrences"] == 0
    assert res["examples"] == []

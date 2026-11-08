import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from server.models import Base, Translation
from server.services import hdtrans_service


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:", connect_args={"check_same_thread": False})
    Base.metadata.create_all(bind=engine)
    SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)
    session = SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_is_hdtrans_available():
    # 실제 다운로드된 바이너리가 tools/hdtrans/hdtrans.exe에 있으므로 True여야 함
    assert hdtrans_service.is_hdtrans_available() is True


def test_translate_paragraphs_real():
    # 실제 로컬 hdtrans 엔진으로 2개 문단 번역 테스트
    sample_ja = [
        "こんにちは、世界！",
        "私は冒険者です。\n魔王を倒します。",
        "",
    ]
    results = hdtrans_service.translate_paragraphs(sample_ja)
    assert len(results) == 3
    assert len(results[0]) > 0
    assert len(results[1]) > 0
    assert results[2] == ""
    # 개행 보존 확인
    assert "\n" in results[1]


import time

def test_translate_episode_in_db(db_session):
    # 인메모리 격리 DB에 샘플 데이터 적재
    now_ts = int(time.time())
    db_session.add(Translation(
        url="https://novel.test/1",
        title="1화 테스트",
        pid=1,
        original="こんにちは。",
        translated="",
        folderName="테스트_초벌소설",
        toc_sort_order=1,
        timestamp=now_ts,
    ))
    db_session.add(Translation(
        url="https://novel.test/1",
        title="1화 테스트",
        pid=2,
        original="さようなら。",
        translated="이미 번역됨",
        folderName="테스트_초벌소설",
        toc_sort_order=1,
        timestamp=now_ts,
    ))
    db_session.commit()

    # 1. overwrite=False (빈칸만 번역)
    count = hdtrans_service.translate_episode_in_db(
        db=db_session,
        folder_name="테스트_초벌소설",
        url="https://novel.test/1",
        overwrite=False,
    )
    assert count == 1  # 1개만 번역되어야 함

    rows = db_session.query(Translation).filter_by(folderName="테스트_초벌소설").all()
    assert rows[0].translated != ""
    assert rows[1].translated == "이미 번역됨"  # 유지

    # 2. overwrite=True (강제 덮어쓰기)
    count2 = hdtrans_service.translate_episode_in_db(
        db=db_session,
        folder_name="테스트_초벌소설",
        url="https://novel.test/1",
        overwrite=True,
    )
    assert count2 == 2

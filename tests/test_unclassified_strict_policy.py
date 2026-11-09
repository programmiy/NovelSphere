import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from server.models import Base, Translation, ManualTranslationNovel
from server.routers.data_crud import upsert_translations, TranslationItem

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

def test_normal_translations_always_saved_as_unclassified(db_session):
    # 1. Normal novel: Even if folderName is provided, new records must be saved with folderName=None
    items = [
        TranslationItem(
            url="https://ncode.syosetu.com/n1234ab/1/",
            pid="p1",
            original="テスト文章1",
            translated="테스트 문장 1",
            timestamp=1700000000,
            folderName="임의의 일본어 소설 제목",
            title="1화"
        ),
        TranslationItem(
            url="https://ncode.syosetu.com/n1234ab/1/",
            pid="p2",
            original="テスト文章2",
            translated="테스트 문장 2",
            timestamp=1700000001,
            folderName=None,
            title="1화"
        )
    ]
    upsert_translations(items, db=db_session)

    rows = db_session.query(Translation).filter(Translation.url == "https://ncode.syosetu.com/n1234ab/1/").all()
    assert len(rows) == 2
    for r in rows:
        assert r.folderName is None, f"Expected folderName to be None, got: {r.folderName}"

def test_existing_folder_never_inherited_by_normal_novel(db_session):
    # 2. Existing URL with folderName: When a new paragraph is translated, it must NOT inherit existing folderName
    existing = Translation(
        url="https://ncode.syosetu.com/n5678cd/1/",
        pid="p1",
        original="旧文章",
        translated="기존 문장",
        timestamp=1700000000,
        folderName="기존 서재 폴더명",
        title="1화"
    )
    db_session.add(existing)
    db_session.commit()

    new_items = [
        TranslationItem(
            url="https://ncode.syosetu.com/n5678cd/1/",
            pid="p2",
            original="新文章",
            translated="새로운 문장",
            timestamp=1700000010,
            folderName=None,
            title="1화"
        )
    ]
    upsert_translations(new_items, db=db_session)

    # Existing paragraph retains its folderName
    p1 = db_session.query(Translation).filter(Translation.url == "https://ncode.syosetu.com/n5678cd/1/", Translation.pid == "p1").first()
    assert p1.folderName == "기존 서재 폴더명"

    # New paragraph MUST be None (unclassified)
    p2 = db_session.query(Translation).filter(Translation.url == "https://ncode.syosetu.com/n5678cd/1/", Translation.pid == "p2").first()
    assert p2.folderName is None

def test_manual_translation_novel_keeps_folder_name(db_session):
    # 3. Manual / Censored novel: MUST keep its folderName
    manual_novel = ManualTranslationNovel(
        folderName="검열 회피 전용 소설 폴더",
        source_url="https://novel18.syosetu.com/n9999zz/",
        created_at=1700000000,
        is_completed=0
    )
    db_session.add(manual_novel)
    db_session.commit()

    items = [
        TranslationItem(
            url="https://novel18.syosetu.com/n9999zz/1/",
            pid="p1",
            original="原文です",
            translated="",
            timestamp=1700000050,
            folderName="검열 회피 전용 소설 폴더",
            title="1화"
        )
    ]
    upsert_translations(items, db=db_session)

    row = db_session.query(Translation).filter(Translation.url == "https://novel18.syosetu.com/n9999zz/1/").first()
    assert row is not None
    assert row.folderName == "검열 회피 전용 소설 폴더"

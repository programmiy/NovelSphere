import pytest
from fastapi.testclient import TestClient
import sqlite3
import os
from urllib.parse import urlparse
import time

# server.server에서 app을 import하기 전에 settings를 오버라이드해야 합니다.
@pytest.fixture(scope="module", autouse=True)
def override_settings(tmp_path_factory):
    test_db_path = tmp_path_factory.mktemp("data") / "test_data_crud.db"
    os.environ["DATABASE_URL"] = f"sqlite:///{test_db_path}"

    from server.settings import settings
    settings.database_url = f"sqlite:///{test_db_path}"

    conn = sqlite3.connect(test_db_path)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            url TEXT NOT NULL,
            pid TEXT,
            original TEXT NOT NULL,
            translated TEXT NOT NULL,
            timestamp INTEGER NOT NULL,
            folderName TEXT,
            title TEXT,
            toc_sort_order INTEGER,
            UNIQUE(url, pid)
        );
    """)
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS url_metadata (
            url TEXT PRIMARY KEY,
            sort_order INTEGER,
            first_accessed_at INTEGER
        );
    """)
    conn.commit()
    conn.close()

    yield
    
    del os.environ["DATABASE_URL"]
    
    from server.database import engine
    engine.dispose()

@pytest.fixture(scope="module")
def client_instance(override_settings):
    from server.server import app
    with TestClient(app) as client:
        yield client

def get_db_path_for_test():
    parsed_url = urlparse(os.environ["DATABASE_URL"])
    path = parsed_url.path
    if os.name == 'nt' and path.startswith('/'):
        path = path[1:]
    return path

@pytest.fixture
def setup_db_data():
    from server.database import SessionLocal, engine
    from server.models import Base, Translation, UrlMetadata
    
    # 모든 테이블을 삭제하고 다시 생성하여 깨끗한 상태로 시작
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)

    db = SessionLocal()
    
    # 테스트 데이터 삽입 (고정된 timestamp 사용)
    base_time = 1678886400 # 고정된 타임스탬프
    translations_data = [
        Translation(url="http://example.com/a", pid="p1", original="original A1", translated="translated A1", timestamp=base_time - 100, folderName="Folder1", title="TitleA"),
        Translation(url="http://example.com/a", pid="p2", original="original A2", translated="translated A2", timestamp=base_time - 90, folderName="Folder1", title="TitleA"),
        Translation(url="http://example.com/b", pid="p1", original="original B1", translated="translated B1", timestamp=base_time - 80, folderName="Folder2", title="TitleB"),
        Translation(url="http://example.com/c", pid="p1", original="original C1", translated="translated C1", timestamp=base_time - 70, folderName=None, title="TitleC"), # No folder
        Translation(url="http://example.com/d", pid="p1", original="search term", translated="result term", timestamp=base_time - 60, folderName="Folder3", title="TitleD"),
    ]
    db.add_all(translations_data)

    url_metadata_data = [
        UrlMetadata(url="http://example.com/a", sort_order=1, first_accessed_at=base_time - 100),
        UrlMetadata(url="http://example.com/b", sort_order=2, first_accessed_at=base_time - 80),
        UrlMetadata(url="http://example.com/c", sort_order=3, first_accessed_at=base_time - 70),
        UrlMetadata(url="http://example.com/d", sort_order=4, first_accessed_at=base_time - 60),
    ]
    db.add_all(url_metadata_data)

    db.commit()
    db.close()
    yield
    # 테스트 후 데이터 정리
    # 새로운 세션을 열어 drop_all과 create_all을 수행합니다.
    db_cleanup = SessionLocal()
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    db_cleanup.close()

# --- Test Cases for /translations ---
def test_get_translations_no_filter(client_instance, setup_db_data):
    response = client_instance.get("/translations")
    assert response.status_code == 200
    data = response.json()
    assert data["total_count"] == 5
    assert len(data["translations"]) == 5

def test_get_translations_filter_by_folder(client_instance, setup_db_data):
    response = client_instance.get("/translations?folder=Folder1")
    assert response.status_code == 200
    data = response.json()
    assert data["total_count"] == 2
    assert len(data["translations"]) == 2
    for t in data["translations"]:
        assert t["folderName"] == "Folder1"

    response = client_instance.get("/translations?folder=폴더 없음")
    assert response.status_code == 200
    data = response.json()
    assert data["total_count"] == 1
    assert len(data["translations"]) == 1
    assert data["translations"][0]["folderName"] is None

def test_get_translations_filter_by_search(client_instance, setup_db_data):
    response = client_instance.get("/translations?search=search")
    assert response.status_code == 200
    data = response.json()
    assert data["total_count"] == 1
    assert len(data["translations"]) == 1
    assert "search term" in data["translations"][0]["original"]

def test_get_translations_filter_by_url(client_instance, setup_db_data):
    response = client_instance.get("/translations?url=http://example.com/a")
    assert response.status_code == 200
    data = response.json()
    assert data["total_count"] == 2
    assert len(data["translations"]) == 2
    for t in data["translations"]:
        assert t["url"] == "http://example.com/a"

def test_get_translations_pagination(client_instance, setup_db_data):
    response = client_instance.get("/translations?skip=1&limit=2")
    assert response.status_code == 200
    data = response.json()
    assert data["total_count"] == 5
    assert len(data["translations"]) == 2
    # Check order (timestamp DESC)
    assert data["translations"][0]["original"] == "original C1"
    assert data["translations"][1]["original"] == "original B1"

# --- Test Cases for /translations/upsert ---
def test_upsert_translations_insert_new(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation, UrlMetadata

    new_item = {
        "url": "http://example.com/new",
        "pid": "p1",
        "original": "new original",
        "translated": "new translated",
        "timestamp": int(time.time()),
        "folderName": "NewFolder",
        "title": "New Title"
    }
    response = client_instance.post("/translations/upsert", json=[new_item])
    assert response.status_code == 200
    data = response.json()
    assert data["inserted"] == 1
    assert data["updated"] == 0

    # Verify in DB using SQLAlchemy session
    db = SessionLocal()
    assert db.query(Translation).filter_by(url="http://example.com/new").count() == 1
    assert db.query(UrlMetadata).filter_by(url="http://example.com/new").count() == 1
    db.close()

def test_upsert_translations_update_existing(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation

    existing_item = {
        "url": "http://example.com/a",
        "pid": "p1",
        "original": "original A1",
        "translated": "updated translated A1",
        "timestamp": int(time.time()),
        "folderName": "Folder1",
        "title": "Updated TitleA"
    }
    response = client_instance.post("/translations/upsert", json=[existing_item])
    assert response.status_code == 200
    data = response.json()
    assert data["inserted"] == 0
    assert data["updated"] == 1

    # Verify in DB using SQLAlchemy session
    db = SessionLocal()
    result = db.query(Translation).filter_by(url="http://example.com/a", pid="p1").first()
    assert result.translated == "updated translated A1"
    assert result.title == "Updated TitleA"
    db.close()

def test_upsert_translations_mixed_insert_update(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation, UrlMetadata

    mixed_items = [
        {
            "url": "http://example.com/a",
            "pid": "p1",
            "original": "original A1",
            "translated": "updated translated A1",
            "timestamp": int(time.time()),
            "folderName": "Folder1",
            "title": "Updated TitleA"
        },
        {
            "url": "http://example.com/new_mixed",
            "pid": "p1",
            "original": "new mixed original",
            "translated": "new mixed translated",
            "timestamp": int(time.time()),
            "folderName": "MixedFolder",
            "title": "Mixed Title"
        }
    ]
    response = client_instance.post("/translations/upsert", json=mixed_items)
    assert response.status_code == 200
    data = response.json()
    assert data["inserted"] == 1
    assert data["updated"] == 1

    # Verify in DB using SQLAlchemy session
    db = SessionLocal()
    result = db.query(Translation).filter_by(url="http://example.com/a", pid="p1").first()
    assert result.translated == "updated translated A1"
    assert db.query(Translation).filter_by(url="http://example.com/new_mixed").count() == 1
    db.close()

# --- Test Cases for /translations/move ---
def test_move_translations_to_existing_folder(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation

    # Get id from DB using SQLAlchemy
    db = SessionLocal()
    id_to_move = db.query(Translation.id).filter_by(url="http://example.com/a", pid="p1").scalar()
    db.close()

    move_request = {"ids": [id_to_move], "folder_name": "Folder2"}
    response = client_instance.put("/translations/move", json=move_request)
    assert response.status_code == 200
    assert "1개의 항목이 이동되었습니다." in response.json()["message"]

    # Verify in DB using SQLAlchemy
    db = SessionLocal()
    moved_item = db.query(Translation).filter_by(id=id_to_move).first()
    assert moved_item.folderName == "Folder2"
    db.close()

def test_move_translations_to_new_folder(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation

    db = SessionLocal()
    id_to_move = db.query(Translation.id).filter_by(url="http://example.com/a", pid="p1").scalar()
    db.close()

    move_request = {"ids": [id_to_move], "folder_name": "NewFolder"}
    response = client_instance.put("/translations/move", json=move_request)
    assert response.status_code == 200
    assert "1개의 항목이 이동되었습니다." in response.json()["message"]

    db = SessionLocal()
    moved_item = db.query(Translation).filter_by(id=id_to_move).first()
    assert moved_item.folderName == "NewFolder"
    db.close()

def test_move_translations_to_no_folder(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation

    db = SessionLocal()
    id_to_move = db.query(Translation.id).filter_by(url="http://example.com/a", pid="p1").scalar()
    db.close()

    move_request = {"ids": [id_to_move], "folder_name": None}
    response = client_instance.put("/translations/move", json=move_request)
    assert response.status_code == 200
    assert "1개의 항목이 이동되었습니다." in response.json()["message"]

    db = SessionLocal()
    moved_item = db.query(Translation).filter_by(id=id_to_move).first()
    assert moved_item.folderName is None
    db.close()

# --- Test Cases for /translations/delete ---
def test_delete_translations_single_item(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation

    db = SessionLocal()
    id_to_delete = db.query(Translation.id).filter_by(url="http://example.com/a", pid="p1").scalar()
    db.close()

    delete_request = {"ids": [id_to_delete]}
    response = client_instance.post("/translations/delete", json=delete_request)
    assert response.status_code == 200
    assert "1개의 항목이 삭제되었습니다." in response.json()["message"]

    db = SessionLocal()
    assert db.query(Translation).filter_by(id=id_to_delete).count() == 0
    db.close()

def test_delete_translations_multiple_items(client_instance, setup_db_data):
    from server.database import SessionLocal
    from server.models import Translation

    db = SessionLocal()
    ids_to_delete = [row.id for row in db.query(Translation.id).filter_by(url="http://example.com/a").all()]
    db.close()

    delete_request = {"ids": ids_to_delete}
    response = client_instance.post("/translations/delete", json=delete_request)
    assert response.status_code == 200
    assert f"{len(ids_to_delete)}개의 항목이 삭제되었습니다." in response.json()["message"]

    db = SessionLocal()
    for _id in ids_to_delete:
        assert db.query(Translation).filter_by(id=_id).count() == 0
    db.close()

def test_delete_translations_non_existent_item(client_instance, setup_db_data):
    delete_request = {"ids": [99999]} # Non-existent ID
    response = client_instance.post("/translations/delete", json=delete_request)
    assert response.status_code == 200
    assert "0개의 항목이 삭제되었습니다." in response.json()["message"]

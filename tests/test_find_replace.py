import pytest
from fastapi.testclient import TestClient
from server.server import app
from server.database import SessionLocal
from server.models import Translation

client = TestClient(app)
TEST_URL = "http://test-find-replace-suite.com/1"

@pytest.fixture
def sample_translations():
    db = SessionLocal()
    # 고유한 테스트용 URL 및 데이터 생성
    items = [
        Translation(url=TEST_URL, pid="p1", original="これはりんごです。", translated="이것은 사과입니다.", timestamp=1000, folderName="테스트폴더A"),
        Translation(url=TEST_URL, pid="p2", original="これは青いりんごです。", translated="이것은 푸른 사과입니다.", timestamp=1001, folderName="테스트폴더A"),
        Translation(url=TEST_URL, pid="p3", original="これはバナナです。", translated="이것은 바나나입니다.", timestamp=1002, folderName="테스트폴더B"),
        Translation(url=TEST_URL, pid="p4", original="Apple and apple", translated="Apple과 apple", timestamp=1003, folderName="테스트폴더A"),
    ]
    db.add_all(items)
    db.commit()
    yield items
    # 클린업
    db.query(Translation).filter(Translation.url == TEST_URL).delete()
    db.commit()
    db.close()

def test_find_replace_plain_case_sensitive(sample_translations):
    # 대소문자 구분: "Apple"만 "포도"로 치환
    res = client.post("/translations/find_replace", json={
        "find_text": "Apple",
        "replace_text": "포도",
        "folder_scope": "테스트폴더A",
        "use_regex": False,
        "case_sensitive": True
    })
    assert res.status_code == 200
    assert "1개의 항목" in res.json()["message"]

    db = SessionLocal()
    p4 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p4").first()
    assert p4.translated == "포도과 apple"
    db.close()

def test_find_replace_case_insensitive(sample_translations):
    # 대소문자 미구분: "apple" 치환 -> "Apple과 apple" 둘 다 "과일"로 치환되어야 함
    res = client.post("/translations/find_replace", json={
        "find_text": "apple",
        "replace_text": "과일",
        "folder_scope": "테스트폴더A",
        "use_regex": False,
        "case_sensitive": False
    })
    assert res.status_code == 200
    assert "1개의 항목" in res.json()["message"]

    db = SessionLocal()
    p4 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p4").first()
    assert p4.translated == "과일과 과일"
    db.close()

def test_find_replace_folder_scope(sample_translations):
    # 폴더B만 대상으로 '바나나' -> '딸기'
    res = client.post("/translations/find_replace", json={
        "find_text": "바나나",
        "replace_text": "딸기",
        "folder_scope": "테스트폴더B",
        "use_regex": False,
        "case_sensitive": True
    })
    assert res.status_code == 200
    assert "1개의 항목" in res.json()["message"]

    db = SessionLocal()
    p3 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p3").first()
    assert p3.translated == "이것은 딸기입니다."
    db.close()

def test_find_replace_condition_text(sample_translations):
    # 원문에 '青い'가 포함된 항목만 '사과' -> '청사과'
    res = client.post("/translations/find_replace", json={
        "find_text": "사과",
        "replace_text": "청사과",
        "condition_text": "青い",
        "folder_scope": "테스트폴더A",
        "use_regex": False,
        "case_sensitive": True
    })
    assert res.status_code == 200
    assert "1개의 항목" in res.json()["message"]

    db = SessionLocal()
    p1 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p1").first()
    p2 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p2").first()
    assert p1.translated == "이것은 사과입니다." # 조건 안맞아 유지
    assert p2.translated == "이것은 푸른 청사과입니다." # 치환 성공
    db.close()

def test_find_replace_regex(sample_translations):
    # 정규식 치환: '푸?른?\s?사과' -> '배'
    res = client.post("/translations/find_replace", json={
        "find_text": r"푸?른?\s?사과",
        "replace_text": "배",
        "folder_scope": "테스트폴더A",
        "use_regex": True,
        "case_sensitive": True
    })
    assert res.status_code == 200
    # p1("사과")과 p2("푸른 사과") 둘 다 매칭되어 2개 치환
    assert "2개의 항목" in res.json()["message"]

    db = SessionLocal()
    p1 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p1").first()
    p2 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p2").first()
    assert "배입니다." in p1.translated
    assert "배입니다." in p2.translated
    db.close()

def test_find_replace_invalid_regex():
    res = client.post("/translations/find_replace", json={
        "find_text": "(unclosed",
        "replace_text": "xyz",
        "use_regex": True
    })
    assert res.status_code == 400
    assert "유효하지 않은 정규식" in res.json()["detail"]

def test_find_replace_target_ids(sample_translations):
    # p1의 id만 지정하여 치환
    target_id = sample_translations[0].id
    res = client.post("/translations/find_replace", json={
        "find_text": "사과",
        "replace_text": "망고",
        "target_ids": [target_id],
        "use_regex": False,
        "case_sensitive": True
    })
    assert res.status_code == 200
    assert "1개의 항목" in res.json()["message"]

    db = SessionLocal()
    p1 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p1").first()
    p2 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p2").first()
    assert "망고입니다." in p1.translated
    assert "사과입니다." in p2.translated  # p2는 target_ids에 없으므로 유지
    db.close()

def test_find_replace_safe_slash(sample_translations):
    # 역슬래시나 특수문자가 포함된 치환도 오류 없이 안전하게 치환되어야 함
    res = client.post("/translations/find_replace", json={
        "find_text": "바나나",
        "replace_text": r"C:\Folder\banana",
        "folder_scope": "테스트폴더B",
        "use_regex": False,
        "case_sensitive": False
    })
    assert res.status_code == 200
    assert "1개의 항목" in res.json()["message"]

    db = SessionLocal()
    p3 = db.query(Translation).filter(Translation.url == TEST_URL, Translation.pid == "p3").first()
    assert r"C:\Folder\banana" in p3.translated
    db.close()

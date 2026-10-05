import os
import json
import pytest
from fastapi.testclient import TestClient
from server.server import app
from server.database import get_db, SessionLocal
from server.models import Translation
from server.settings import settings

client = TestClient(app)

@pytest.fixture(autouse=True)
def setup_test_data():
    db = SessionLocal()
    # Clean up translations
    db.query(Translation).delete()
    
    # Insert test data for the novel
    folder = "누나가 마 니 선생이라고 느그 좋아하면 안되나?"
    test_rows = [
        Translation(
            url="http://example.com/ch1",
            pid="p1",
            original="しかし動揺する悠を見た貴美のテンションは上がってしまう。",
            translated="하지만 동요하는 하루를 본 타카미의 텐션은 한껏 올라가 버린다.",
            timestamp=1000,
            folderName=folder,
            title="1화: 첫 만남"
        ),
        Translation(
            url="http://example.com/ch1",
            pid="p2",
            original="悠が余計なことを言ってしまい、貴美を怒らせてしまった。",
            translated="하루가 쓸데없는 말을 해버려 타카미를 화나게 하고 말았다.",
            timestamp=1001,
            folderName=folder,
            title="1화: 첫 만남"
        ),
        Translation(
            url="http://example.com/ch1",
            pid="p3",
            original="悠は恐る恐る話してみた。",
            translated="유카는 조심스럽게 이야기를 꺼내보았다.",
            timestamp=1002,
            folderName=folder,
            title="1화: 첫 만남"
        ),
        Translation(
            url="http://example.com/ch1",
            pid="p4",
            original="百合華は優しく微笑んだ。",
            translated="유리화는 상냥하게 미소지었다.",
            timestamp=1003,
            folderName=folder,
            title="1화: 첫 만남"
        ),
        # Already correct row (should NOT be matched by invariant scan)
        Translation(
            url="http://example.com/ch1",
            pid="p5",
            original="悠は優しく、百合華は可愛い。",
            translated="유우는 다정하고, 유리카는 귀엽다.",
            timestamp=1004,
            folderName=folder,
            title="1화: 첫 만남"
        ),
        # Row with no target characters
        Translation(
            url="http://example.com/ch1",
            pid="p6",
            original="今日は天気がいい一日だ。",
            translated="오늘은 날씨가 좋은 하루다.",
            timestamp=1005,
            folderName=folder,
            title="1화: 첫 만남"
        ),
    ]
    db.add_all(test_rows)
    db.commit()
    db.close()
    yield


def test_db_editor_page():
    res = client.get("/db_editor")
    assert res.status_code == 200
    assert "인명·고유명사" in res.text
    assert "틴더 카드 모드" in res.text


def test_get_novels():
    res = client.get("/api/db_editor/novels")
    assert res.status_code == 200
    data = res.json()
    assert len(data) >= 1
    assert any(n["folderName"] == "누나가 마 니 선생이라고 느그 좋아하면 안되나?" for n in data)


def test_get_and_save_rules():
    folder = "누나가 마 니 선생이라고 느그 좋아하면 안되나?"
    res = client.get(f"/api/db_editor/rules?folderName={folder}")
    assert res.status_code == 200
    data = res.json()
    assert "rules" in data
    assert len(data["rules"]) >= 2
    
    # Test saving modified rules
    rules = data["rules"]
    rules.append({
        "id": "test-rule-3",
        "source": "美咲",
        "target": "미사키",
        "enabled": True,
        "description": "서브 히로인",
        "misreadings": ["미사"]
    })
    save_res = client.post("/api/db_editor/rules", json={
        "folderName": folder,
        "rules": rules
    })
    assert save_res.status_code == 200
    assert save_res.json()["status"] == "success"
    
    # Verify persistence
    verify_res = client.get(f"/api/db_editor/rules?folderName={folder}")
    assert any(r["source"] == "美咲" for r in verify_res.json()["rules"])


def test_scan_sentences():
    folder = "누나가 마 니 선생이라고 느그 좋아하면 안되나?"
    res = client.post("/api/db_editor/scan", json={"folderName": folder})
    assert res.status_code == 200
    data = res.json()
    assert data["total_matched"] == 4  # p1, p2, p3, p4 (p5 is correct, p6 has no target characters)
    
    # Check suggestion on p1 (하루 -> 유우)
    p1 = next(item for item in data["items"] if item["pid"] == "p1")
    assert "유우" in p1["suggested"]
    assert any("하루" in r for r in p1["reasons"])
    
    # Check suggestion on p3 (유카 -> 유우)
    p3 = next(item for item in data["items"] if item["pid"] == "p3")
    assert "유우는" in p3["suggested"]
    
    # Check suggestion on p4 (유리화 -> 유리카)
    p4 = next(item for item in data["items"] if item["pid"] == "p4")
    assert "유리카는" in p4["suggested"]


def test_approve_single():
    db = SessionLocal()
    target_row = db.query(Translation).filter(Translation.pid == "p1").first()
    row_id = target_row.id
    db.close()
    
    res = client.post("/api/db_editor/approve_single", json={
        "id": row_id,
        "translated": "하지만 동요하는 유우를 본 타카미의 텐션은 한껏 올라가 버린다.",
        "backup": True
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["backup_created"] is True
    assert data["backup_file"].startswith("translations_backup_before_name_fix_")
    
    # Verify in DB
    db = SessionLocal()
    updated = db.query(Translation).filter(Translation.id == row_id).first()
    assert "유우를" in updated.translated
    db.close()


def test_approve_batch():
    db = SessionLocal()
    rows = db.query(Translation).filter(Translation.pid.in_(["p2", "p3", "p4"])).all()
    items = []
    for r in rows:
        if r.pid == "p2":
            items.append({"id": r.id, "translated": "유우가 쓸데없는 말을 해버려 타카미를 화나게 하고 말았다."})
        elif r.pid == "p3":
            items.append({"id": r.id, "translated": "유우는 조심스럽게 이야기를 꺼내보았다."})
        elif r.pid == "p4":
            items.append({"id": r.id, "translated": "유리카는 상냥하게 미소지었다."})
    db.close()
    
    res = client.post("/api/db_editor/approve_batch", json={
        "items": items,
        "backup": True
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert data["count"] == 3
    assert data["backup_file"] is not None
    
    # Verify in DB
    db = SessionLocal()
    p2_rec = db.query(Translation).filter(Translation.pid == "p2").first()
    assert "유우가" in p2_rec.translated
    p4_rec = db.query(Translation).filter(Translation.pid == "p4").first()
    assert "유리카는" in p4_rec.translated
    db.close()


def test_no_duplicate_particles():
    from server.routers.db_editor import generate_smart_suggestion
    rules = [
        {"source": "悠", "target": "유우", "enabled": True, "misreadings": ["하루토", "유토", "하루카"]}
    ]
    
    # 1. '유' + 조사 (유의 -> 유우의, not 유우의의)
    suggested, reasons, tags = generate_smart_suggestion("悠の顔", "유의 얼굴", rules)
    assert suggested == "유우의 얼굴"
    assert "유우의의" not in suggested
    
    # 2. '유' + 는
    suggested, _, _ = generate_smart_suggestion("悠は歩いた", "유는 걸었다", rules)
    assert suggested == "유우는 걸었다"
    assert "유우는는" not in suggested
    
    # 3. '하루' + 는
    suggested, _, _ = generate_smart_suggestion("悠は行った", "하루는 갔다", rules)
    assert suggested == "유우는 갔다"
    assert "유우는는" not in suggested

    # 4. '유카' + 는
    suggested, _, _ = generate_smart_suggestion("悠は笑った", "유카는 웃었다", rules)
    assert suggested == "유우는 웃었다"
    assert "유우는는" not in suggested

    # 5. '유리' + 가
    suggested, _, _ = generate_smart_suggestion("悠が言った", "유리가 말했다", rules)
    assert suggested == "유우가 말했다"
    assert "유우가가" not in suggested


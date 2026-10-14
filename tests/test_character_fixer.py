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


def test_get_folders():
    res = client.get("/api/db_editor/folders")
    assert res.status_code == 200
    data = res.json()
    assert "folders" in data
    assert len(data["folders"]) >= 1
    assert any(n["folderName"] == "누나가 마 니 선생이라고 느그 좋아하면 안되나?" for n in data["folders"])


def test_get_and_save_rules():
    folder = "누나가 마 니 선생이라고 느그 좋아하면 안되나?"
    res = client.get(f"/api/db_editor/rules?folderName={folder}")
    assert res.status_code == 200
    data = res.json()
    assert "rules" in data
    assert len(data["rules"]) >= 2
    
    original_rules = [r for r in data["rules"] if r.get("id") != "test-rule-temp"]
    test_rules = list(original_rules)
    test_rules.append({
        "id": "test-rule-temp",
        "source": "美咲",
        "target": "미사키",
        "enabled": True,
        "description": "서브 히로인",
        "misreadings": ["미사"]
    })
    save_res = client.post("/api/db_editor/rules", json={
        "folderName": folder,
        "rules": test_rules
    })
    assert save_res.status_code == 200
    assert save_res.json()["status"] == "success"
    
    # Verify persistence
    verify_res = client.get(f"/api/db_editor/rules?folderName={folder}")
    assert any(r["source"] == "美咲" for r in verify_res.json()["rules"])

    # Clean up: restore original rules
    client.post("/api/db_editor/rules", json={
        "folderName": folder,
        "rules": original_rules
    })


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
    assert data["backup_file"] is not None
    assert data["backup_file"].startswith("translations_backup_")
    
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


def test_discover_misreadings_endpoint():
    folder = "누나가 마 니 선생이라고 느그 좋아하면 안되나?"
    res = client.post("/api/db_editor/discover_misreadings", json={
        "folderName": folder,
        "source": "悠",
        "target": "유우"
    })
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "success"
    assert "candidates" in data
    words = [c["word"] for c in data["candidates"]]
    # In test fixture: p1 has 하루를, p2 has 하루가, p3 has 유카는
    assert any("하루" in w for w in words) or any("유카" in w for w in words)

    # Empty source validation
    fail_res = client.post("/api/db_editor/discover_misreadings", json={
        "folderName": folder,
        "source": "   ",
        "target": "유우"
    })
    assert fail_res.status_code == 400


def test_exceptions_in_scan():
    folder = "테스트_예외단어_소설"
    db = SessionLocal()
    # Insert test rows: one is normal exception, one is an actual misreading
    r1 = Translation(
        url="http://example.com/ex1",
        pid="ex_p1",
        original="英国風のメイド服を着て、英語で話す。",
        translated="영국풍의 메이드복을 입고, 영어로 말한다.",
        timestamp=2000,
        folderName=folder,
        title="예외 테스트 1"
    )
    r2 = Translation(
        url="http://example.com/ex2",
        pid="ex_p2",
        original="英は怒って立ち去った。",
        translated="에이는 화가 나서 떠나갔다.",
        timestamp=2001,
        folderName=folder,
        title="예외 테스트 2"
    )
    db.add_all([r1, r2])
    db.commit()
    db.close()

    try:
        rules = [
            {
                "id": "rule-hide",
                "source": "英",
                "target": "하나부사",
                "enabled": True,
                "misreadings": ["에이"],
                "exceptions": ["영국", "영어", "英国", "英語"]
            }
        ]
        res = client.post("/api/db_editor/scan", json={
            "folderName": folder,
            "rules": rules
        })
        assert res.status_code == 200
        data = res.json()
        
        # r1 ("영국", "영어") should NOT be matched because of exceptions!
        # Only r2 ("에이") should be matched!
        matched_pids = [item["pid"] for item in data["items"]]
        assert "ex_p1" not in matched_pids
        assert "ex_p2" in matched_pids
        assert data["total_matched"] == 1
        
        # Check auto suggestion on r2
        item_r2 = next(i for i in data["items"] if i["pid"] == "ex_p2")
        assert "하나부사는" in item_r2["suggested"]
    finally:
        db = SessionLocal()
        db.query(Translation).filter(Translation.folderName == folder).delete()
        db.commit()
        db.close()


def test_generate_smart_suggestion_with_exceptions():
    from server.routers.db_editor import generate_smart_suggestion

    # 1. Rule with explicit exceptions
    rule_with_exc = [{
        "source": "英",
        "target": "하나부사",
        "enabled": True,
        "misreadings": ["에이"],
        "exceptions": ["영국", "영어", "英国", "英語"]
    }]
    # Sentence with exception word in translated
    suggested, reasons, tags = generate_smart_suggestion("英会話", "영국 메이드", rule_with_exc)
    assert suggested == "영국 메이드"  # Should NOT be replaced!
    assert "하나부사 누락" not in reasons
    assert "하나부사 누락" not in tags

    # Sentence with exception word in original
    suggested_jp, reasons_jp, tags_jp = generate_smart_suggestion("英国", "에이 나라", rule_with_exc)
    assert suggested_jp == "에이 나라"
    assert "하나부사 누락" not in reasons_jp

    # Sentence without exception word
    suggested_valid, reasons_valid, tags_valid = generate_smart_suggestion("英が笑った", "에이가 웃었다", rule_with_exc)
    assert suggested_valid == "하나부사가 웃었다"
    assert any("에이 ➔ 하나부사" in r for r in reasons_valid)

    # 2. Rule with '-' or '!' prefix in misreadings (smart auto-detection)
    rule_prefix = [{
        "source": "英",
        "target": "하나부사",
        "enabled": True,
        "misreadings": ["에이", "-영국", "!영어"]
    }]
    suggested_pref, reasons_pref, _ = generate_smart_suggestion("英", "영국", rule_prefix)
    assert suggested_pref == "영국"
    assert "하나부사 누락" not in reasons_pref


def test_save_and_retrieve_rules_with_exceptions():
    folder = "테스트_규칙_소설"
    test_rules = [
        {
            "id": "rule-exc-test",
            "source": "英",
            "target": "하나부사",
            "enabled": True,
            "description": "예외 테스트 규칙",
            "misreadings": ["에이", "히데"],
            "exceptions": ["영국", "영어", "英国", "英語"]
        }
    ]
    save_res = client.post("/api/db_editor/rules", json={
        "folderName": folder,
        "rules": test_rules
    })
    assert save_res.status_code == 200
    assert save_res.json()["status"] == "success"

    get_res = client.get(f"/api/db_editor/rules?folderName={folder}")
    assert get_res.status_code == 200
    rules = get_res.json()["rules"]
    target_rule = next(r for r in rules if r["id"] == "rule-exc-test")
    assert target_rule["exceptions"] == ["영국", "영어", "英国", "英語"]
    assert target_rule["misreadings"] == ["에이", "히데"]


def test_coexisting_name_and_exception():
    folder = "테스트_공존_소설"
    db = SessionLocal()
    # r1: 인명(英) + 예외어(英国) 공존, 타깃(하나부사) 누락 (에이로 오역됨) -> 감지 대상!
    r1 = Translation(
        url="http://example.com/co1",
        pid="co_p1",
        original="英は英国に向かった。",
        translated="에이는 영국으로 향했다.",
        timestamp=3000,
        folderName=folder,
        title="공존 테스트 1"
    )
    # r2: 인명(英) + 예외어(英国) 공존, 타깃(하나부사) 정상 번역됨 -> 누락 아님 (비감지)!
    r2 = Translation(
        url="http://example.com/co2",
        pid="co_p2",
        original="英は英国に向かった。",
        translated="하나부사는 영국으로 향했다.",
        timestamp=3001,
        folderName=folder,
        title="공존 테스트 2"
    )
    # r3: 예외어(英国)만 있고 인명 없음 -> 누락 아님 (비감지)!
    r3 = Translation(
        url="http://example.com/co3",
        pid="co_p3",
        original="ここは英国の庭園だ。",
        translated="여기는 영국의 정원이다.",
        timestamp=3002,
        folderName=folder,
        title="공존 테스트 3"
    )
    db.add_all([r1, r2, r3])
    db.commit()
    db.close()

    try:
        rules = [
            {
                "id": "rule-hide-coexist",
                "source": "英",
                "target": "하나부사",
                "enabled": True,
                "misreadings": ["에이"],
                "exceptions": ["영국", "영어", "英国", "英語"]
            }
        ]
        res = client.post("/api/db_editor/scan", json={
            "folderName": folder,
            "rules": rules
        })
        assert res.status_code == 200
        data = res.json()
        
        # 오직 r1만 감지되어야 함! (인명용 한자가 존재하고 target이 누락된 상태이므로)
        matched_pids = [item["pid"] for item in data["items"]]
        assert "co_p1" in matched_pids
        assert "co_p2" not in matched_pids
        assert "co_p3" not in matched_pids
        assert data["total_matched"] == 1

        # r1의 제안문 확인: 예외어 "영국"은 유지되고 인명 "에이"만 "하나부사"로 치환!
        co1 = next(item for item in data["items"] if item["pid"] == "co_p1")
        assert co1["suggested"] == "하나부사는 영국으로 향했다."
        assert any("에이 ➔ 하나부사" in r for r in co1["reasons"])
    finally:
        db = SessionLocal()
        db.query(Translation).filter(Translation.folderName == folder).delete()
        db.commit()
        db.close()


def test_method3_placeholder_protection():
    from server.routers.db_editor import generate_smart_suggestion

    rules = [{
        "source": "英",
        "target": "하나부사",
        "enabled": True,
        "misreadings": ["하나에", "하나"]
    }]

    # 1. Existing '하나부사' + misreading '하나에' + misreading '하나'
    # 원문: 英 3개, 번역문: 하나부사 1개, 하나에 1개, 하나 1개
    orig = "英、英、英。"
    trans = "하나부사는 하나에 씨를 바래다주고, 하나 씨도 만났다."
    suggested, reasons, tags = generate_smart_suggestion(orig, trans, rules)

    # 기존 '하나부사'가 '하나부사부사'로 변질되지 않고, '하나에'와 '하나'만 각각 '하나부사'로 깔끔하게 교정되어야 함!
    assert suggested == "하나부사는 하나부사 씨를 바래다주고, 하나부사 씨도 만났다."
    assert "하나부사부사" not in suggested
    assert "하나부사에" not in suggested

    # 2. Existing '하나부사' + only '하나'
    orig2 = "英、英。"
    trans2 = "하나부사는 하나 씨를 만났다."
    suggested2, _, _ = generate_smart_suggestion(orig2, trans2, rules)
    assert suggested2 == "하나부사는 하나부사 씨를 만났다."
    assert "하나부사부사" not in suggested2

    # 3. Already correct translation should remain completely unchanged
    orig_clean = "英は走った。"
    trans_clean = "하나부사는 달렸다."
    suggested_clean, _, _ = generate_smart_suggestion(orig_clean, trans_clean, rules)
    assert suggested_clean == "하나부사는 달렸다."
    assert "하나부사부사" not in suggested_clean



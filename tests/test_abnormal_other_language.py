import pytest
import time
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from server.models import Base, Translation, AbnormalWhitelist
from server.rule_classifier import classify_translation, extract_untranslated_keywords
from server.services.abnormal_service import (
    get_abnormal_translations_data,
    add_abnormal_whitelist_items,
    remove_abnormal_whitelist_items,
    get_abnormal_whitelist_data
)
from server.database import _sqlite_regexp

from sqlalchemy import event

@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")

    @event.listens_for(engine, "connect")
    def set_sqlite_regexp(dbapi_connection, connection_record):
        dbapi_connection.create_function("REGEXP", 2, _sqlite_regexp)

    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    yield session
    session.close()


def test_classify_translation_english_and_spanish():
    """영어 및 스페인어 번역문 품질 분류 검증"""
    # 1. 순수 영어 번역문
    assert classify_translation("あいつは本当にバカだ。", "He is really an idiot.") == "other_language"
    assert classify_translation("「どこへ行くんだ？」", "Where are you going?") == "other_language"

    # 2. 순수 스페인어 번역문 (악센트 및 ¿, ¡ 포함)
    assert classify_translation("「おはよう」", "¡Buenos días!") == "other_language"
    assert classify_translation("彼はずっと待っていた。", "Él había estado esperando todo el tiempo.") == "other_language"
    assert classify_translation("「元気ですか？」", "¿Cómo estás?") == "other_language"

    # 3. 혼합 번역문 (한글과 함께 연속 4단어 이상의 영어/스페인어 문장 잔류)
    assert classify_translation("あいつは本当にバカだ。", "그는 말했다. I don't want to die.") == "other_language"
    assert classify_translation("あいつは本当にバカだ。", "Por favor espera un momento라고 외쳤다.") == "other_language"

    # 4. 정상 한글 번역 내 단순 외래어/약어 표기 (오탐 방지)
    assert classify_translation("彼はレベルが上がった。", "그는 Lv 10으로 레벨업했다.") == "normal"
    assert classify_translation("HPが回復した。", "HP가 회복되었다.") == "normal"
    assert classify_translation("「わかった」", "「OK, 알았어」") == "normal"


def test_extract_untranslated_keywords_english_and_spanish():
    """영어 및 스페인어 단어 키워드 추출 검증"""
    kw_en = extract_untranslated_keywords("どこへ行くんだ", "Where are you going right now?")
    assert "Where" in kw_en or "going" in kw_en

    kw_es = extract_untranslated_keywords("おはよう", "¡Buenos días amigo!")
    assert "Buenos" in kw_es or "días" in kw_es or "amigo" in kw_es


def test_abnormal_detection_and_whitelist_flow(db_session):
    """이상번역 찾기에서 영어/스페인어 검출 및 이상번역 제외(화이트리스트) 동작 검증"""
    url = "https://kakuyomu.jp/works/test/episodes/1"
    now = int(time.time())

    # 1. 다양한 번역 데이터 적재
    t1 = Translation(
        url=url,
        pid="p1",
        original="あいつは本当にバカだ。",
        translated="He is really an idiot.",  # 영어
        timestamp=now,
        folderName="다국어 테스트",
        title="1화"
    )
    t2 = Translation(
        url=url,
        pid="p2",
        original="「おはよう」",
        translated="¡Buenos días!",  # 스페인어
        timestamp=now,
        folderName="다국어 테스트",
        title="1화"
    )
    t3 = Translation(
        url=url,
        pid="p3",
        original="風が吹いていた。",
        translated="바람이 불고 있었다.",  # 정상 번역
        timestamp=now,
        folderName="다국어 테스트",
        title="1화"
    )
    t4 = Translation(
        url=url,
        pid="p4",
        original="彼は歩き始めた。",
        translated="그는 歩き始めた。",  # 일부 미번역 (가나 잔류)
        timestamp=now,
        folderName="다국어 테스트",
        title="1화"
    )
    db_session.add_all([t1, t2, t3, t4])
    db_session.commit()

    # 2. 이상번역 조회
    data = get_abnormal_translations_data(category_filter="all", db=db_session)
    counts = data["_category_counts"]
    assert counts["total"] == 3  # t1(영어), t2(스페인어), t4(일부미번역)
    assert counts["other_language"] == 2  # t1, t2
    assert counts["partial_untranslated"] == 1  # t4

    # 3. 'other_language' 필터 적용 조회
    other_data = get_abnormal_translations_data(category_filter="other_language", db=db_session)
    assert "다국어 테스트" in other_data
    items = other_data["다국어 테스트"][0]["items"]
    assert len(items) == 2
    item_pids = {it["pid"] for it in items}
    assert item_pids == {"p1", "p2"}

    # 4. 탐지 제외(화이트리스트 등록) - t1을 의도된 외국어로 제외
    wl_res = add_abnormal_whitelist_items([t1.id], db=db_session)
    assert wl_res["success"] is True
    assert wl_res["added_count"] == 1

    # 5. 제외 후 재조회 시 t1은 제외되고 t2만 'other_language'로 남아야 함
    after_wl_data = get_abnormal_translations_data(category_filter="other_language", db=db_session)
    after_items = after_wl_data["다국어 테스트"][0]["items"]
    assert len(after_items) == 1
    assert after_items[0]["pid"] == "p2"

    counts_after = after_wl_data["_category_counts"]
    assert counts_after["total"] == 2
    assert counts_after["other_language"] == 1

    # 6. 화이트리스트 목록 조회 확인
    wl_list = get_abnormal_whitelist_data(db=db_session)
    assert len(wl_list["whitelist"]) == 1
    assert wl_list["whitelist"][0]["translation_id"] == t1.id

    # 7. 화이트리스트 해제 시 다시 이상번역 탐지에 포함되는지 확인
    rm_res = remove_abnormal_whitelist_items([t1.id], db=db_session)
    assert rm_res["success"] is True
    restored_data = get_abnormal_translations_data(category_filter="other_language", db=db_session)
    assert len(restored_data["다국어 테스트"][0]["items"]) == 2

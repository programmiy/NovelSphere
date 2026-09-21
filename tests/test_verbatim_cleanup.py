import pytest
import time
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from server.models import Base, Translation, TranslationTrash, CleanupNotification
from server.rule_classifier import is_verbatim_copy
from server.routers.translation import (
    handle_verbatim_cleanup_items,
    _build_translation_prompt,
    TRANSLATION_SYSTEM_INSTRUCTION,
    TranslationItemInput
)
from server.routers.data_crud import upsert_translations, TranslationItem, get_cleanup_review_targets

# 인메모리 SQLite DB로 테스트 세션 격리
@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()

def test_system_instruction_and_prompt_contain_critical_constraints():
    """시스템 지침과 프롬프트에 원문 복제 금지 및 항목 독립성 지침이 포함되어 있는지 검증"""
    inst_text = TRANSLATION_SYSTEM_INSTRUCTION["parts"][0]["text"]
    assert "STRICT TRANSLATION ONLY" in inst_text
    assert "NO ECHOING" in inst_text
    assert "STRICT ITEM INDEPENDENCE" in inst_text
    assert "というか" in inst_text
    assert "こんどこそ" in inst_text

    items = [
        TranslationItemInput(id="p1", text="あいつは本当にバカだ。"),
        TranslationItemInput(id="p2", text="風が吹いていた。")
    ]
    prompt = _build_translation_prompt(items)
    assert "MANDATORY REQUIREMENTS" in prompt
    assert "Do NOT echo or copy the original Japanese text" in prompt
    assert "Do NOT repeat or carry over" in prompt

def test_is_verbatim_copy_detection():
    """원문 복사(글자만 일치) 판별 엔진 검증"""
    # 1. 완벽한 복붙
    assert is_verbatim_copy("あいつはバカだ", "あいつはバカだ") is True
    # 2. 공백만 다른 복붙
    assert is_verbatim_copy(" あいつはバカだ ", "あいつはバカだ") is True
    # 3. 정상 번역
    assert is_verbatim_copy("あいつはバカだ", "그 녀석은 바보다") is False
    # 4. 단순 기호/문장부호는 정상 허용 (복붙 판정 안 함)
    assert is_verbatim_copy("「……っ!」", "「……!」") is False
    assert is_verbatim_copy("……", "……") is False
    # 5. 빈 문자열
    assert is_verbatim_copy("あいつはバカだ", "") is False

def test_handle_verbatim_cleanup_items(db_session):
    """원문 복붙 발생 시 기존 레코드의 휴지통 이동, DB 삭제 및 알림 생성 검증"""
    url = "https://kakuyomu.jp/works/123/episodes/456"
    
    # 기존 DB에 원문 복붙 레코드가 적재되어 있는 상태 모의
    t1 = Translation(
        url=url,
        pid="p1",
        original="あいつはバカだ",
        translated="あいつはバカだ",
        timestamp=int(time.time()),
        folderName="테스트 소설",
        title="1화"
    )
    db_session.add(t1)
    db_session.commit()

    verbatim_items = [
        {"id": "p1", "original": "あいつはバカだ", "translated": "あいつはバカだ"}
    ]

    batch_id = handle_verbatim_cleanup_items(db_session, url, verbatim_items, "테스트 소설", "1화")
    assert batch_id.startswith("verbatim_auto_")

    # 1. Translation 테이블에서 기존 레코드 즉시 삭제 확인
    remaining = db_session.query(Translation).filter(Translation.url == url, Translation.pid == "p1").first()
    assert remaining is None

    # 2. TranslationTrash(휴지통)로 이동 확인
    trashed = db_session.query(TranslationTrash).filter(TranslationTrash.url == url, TranslationTrash.pid == "p1").first()
    assert trashed is not None
    assert trashed.reason_category == "verbatim"
    assert trashed.cleanup_batch_id == batch_id

    # 3. CleanupNotification(알림 센터) 등록 확인
    notif = db_session.query(CleanupNotification).filter(CleanupNotification.batch_id == batch_id).first()
    assert notif is not None
    assert notif.novel_title == "테스트 소설"
    assert notif.deleted_count == 1
    assert notif.is_dismissed == 0

def test_upsert_translations_blocks_verbatim_copy(db_session):
    """upsert_translations 호출 시 원문 복붙 텍스트는 Translation 테이블에 적재되지 않고 TranslationTrash로 격리 및 알림 생성되는지 검증"""
    url = "https://kakuyomu.jp/works/123/episodes/789"
    items = [
        TranslationItem(
            url=url,
            pid="p1",
            original="こんにちは",
            translated="こんにちは", # 원문 복붙!
            timestamp=int(time.time())
        ),
        TranslationItem(
            url=url,
            pid="p2",
            original="さようなら",
            translated="안녕히 가세요", # 정상 번역
            timestamp=int(time.time())
        )
    ]

    res = upsert_translations(items, db=db_session)
    assert res["inserted"] == 1  # p2만 정상 삽입

    # 1. p1은 Translation 테이블에 없어야 함
    row_p1 = db_session.query(Translation).filter(Translation.url == url, Translation.pid == "p1").first()
    assert row_p1 is None

    # 2. p1은 TranslationTrash에 존재해야 함
    trash_p1 = db_session.query(TranslationTrash).filter(TranslationTrash.url == url, TranslationTrash.pid == "p1").first()
    assert trash_p1 is not None
    assert trash_p1.reason_category == "verbatim"

    # 3. CleanupNotification이 생성되어 있어야 함
    notif = db_session.query(CleanupNotification).filter(CleanupNotification.url == url).first()
    assert notif is not None

    # 4. p2는 Translation 테이블에 정상 저장
    row_p2 = db_session.query(Translation).filter(Translation.url == url, Translation.pid == "p2").first()
    assert row_p2 is not None
    assert row_p2.translated == "안녕히 가세요"

    # 5. get_cleanup_review_targets로 조회 시 타겟으로 정상 노출
    review_res = get_cleanup_review_targets(url=url, db=db_session)
    assert review_res["has_targets"] is True
    assert any(t["pid"] == "p1" for t in review_res["targets"])

def test_get_cleanup_review_targets_with_active_notification(db_session):
    """알림 센터 연계 검수 대상 조회 시 타겟 문장 목록 및 알림 정보 정상 반환 검증"""
    url = "https://kakuyomu.jp/works/123/episodes/999"
    now_ms = int(time.time() * 1000)
    batch_id = f"verbatim_auto_{now_ms}"

    # 1. 활성 알림 등록
    notif = CleanupNotification(
        batch_id=batch_id,
        novel_title="검수 소설",
        episode_title="제5화",
        url=url,
        deleted_count=2,
        is_dismissed=0,
        created_at=now_ms
    )
    db_session.add(notif)

    # 2. 휴지통(TranslationTrash)에 삭제된 문제 문장 2건 등록
    trash1 = TranslationTrash(
        url=url,
        pid="p10",
        original="あいつはバカだ",
        translated="",
        timestamp=int(time.time()),
        deleted_at=now_ms,
        cleanup_batch_id=batch_id,
        reason_category="verbatim"
    )
    trash2 = TranslationTrash(
        url=url,
        pid="p11",
        original="こんどこそ勝つ",
        translated="",
        timestamp=int(time.time()),
        deleted_at=now_ms,
        cleanup_batch_id=batch_id,
        reason_category="verbatim"
    )
    db_session.add_all([trash1, trash2])
    db_session.commit()

    # 3. API 함수 호출
    res = get_cleanup_review_targets(url=url, batch_id=batch_id, db=db_session)
    assert res["has_targets"] is True
    assert res["notif_id"] == notif.id
    assert res["novel_title"] == "검수 소설"
    assert len(res["targets"]) == 2

    pids = [t["pid"] for t in res["targets"]]
    assert "p10" in pids
    assert "p11" in pids

def test_get_cleanup_review_targets_empty(db_session):
    """삭제 이력이 없는 일반 URL의 경우 has_targets: False 및 빈 배열 반환 검증"""
    url = "https://kakuyomu.jp/works/clean/episodes/1"
    res = get_cleanup_review_targets(url=url, db=db_session)
    assert res["has_targets"] is False
    assert res["notif_id"] is None
    assert len(res["targets"]) == 0


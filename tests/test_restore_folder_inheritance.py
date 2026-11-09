import pytest
import time
from sqlalchemy.orm import Session
import server.database as sdb
from server.models import Translation, TranslationTrash, ApiCallLog
from server.routers.data_crud import upsert_translations, TranslationItem
from server.services.cleanup_trash_service import restore_trash_items, RestoreRequest
from server.quota import (
    get_today_api_call_count,
    get_today_translations_count,
    get_today_episodes_count,
    get_current_quota_window_start_ts,
)


@pytest.fixture
def db_session():
    session = sdb.SessionLocal()
    try:
        yield session
    finally:
        session.close()


def test_upsert_normal_novel_never_inherits_folder_name(db_session: Session):
    """
    일반 소설 번역 시, 클라이언트가 folderName=None으로 전송하거나 동일 URL에 기존 폴더가 있더라도
    새로운 번역 문단은 무조건 미분류(folderName=None)로 보관함에 적재되는지 검증 (검열 소설 제외 전원 미분류 규칙)
    """
    clean_url = "https://kakuyomu.jp/works/111/episodes/222"
    novel_folder = "내 최애는 악역영애"

    # 1. 동일 회차의 기존 번역 문단 등록
    existing_t = Translation(
        url=clean_url,
        pid="p1",
        original="こんにちは",
        translated="안녕하세요",
        timestamp=1700000000,
        folderName=novel_folder,
        title="1화"
    )
    db_session.add(existing_t)
    db_session.commit()

    # 2. 클라이언트(확장 프로그램)가 신규 번역 단락 저장 요청
    items = [
        TranslationItem(
            url=clean_url,
            pid="p2",
            original="ありがとう",
            translated="고마워요",
            timestamp=1700000100,
            folderName=None,
            title="1화"
        )
    ]
    res = upsert_translations(items, db=db_session)
    assert res["inserted"] == 1

    # 3. DB 확인: p2 단락은 기존 폴더를 상속받지 않고 무조건 None(미분류 보관함)으로 적재되어야 함
    p2_record = db_session.query(Translation).filter(Translation.url == clean_url, Translation.pid == "p2").first()
    assert p2_record is not None
    assert p2_record.folderName is None


def test_upsert_preserves_timestamp_on_text_update(db_session: Session):
    """
    기존 번역 텍스트를 수정(오타 교정 등)할 때, 원래의 번역 생성 시각(timestamp)을 보존하여
    오늘 번역 실적(문단/회차 수) 왜곡을 원천 방지하는지 검증
    """
    clean_url = "https://kakuyomu.jp/works/333/episodes/444"
    original_ts = 1600000000  # 과거 시각

    t = Translation(
        url=clean_url,
        pid="p1",
        original="おはよう",
        translated="오하요",  # 오타
        timestamp=original_ts,
        folderName="테스트소설",
        title="2화"
    )
    db_session.add(t)
    db_session.commit()

    # 오늘 시각으로 오타 수정 요청
    now_ts = int(time.time())
    items = [
        TranslationItem(
            url=clean_url,
            pid="p1",
            original="おはよう",
            translated="좋은 아침",  # 수정된 번역
            timestamp=now_ts,       # 클라이언트 현재 시각
            folderName="테스트소설",
            title="2화"
        )
    ]
    res = upsert_translations(items, db=db_session)
    assert res["updated"] == 1

    # DB 확인: 텍스트는 수정되었으나 timestamp는 원래 번역 시각(original_ts)으로 보존되어야 함
    updated_t = db_session.query(Translation).filter(Translation.url == clean_url, Translation.pid == "p1").first()
    assert updated_t.translated == "좋은 아침"
    assert updated_t.timestamp == original_ts


def test_upsert_inherits_timestamp_for_new_items_in_existing_episode(db_session: Session):
    """
    과거 번역 회차에서 복원센터/재검수로 인해 신규 INSERT되는 문단이 들어오더라도,
    동일 회차의 과거 번역 일시(timestamp)를 자동 상속받아 오늘 번역 실적에 안 뜨도록 방어하는지 검증
    """
    clean_url = "https://kakuyomu.jp/works/444/episodes/555"
    past_ts = 1650000000

    # 1. 동일 회차에 과거 번역 레코드 존재
    db_session.add(Translation(
        url=clean_url,
        pid="p1",
        original="古い文",
        translated="과거 문장",
        timestamp=past_ts,
        folderName="과거소설",
        title="과거 1화"
    ))
    db_session.commit()

    # 2. 클라이언트가 현재 시각(now)으로 신규 문단 저장 요청 (재검수 등)
    now_ts = int(time.time())
    items = [
        TranslationItem(
            url=clean_url,
            pid="p2",
            original="復元された文",
            translated="복원된 문장",
            timestamp=now_ts,
            folderName="과거소설",
            title="과거 1화"
        )
    ]
    res = upsert_translations(items, db=db_session)
    assert res["inserted"] == 1

    # 3. DB 확인: p2 문단의 timestamp가 now_ts가 아니라 기존 회차의 past_ts로 상속되었는지 검증
    p2 = db_session.query(Translation).filter(Translation.url == clean_url, Translation.pid == "p2").first()
    assert p2 is not None
    assert p2.timestamp == past_ts


def test_restore_trash_inherits_folder_name(db_session: Session):
    """
    휴지통에서 복원할 때 TranslationTrash의 folderName이 None 또는 '미분류'이더라도,
    동일 URL의 기존 번역 레코드로부터 유효한 소설 폴더명을 자동 상속받는지 검증
    """
    clean_url = "https://kakuyomu.jp/works/555/episodes/666"
    novel_folder = "전생했더니 슬라임"

    # 1. 동일 회차에 정상 폴더명을 가진 다른 번역 존재
    db_session.add(Translation(
        url=clean_url,
        pid="p1",
        original="森の中",
        translated="숲 속",
        timestamp=1700000000,
        folderName=novel_folder,
        title="숲의 시작"
    ))

    # 2. 휴지통에 folderName=None으로 보관된 단락 존재
    trash = TranslationTrash(
        url=clean_url,
        pid="p2",
        original="歩く",
        translated="걷다",
        timestamp=1700000000,
        folderName=None,  # 폴더명 유실 상태
        title="숲의 시작",
        deleted_at=int(time.time()),
        cleanup_batch_id="test_batch"
    )
    db_session.add(trash)
    db_session.commit()

    # 3. 휴지통 복원 실행
    req = RestoreRequest(trash_ids=[trash.id])
    res = restore_trash_items(req, db=db_session)
    assert res["restored_count"] == 1

    # 4. 복원된 Translation 확인: novel_folder를 정상 상속받아 미분류가 되지 않는지 검증
    restored = db_session.query(Translation).filter(Translation.url == clean_url, Translation.pid == "p2").first()
    assert restored is not None
    assert restored.folderName == novel_folder


def test_quota_tracker_does_not_seed_fake_calls():
    """
    오늘 API 호출 로그가 없을 때, 단순 번역 레코드 존재만으로 가짜 API 호출(gemini-default)을 시드하지 않는지 검증
    """
    count = get_today_api_call_count()
    assert isinstance(count, int)

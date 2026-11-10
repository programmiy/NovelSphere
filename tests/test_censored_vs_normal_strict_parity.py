import pytest
import time
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from server.models import Base, Translation, ManualTranslationNovel, ApiCallLog
from server.routers.data_crud import upsert_translations, TranslationItem
import server.quota as quota_module

@pytest.fixture
def db_session(monkeypatch):
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()

    # quota module SessionLocal patch
    monkeypatch.setattr(quota_module, "SessionLocal", lambda: Session())

    yield session
    session.close()

def test_censored_novel_vs_normal_novel_parity(db_session):
    now = int(time.time())
    window_ts = quota_module.get_current_quota_window_start_ts()

    # 1. 검열 소설 등록 (ManualTranslationNovel)
    censored_folder = "검열_전용_소설_제목"
    db_session.add(ManualTranslationNovel(
        folderName=censored_folder,
        source_url="https://novel18.syosetu.com/nCensored/",
        created_at=now,
        is_completed=0
    ))
    db_session.commit()

    # [테스트 1-A] 검열 소설 저장 -> 자기 이름 폴더 유지 (미분류로 가지 않음!)
    censored_items = [
        TranslationItem(
            url="https://novel18.syosetu.com/nCensored/1/",
            pid="p1",
            original="検閲本文1",
            translated="",
            timestamp=0,  # 수집기는 0으로 적재
            folderName=censored_folder,
            title="1화"
        ),
        TranslationItem(
            url="https://novel18.syosetu.com/nCensored/1/",
            pid="p2",
            original="検閲本文2",
            translated="수동번역 문장",
            timestamp=now,  # 혹시 now 타임스탬프가 들어가더라도
            folderName=censored_folder,
            title="1화"
        )
    ]
    upsert_translations(censored_items, db=db_session)

    censored_rows = db_session.query(Translation).filter(Translation.url == "https://novel18.syosetu.com/nCensored/1/").all()
    assert len(censored_rows) == 2
    for r in censored_rows:
        assert r.folderName == censored_folder, "검열 소설은 자기이름 폴더를 유지해야 함 (미분류로 가면 안 됨)"

    # [테스트 1-B] 검열 소설 -> 오늘 번역 통계(문단/회차)에 절대 잡히지 않음 (0건)!
    assert quota_module.get_today_translations_count() == 0, "검열 소설은 오늘 번역 문단 통계에 잡히면 안 됨"
    assert quota_module.get_today_episodes_count() == 0, "검열 소설은 오늘 번역 회차 통계에 잡히면 안 됨"

    # [테스트 2-A] 정상 번역 저장 (이거의 역!) -> 임의 폴더명을 보내도 무조건 미분류(None) 적재!
    normal_items = [
        TranslationItem(
            url="https://ncode.syosetu.com/nNormal/1/",
            pid="p1",
            original="正常本文1",
            translated="정상 번역 문단 1",
            timestamp=now,
            folderName="임의의_웹_원본_제목",  # 웹소설 원제가 실려오더라도
            title="정상 1화"
        ),
        TranslationItem(
            url="https://ncode.syosetu.com/nNormal/1/",
            pid="p2",
            original="正常本文2",
            translated="정상 번역 문단 2",
            timestamp=now,
            folderName=None,
            title="정상 1화"
        )
    ]
    upsert_translations(normal_items, db=db_session)

    normal_rows = db_session.query(Translation).filter(Translation.url == "https://ncode.syosetu.com/nNormal/1/").all()
    assert len(normal_rows) == 2
    for r in normal_rows:
        assert r.folderName is None, "정상 번역은 자기이름 폴더를 만들지 않고 100% 미분류(None)여야 함"

    # [테스트 2-B] 정상 번역 -> 오늘 번역 통계에 정확히 정상 집계됨!
    assert quota_module.get_today_translations_count() == 2, "정상 번역 2문단이 정확히 집계되어야 함"
    assert quota_module.get_today_episodes_count() == 1, "정상 번역 1개 회차가 정확히 집계되어야 함"

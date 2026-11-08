import time
from unittest.mock import patch, MagicMock
import pytest
from fastapi.testclient import TestClient

from server.server import app
from server.models import Translation, ManualTranslationNovel
from server.services.reviewed_service import reviewed_service
from server.services.collector_service import (
    fetch_toc_and_title,
    fetch_episode_paragraphs,
    raw_collector
)
from server.services.cleanup_trash_service import get_cleanup_queue_data
import server.database as sdb


@pytest.fixture
def client():
    return TestClient(app)


@pytest.fixture
def db_session():
    db = sdb.SessionLocal()
    try:
        yield db
    finally:
        db.close()


def test_models_manual_translation_novel_crud(db_session):
    """ManualTranslationNovel 모델의 DB 생성 및 조회 검증"""
    folder = "테스트_검열회피_소설"
    novel = ManualTranslationNovel(
        folderName=folder,
        source_url="https://ncode.syosetu.com/n9999xx/",
        created_at=int(time.time()),
        is_completed=0
    )
    db_session.add(novel)
    db_session.commit()

    saved = db_session.query(ManualTranslationNovel).filter_by(folderName=folder).first()
    assert saved is not None
    assert saved.folderName == folder
    assert saved.source_url == "https://ncode.syosetu.com/n9999xx/"


def test_upsert_translations_preserves_empty_for_manual_novel(db_session, client):
    """
    일반 소설은 translated=''일 때 upsert 시 삭제/스킵되지만,
    ManualTranslationNovel로 등록된 소설은 translated='' 빈칸이 정상 보존되는지 검증.
    """
    manual_folder = "검열회피_보존소설"
    reg = ManualTranslationNovel(
        folderName=manual_folder,
        source_url="https://ncode.syosetu.com/n1111aa/",
        created_at=int(time.time())
    )
    db_session.add(reg)
    db_session.commit()

    # 1. 수동 번역 소설 데이터 upsert (translated='')
    items = [
        {
            "url": "https://ncode.syosetu.com/n1111aa/1/",
            "pid": "p1",
            "original": "これは検閲回避のテスト文章です。",
            "translated": "",  # 빈칸!
            "timestamp": int(time.time()),
            "folderName": manual_folder,
            "title": "제 1화",
            "toc_sort_order": 1
        }
    ]

    res = client.post("/translations/upsert", json=items)
    assert res.status_code == 200

    db_session.expire_all()
    # DB에 빈칸 번역문('') 상태로 정상 저장되었는지 확인
    saved = db_session.query(Translation).filter_by(
        url="https://ncode.syosetu.com/n1111aa/1/",
        pid="p1"
    ).first()
    assert saved is not None
    assert saved.original == "これは検閲回避のテスト文章です。"
    assert saved.translated == ""
    assert saved.folderName == manual_folder


def test_cleanup_trash_service_excludes_manual_novel(db_session):
    """
    복원센터/휴지통의 빈칸 감지기(get_cleanup_queue_data)에서
    ManualTranslationNovel에 등록된 소설의 translated='' 항목이 완전히 제외되는지 검증.
    """
    manual_folder = "휴지통_제외_수동소설"
    normal_folder = "일반_이상치_소설"

    # 수동 소설 등록
    db_session.add(ManualTranslationNovel(
        folderName=manual_folder,
        created_at=int(time.time())
    ))

    # 수동 소설 레코드 (빈칸 번역)
    db_session.add(Translation(
        url="https://ncode.syosetu.com/n2222bb/1/",
        pid="p1",
        original="手動翻訳のテキストです。",
        translated="",
        timestamp=int(time.time()),
        folderName=manual_folder,
        title="1화"
    ))

    # 일반 소설 레코드 (빈칸 번역 -> 이상치 감지 대상)
    db_session.add(Translation(
        url="https://ncode.syosetu.com/n3333cc/1/",
        pid="p1",
        original="一般小説のテキストです。",
        translated="",
        timestamp=int(time.time()),
        folderName=normal_folder,
        title="1화"
    ))
    db_session.commit()

    # get_cleanup_queue_data 호출
    cleanup_data = get_cleanup_queue_data(db_session)

    # 수동 소설은 정리 대기열에 절대 나타나지 않아야 함
    assert manual_folder not in cleanup_data
    # 일반 소설은 나타남
    assert normal_folder in cleanup_data


def test_save_manual_translations_with_review_completion(db_session, client):
    """
    수동 번역 저장 API 호출 시:
    1. folderName이 확실히 유지되어 미분류 보관함으로 들어가지 않는지
    2. 서재 검수완료(reviewed_service)가 즉시 자동 적용되는지 검증
    """
    folder = "직접_번역할_소설"
    ep_url = "https://ncode.syosetu.com/n4444dd/1/"

    # 원문 적재
    db_session.add(ManualTranslationNovel(
        folderName=folder,
        created_at=int(time.time())
    ))
    t1 = Translation(
        url=ep_url,
        pid="p1",
        original="日本語の第1文です。",
        translated="",
        timestamp=int(time.time()),
        folderName=folder,
        title="제 1화",
        toc_sort_order=1
    )
    t2 = Translation(
        url=ep_url,
        pid="p2",
        original="日本語の第2文です。",
        translated="",
        timestamp=int(time.time()),
        folderName=folder,
        title="제 1화",
        toc_sort_order=1
    )
    db_session.add_all([t1, t2])
    db_session.commit()

    # 수동 번역 저장 요청
    payload = {
        "url": ep_url,
        "folder_name": folder,
        "mark_as_reviewed": True,
        "items": [
            {"id": t1.id, "translated": "한국어 첫 번째 문장입니다."},
            {"id": t2.id, "translated": "한국어 두 번째 문장입니다."}
        ]
    }

    res = client.post("/api/collector/save_manual_translations", json=payload)
    assert res.status_code == 200
    data = res.json()
    assert data["success"] is True
    assert data["updated_count"] == 2
    assert data["is_chapter_reviewed"] is True

    # 1. DB 확인 (최신 커밋 반영 위해 expire_all)
    db_session.expire_all()
    reloaded_t1 = db_session.query(Translation).filter_by(id=t1.id).first()
    assert reloaded_t1.translated == "한국어 첫 번째 문장입니다."
    assert reloaded_t1.folderName == folder  # 미분류 방지 검증

    # 2. 서재 검수완료 레지스트리 확인
    assert reviewed_service.is_chapter_reviewed(ep_url, folder) is True


def test_collector_api_endpoints(client):
    """원문 수집기 라우터 및 상태/목록 엔드포인트 동작 검증"""
    # 1. 웹 UI 페이지 렌더링
    res = client.get("/raw_collector")
    assert res.status_code == 200
    assert "RAW NOVEL COLLECTOR" in res.text

    # 2. 상태 조회
    res_status = client.get("/api/collector/status")
    assert res_status.status_code == 200
    data_status = res_status.json()
    assert "status" in data_status
    assert "progress_percent" in data_status

    # 3. 등록된 수동 소설 목록
    res_novels = client.get("/api/collector/manual_novels")
    assert res_novels.status_code == 200
    assert "novels" in res_novels.json()


@patch("server.services.collector_service.requests.get")
def test_syosetu_toc_and_paragraph_scraper(mock_get):
    """소설가가 되자 목차 및 본문 파서 유닛 테스트"""
    # 1. 목차 HTML 목업
    toc_html = """
    <html>
      <head><title>테스트 소설 제목 - 小説家になろう</title></head>
      <body>
        <div class="p-novel__title">테스트 소설 제목</div>
        <div class="p-eplist__sublist">
          <a href="/n12345/1/">제 1화 프롤로그</a>
          <a href="/n12345/2/">제 2화 모험의 시작</a>
        </div>
      </body>
    </html>
    """
    mock_resp_toc = MagicMock()
    mock_resp_toc.text = toc_html
    mock_resp_toc.apparent_encoding = "utf-8"
    mock_resp_toc.raise_for_status = MagicMock()

    # 2. 본문 HTML 목업
    ep_html = """
    <html>
      <body>
        <div class="p-novel__title">제 1화 프롤로그</div>
        <div class="p-novel__body">
          <p id="L1">かつて世界には魔王がいた。</p>
          <p id="L2">勇者は立ち上がった。</p>
        </div>
      </body>
    </html>
    """
    mock_resp_ep = MagicMock()
    mock_resp_ep.text = ep_html
    mock_resp_ep.apparent_encoding = "utf-8"
    mock_resp_ep.raise_for_status = MagicMock()

    mock_get.side_effect = [mock_resp_toc, mock_resp_ep]

    # 목차 파싱 테스트
    title, episodes = fetch_toc_and_title("https://ncode.syosetu.com/n12345/")
    assert title == "테스트 소설 제목"
    assert len(episodes) == 2
    assert episodes[0]["title"] == "제 1화 프롤로그"
    assert episodes[0]["url"] == "https://ncode.syosetu.com/n12345/1/"

    # 본문 파싱 테스트
    ep_title, paragraphs = fetch_episode_paragraphs("https://ncode.syosetu.com/n12345/1/")
    assert ep_title == "제 1화 프롤로그"
    assert len(paragraphs) == 2
    assert paragraphs[0]["pid"] == "L1"
    assert paragraphs[0]["text"] == "かつて世界には魔王がいた。"
    assert paragraphs[1]["pid"] == "L2"
    assert paragraphs[1]["text"] == "勇者は立ち上がった。"

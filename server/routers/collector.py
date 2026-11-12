"""
collector.py: 원문 전용 수집기 및 수동 번역 스튜디오 라우터.
- 소설 목차 분석 및 백그라운드 수집 제어
- SSE 실시간 진행률 및 120초 쿨다운 스트림
- 수집 소설 목록 및 회차별 원문/수동 번역문 조회
- 수동 번역 저장 시 미분류 보관함 격리 원천 차단 및 서재 검수완료(✅ 검수완료) 자동 승격
"""

import asyncio
import json
import logging
import time
from typing import List, Optional

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, StreamingResponse
from fastapi.templating import Jinja2Templates
from pydantic import BaseModel
from sqlalchemy.orm import Session

import server.database as sdb
from server.models import ManualTranslationNovel, Translation
from server.services.collector_service import fetch_toc_and_title, raw_collector
from server.services.reviewed_service import reviewed_service

logger = logging.getLogger(__name__)
router = APIRouter(tags=["Raw Collector"])
templates = Jinja2Templates(directory="server/templates")


# ---------------------------------------------------------------------------
# Pydantic 요청 스키마
# ---------------------------------------------------------------------------

class PrepareRequest(BaseModel):
    url: str


class StartRequest(BaseModel):
    url: str
    custom_folder_name: Optional[str] = None
    folder_name: Optional[str] = None
    delay_sec: float = 2.5
    batch_size: int = 12
    rest_sec: int = 120
    skip_existing: bool = True


class SaveManualItem(BaseModel):
    id: int
    translated: str


class SaveManualTranslationRequest(BaseModel):
    url: str
    folder_name: str
    items: List[SaveManualItem]
    mark_as_reviewed: bool = True


# ---------------------------------------------------------------------------
# 웹 UI 렌더링
# ---------------------------------------------------------------------------

@router.get("/raw_collector", response_class=HTMLResponse)
def get_raw_collector_page(request: Request):
    """원문 전용 수집기 및 수동 번역 스튜디오 대시보드 페이지"""
    return templates.TemplateResponse("raw_collector.html", {"request": request})


# ---------------------------------------------------------------------------
# 수집기 제어 API
# ---------------------------------------------------------------------------

@router.post("/api/collector/prepare")
def prepare_collection(req: PrepareRequest, db: Session = Depends(sdb.get_db)):
    """목차를 분석하여 소설 제목, 전체 회차 수, 기수집 수 및 신규 수집 대상을 확인합니다."""
    url = (req.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="소설 목차 URL을 입력해주세요.")

    try:
        novel_title, episodes = fetch_toc_and_title(url)
    except Exception as e:
        logger.error(f"[Collector Prepare] Error fetching TOC: {e}")
        raise HTTPException(status_code=400, detail=f"목차를 가져오는 데 실패했습니다: {e}")

    # 기수집 회차 확인
    all_urls = [e["url"] for e in episodes]
    existing_urls = set()
    chunk_size = 500
    for i in range(0, len(all_urls), chunk_size):
        chunk = all_urls[i:i + chunk_size]
        rows = db.query(Translation.url).filter(Translation.url.in_(chunk)).distinct().all()
        for r in rows:
            existing_urls.add(r[0])
            existing_urls.add(r[0].rstrip('/'))

    existing_count = sum(1 for u in all_urls if u in existing_urls or u.rstrip('/') in existing_urls)
    new_count = len(episodes) - existing_count

    return {
        "success": True,
        "clean_url": url,
        "url": url,
        "title": novel_title,
        "novel_title": novel_title,
        "folder_name": novel_title,
        "total_episodes": len(episodes),
        "existing_episodes": existing_count,
        "existing_count": existing_count,
        "new_episodes": new_count,
        "new_count": new_count,
        "episodes": episodes[:30],  # 상위 30개 미리보기
        "has_more": len(episodes) > 30
    }


@router.post("/api/collector/start")
def start_collection(req: StartRequest):
    """원문 수집 백그라운드 작업을 시작합니다."""
    url = (req.url or "").strip()
    if not url:
        raise HTTPException(status_code=400, detail="소설 URL을 입력해주세요.")

    folder_to_use = (req.custom_folder_name or req.folder_name or "").strip() or None

    try:
        result = raw_collector.start_collection(
            novel_url=url,
            custom_folder_name=folder_to_use,
            delay_sec=req.delay_sec,
            batch_size=req.batch_size,
            rest_sec=req.rest_sec,
            skip_existing=req.skip_existing
        )
        return result
    except RuntimeError as ex:
        raise HTTPException(status_code=409, detail=str(ex))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"수집 시작 실패: {e}")


@router.post("/api/collector/stop")
def stop_collection():
    """진행 중인 원문 수집 작업을 안전하게 중지합니다."""
    raw_collector.stop()
    return {"success": True, "message": "수집 중지 신호를 보냈습니다."}


@router.get("/api/collector/status")
def get_collector_status():
    """현재 원문 수집기의 실시간 상태를 조회합니다."""
    return raw_collector.get_state()


@router.get("/api/collector/stream")
async def stream_collector_events():
    """수집기 실시간 SSE(Server-Sent Events) 이벤트 스트림."""
    queue = asyncio.Queue()
    raw_collector.add_listener(queue)

    async def event_generator():
        try:
            # 초기 상태 1회 즉시 전송
            initial_state = raw_collector.get_state()
            initial_state["event"] = "init"
            yield f"data: {json.dumps(initial_state, ensure_ascii=False)}\n\n"

            while True:
                data = await queue.get()
                yield data
        except asyncio.CancelledError:
            pass
        finally:
            raw_collector.remove_listener(queue)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no"
        }
    )


# ---------------------------------------------------------------------------
# 수동 번역 스튜디오 (Manual Translation Studio) API
# ---------------------------------------------------------------------------

@router.get("/api/collector/manual_novels")
def list_manual_novels(db: Session = Depends(sdb.get_db)):
    """수동 번역(검열 회피) 레지스트리에 등록된 소설 목록과 통계를 조회합니다."""
    novels = db.query(ManualTranslationNovel).order_by(ManualTranslationNovel.created_at.desc()).all()
    results = []

    for n in novels:
        folder = n.folderName
        # 전체 문단 수 및 번역 완료된 문단 수 조회
        total_p = db.query(Translation).filter_by(folderName=folder).count()
        translated_p = db.query(Translation).filter(
            Translation.folderName == folder,
            Translation.translated.isnot(None),
            Translation.translated != ""
        ).count()

        # 전체 회차 수 및 검수완료 여부
        distinct_urls = [r[0] for r in db.query(Translation.url).filter_by(folderName=folder).distinct().all()]
        total_eps = len(distinct_urls)
        reviewed_eps = sum(1 for u in distinct_urls if reviewed_service.is_chapter_reviewed(u, folder))
        is_book_reviewed = reviewed_service.is_book_reviewed(folder)

        results.append({
            "id": n.id,
            "folderName": folder,
            "source_url": n.source_url,
            "created_at": n.created_at,
            "total_paragraphs": total_p,
            "translated_paragraphs": translated_p,
            "translation_percent": round(translated_p / total_p * 100, 1) if total_p > 0 else 0,
            "total_episodes": total_eps,
            "reviewed_episodes": reviewed_eps,
            "is_book_reviewed": is_book_reviewed
        })

    return {"novels": results}


@router.get("/api/collector/episodes")
def list_novel_episodes(folder_name: str, db: Session = Depends(sdb.get_db)):
    """지정된 소설 폴더의 회차 목록 및 각 회차의 수동 번역/검수완료 상태를 반환합니다."""
    folder = folder_name.strip()
    if not folder:
        raise HTTPException(status_code=400, detail="소설 폴더명을 지정해주세요.")

    # URL별 대표 제목, 목차 순서, 문단 수 집계
    from sqlalchemy import func, case
    rows = (
        db.query(
            Translation.url,
            func.min(Translation.title).label("title"),
            func.min(Translation.toc_sort_order).label("sort_order"),
            func.count(Translation.id).label("total_p"),
            func.sum(
                case(
                    (Translation.translated.isnot(None) & (Translation.translated != ""), 1),
                    else_=0
                )
            ).label("trans_p")
        )
        .filter(Translation.folderName == folder)
        .group_by(Translation.url)
        .order_by(func.min(Translation.toc_sort_order).asc(), Translation.url.asc())
        .all()
    )

    episodes = []
    for r in rows:
        url = r[0]
        title = r[1] or url
        sort_order = r[2] or 999999
        total_p = r[3] or 0
        trans_p = r[4] or 0
        is_reviewed = reviewed_service.is_chapter_reviewed(url, folder)

        episodes.append({
            "url": url,
            "title": title,
            "sort_order": sort_order,
            "total_paragraphs": total_p,
            "translated_paragraphs": trans_p,
            "is_completed": (total_p > 0 and trans_p >= total_p),
            "is_reviewed": is_reviewed
        })

    return {"folder_name": folder, "episodes": episodes}


@router.get("/api/collector/episode_content")
def get_episode_content(url: str, db: Session = Depends(sdb.get_db)):
    """특정 회차 URL의 모든 문단(원문 및 번역문)을 조회합니다."""
    clean_url = url.strip()
    if not clean_url:
        raise HTTPException(status_code=400, detail="회차 URL을 지정해주세요.")

    records = (
        db.query(Translation)
        .filter_by(url=clean_url)
        .order_by(Translation.id.asc())
        .all()
    )

    if not records:
        raise HTTPException(status_code=404, detail="해당 회차의 문단 데이터를 찾을 수 없습니다.")

    folder_name = records[0].folderName or ""
    ep_title = records[0].title or clean_url
    is_reviewed = reviewed_service.is_chapter_reviewed(clean_url, folder_name)

    items = []
    for rec in records:
        items.append({
            "id": rec.id,
            "pid": rec.pid,
            "original": rec.original,
            "translated": rec.translated or "",
            "folderName": rec.folderName,
            "title": rec.title
        })

    return {
        "url": clean_url,
        "folder_name": folder_name,
        "episode_title": ep_title,
        "is_reviewed": is_reviewed,
        "items": items
    }


@router.post("/api/collector/save_manual_translations")
def save_manual_translations(req: SaveManualTranslationRequest, db: Session = Depends(sdb.get_db)):
    """
    사용자가 직접 수동 번역한 문장들을 저장합니다.
    - 미분류 보관함 유입 원천 차단: 지정된 folder_name을 100% 영구 보존
    - 서재 검수완료 연동: 사용자가 수동 번역을 마쳤으므로 서재 검수완료(✅ 검수완료) 자동 승격
    """
    clean_url = req.url.strip()
    folder_name = req.folder_name.strip()

    if not clean_url or not folder_name:
        raise HTTPException(status_code=400, detail="URL과 소설 폴더명이 필요합니다.")

    if not req.items:
        raise HTTPException(status_code=400, detail="저장할 번역 문장이 없습니다.")

    # 1. 문장들 업데이트
    now = int(time.time())
    updated_count = 0

    for it in req.items:
        trans_text = (it.translated or "").strip()
        record = db.query(Translation).filter_by(id=it.id).first()
        if record:
            record.translated = trans_text
            record.folderName = folder_name  # 미분류 방지 영구 귀속
            record.timestamp = now
            updated_count += 1

    db.commit()

    # 2. 서재 검수완료 기능 자동 적용
    book_promoted = False
    is_chapter_reviewed = False

    if req.mark_as_reviewed:
        # 해당 소설의 모든 회차 URL 목록 조회
        all_novel_urls = [
            r[0] for r in db.query(Translation.url).filter_by(folderName=folder_name).distinct().all()
        ]
        rev_res = reviewed_service.set_chapter_reviewed(
            url=clean_url,
            is_reviewed=True,
            folder_name=folder_name,
            all_book_urls=all_novel_urls
        )
        is_chapter_reviewed = rev_res.get("is_chapter_reviewed", True)
        book_promoted = rev_res.get("book_promoted", False)
        logger.info(f"[ManualTranslation] '{clean_url}' 회차 검수완료 자동 적용 완료 (도서 승격: {book_promoted})")

    return {
        "success": True,
        "updated_count": updated_count,
        "folder_name": folder_name,
        "url": clean_url,
        "is_chapter_reviewed": is_chapter_reviewed,
        "book_promoted": book_promoted,
        "message": (
            f"🎉 {updated_count}개 문장이 '{folder_name}' 소설에 안전하게 저장되었으며, "
            f"서재 검수완료(✅) 상태가 적용되었습니다!"
            + (" (소설 전체 검수완료 승격!)" if book_promoted else "")
        )
    }


# ============================================================================
# hdTrans 오프라인 초벌 번역기 연동 엔드포인트
# ============================================================================

from server.services import hdtrans_service


class HdTransEpisodeRequest(BaseModel):
    folder_name: str
    url: str
    overwrite: bool = False


class HdTransNovelRequest(BaseModel):
    folder_name: str
    overwrite: bool = False


@router.post("/api/collector/hdtrans/episode")
def hdtrans_translate_episode(req: HdTransEpisodeRequest, db: Session = Depends(sdb.get_db)):
    """특정 회차 단건 hdTrans 초벌 번역 실행"""
    folder = req.folder_name.strip()
    url = req.url.strip()
    if not folder or not url:
        raise HTTPException(status_code=400, detail="소설 폴더명과 회차 URL이 필요합니다.")

    if not hdtrans_service.is_hdtrans_available():
        raise HTTPException(status_code=500, detail="hdTrans 실행 파일(hdtrans.exe)을 찾을 수 없습니다.")

    try:
        count = hdtrans_service.translate_episode_in_db(
            db=db,
            folder_name=folder,
            url=url,
            overwrite=req.overwrite,
        )
        return {
            "status": "success",
            "translated_count": count,
            "folder_name": folder,
            "url": url,
            "message": f"⚡ {count}개 문단 초벌 번역 완료"
        }
    except Exception as e:
        logger.error(f"[hdTrans] 단건 회차 번역 오류: {e}")
        raise HTTPException(status_code=500, detail=f"초벌 번역 실패: {str(e)}")


@router.post("/api/collector/hdtrans/start")
def hdtrans_start_novel(req: HdTransNovelRequest):
    """소설 전체 백그라운드 초벌 번역 작업 가동"""
    folder = req.folder_name.strip()
    if not folder:
        raise HTTPException(status_code=400, detail="소설 폴더명이 필요합니다.")

    if not hdtrans_service.is_hdtrans_available():
        raise HTTPException(status_code=500, detail="hdTrans 실행 파일(hdtrans.exe)을 찾을 수 없습니다.")

    try:
        hdtrans_service.hdtrans_runner.start_novel_translation(
            folder_name=folder,
            overwrite=req.overwrite,
        )
        return {
            "status": "started",
            "message": f"⚡ '{folder}' 소설의 초벌 번역 작업이 백그라운드에서 가동되었습니다."
        }
    except RuntimeError as re:
        raise HTTPException(status_code=409, detail=str(re))
    except Exception as e:
        logger.error(f"[hdTrans] 소설 일괄 번역 시작 오류: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/api/collector/hdtrans/stop")
def hdtrans_stop():
    """진행 중인 초벌 번역 작업 안전 중지"""
    hdtrans_service.hdtrans_runner.stop()
    return {"status": "stopped", "message": "초벌 번역 작업 중지가 요청되었습니다."}


@router.get("/api/collector/hdtrans/status")
def hdtrans_status():
    """초벌 번역 러너의 현재 상태 및 실시간 로그/통계 조회"""
    return hdtrans_service.hdtrans_runner.get_status()


@router.get("/api/collector/check_extension_excluded")
def check_extension_excluded(url: str = "", db: Session = Depends(sdb.get_db)):
    """
    현재 URL이 원문 수집기 전용(검열 회피/수동 번역) 소설에 속하는지 검사.
    확장 프로그램이 해당 소설을 인식하지 못하도록 조기 차단하기 위한 엔드포인트.
    """
    if not url or not url.strip():
        return {"excluded": False}

    clean_url = url.split("?")[0].split("#")[0].rstrip("/")

    # 1. ManualTranslationNovel의 source_url 확인
    manual_novels = db.query(ManualTranslationNovel).all()
    for n in manual_novels:
        if not n.source_url:
            continue
        clean_source = n.source_url.split("?")[0].split("#")[0].rstrip("/")
        # 목차 URL이거나 회차 URL의 prefix인 경우
        if clean_url == clean_source or clean_url.startswith(clean_source + "/"):
            return {
                "excluded": True,
                "folder_name": n.folderName,
                "reason": "manual_collector_novel",
                "source_url": n.source_url
            }

        # 2. 해당 소설의 translations 테이블에 이미 적재된 회차 URL인지 확인
        exists = db.query(Translation.id).filter(
            Translation.folderName == n.folderName,
            Translation.url.like(clean_url + "%")
        ).first()
        if exists:
            return {
                "excluded": True,
                "folder_name": n.folderName,
                "reason": "manual_collector_novel_episode"
            }

    return {"excluded": False}



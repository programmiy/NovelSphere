"""
Corpus AI Engine API Router.
Provides endpoints for offline EBMT synthesis, real-time contextual autocomplete,
style/tone consistency checking, and corpus index metadata.
100% deterministic, rule-based & SQLite queries. No external AI APIs.
"""

from typing import Optional, List, Dict, Any
from fastapi import APIRouter, Query, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from server.services.corpus_ai_service import (
    synthesize_translation,
    suggest_next_phrase,
    check_style_consistency,
    sync_translation_to_corpus,
)
from server.database_corpus import corpus_db_connection

router = APIRouter(prefix="/api/corpus-ai", tags=["Corpus AI Engine"])


# --- Request & Response Models ---

class SynthesizeRequest(BaseModel):
    original: str = Field(..., description="번역 대상 일본어 원문 문장")
    folderName: Optional[str] = Field(None, description="소설 식별 폴더명 (우선 가중치용)")


class SynthesizeResponse(BaseModel):
    synthesized_text: str
    tier_used: str
    coverage_percent: float
    confidence: float
    source_example: Optional[Dict[str, Any]] = None
    matched_phrases: List[Dict[str, Any]] = []


class StyleCheckRequest(BaseModel):
    original: str = Field(..., description="일본어 원문 문장")
    translated: str = Field(..., description="작성/번역된 한국어 문장")
    folderName: Optional[str] = Field(None, description="소설 식별 폴더명")


class StyleCheckResponse(BaseModel):
    status: str
    color: str
    score: float
    detected_ja_ending: str
    current_ko_ending: str
    recommended_ko_ending: str
    reason: str


class SyncRequest(BaseModel):
    original: str
    translated: str
    folderName: Optional[str] = None


# --- Endpoints ---

@router.post(
    "/synthesize",
    response_model=SynthesizeResponse,
    summary="2-Tier EBMT 기계번역 합성",
    description="34만 코퍼스 기반으로 75%+ 유사 문장 템플릿(Tier 1) 또는 구문 스티칭(Tier 2)으로 초안을 합성합니다."
)
def api_synthesize_translation(req: SynthesizeRequest):
    return synthesize_translation(original=req.original, folder_name=req.folderName)


@router.get(
    "/autocomplete",
    summary="문맥 인식형 고스트 텍스트 자동완성",
    description="입력 중인 한국어 접두사(prefix)와 일본어 원문을 대조하여 다음에 올 유력한 표현을 반환합니다."
)
def api_autocomplete(
    original: str = Query(..., description="현재 번역 중인 일본어 원문"),
    prefix: str = Query(..., description="현재까지 입력된 한국어 텍스트"),
    folderName: Optional[str] = Query(None, description="소설 식별 폴더명")
):
    return suggest_next_phrase(original=original, prefix=prefix, folder_name=folderName)


@router.post(
    "/style-check",
    response_model=StyleCheckResponse,
    summary="스타일 및 어투 일관성 검사",
    description="원문의 종결어미 대비 작성된 한국어 종결어미의 일치율(🟢/🟡/🔴)과 소설 내 추천 어미를 반환합니다."
)
def api_style_check(req: StyleCheckRequest):
    return check_style_consistency(
        original=req.original,
        translated=req.translated,
        folder_name=req.folderName
    )


@router.post(
    "/sync",
    summary="코퍼스 색인 실시간 증분 학습",
    description="수동 교정 또는 신규 번역 문장을 corpus_ai.db에 즉시 반영합니다."
)
def api_sync_translation(req: SyncRequest, background_tasks: BackgroundTasks):
    background_tasks.add_task(
        sync_translation_to_corpus,
        original=req.original,
        translated=req.translated,
        folder_name=req.folderName
    )
    return {"status": "queued", "message": "Background incremental sync scheduled"}


@router.get(
    "/stats",
    summary="코퍼스 AI 인덱스 현황 조회",
    description="corpus_ai.db의 템플릿 수, 정렬 구문 수, 종결어미 통계 수 및 최종 색인 일시를 반환합니다."
)
def api_corpus_stats():
    with corpus_db_connection(as_dict=True) as conn:
        cursor = conn.cursor()
        
        cursor.execute("SELECT key, value FROM corpus_meta;")
        meta_rows = cursor.fetchall()
        meta = {r["key"]: r["value"] for r in meta_rows}

        cursor.execute("SELECT count(*) as cnt FROM corpus_templates;")
        t_count = cursor.fetchone()["cnt"]

        cursor.execute("SELECT count(*) as cnt FROM corpus_phrase_alignments;")
        p_count = cursor.fetchone()["cnt"]

        cursor.execute("SELECT count(*) as cnt FROM corpus_tone_stats;")
        tone_count = cursor.fetchone()["cnt"]

        return {
            "version": meta.get("version", "1.0.0"),
            "last_indexed_at": meta.get("last_indexed_at"),
            "source_total_sentences": int(meta.get("source_total_sentences", 0)),
            "total_templates": t_count,
            "total_phrase_alignments": p_count,
            "total_tone_stats": tone_count,
            "is_ready": t_count > 0 and p_count > 0
        }

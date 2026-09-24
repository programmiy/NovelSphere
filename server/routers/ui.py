import os
from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from typing import Optional
from server.settings import settings

router = APIRouter()
templates = Jinja2Templates(directory=settings.templates_dir)

@router.get(
    "/book",
    tags=["UI"],
    summary="책 UI 페이지",
    description="책 UI 웹페이지를 렌더링합니다."
)
async def read_book_ui(request: Request):
    return templates.TemplateResponse("book_ui.html", {"request": request})

@router.get(
    "/viewer",
    tags=["UI"],
    summary="뷰어 UI 페이지",
    description="로컬 뷰어 웹페이지를 렌더링합니다."
)
async def read_viewer_ui(request: Request, book: Optional[str] = None):
    return templates.TemplateResponse("viewer.html", {"request": request, "book_name": book})

@router.get(
    "/admin",
    tags=["UI"],
    summary="관리자 UI 페이지",
    description="관리자 UI 웹페이지를 렌더링합니다."
)
async def read_admin_ui(request: Request):
    response = templates.TemplateResponse("admin.html", {"request": request})
    response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
    return response

@router.get(
    "/logs",
    tags=["UI"],
    summary="로그 뷰어 UI 페이지",
    description="로그 뷰어 웹페이지를 렌더링합니다."
)
async def read_logs_ui(request: Request):
    return templates.TemplateResponse("log_viewer.html", {"request": request})

import re

def is_mobile_request(request: Request) -> bool:
    # 1. Query parameter override (?view=mobile or ?view=pc)
    view_param = request.query_params.get("view", "").lower()
    if view_param == "mobile":
        return True
    if view_param == "pc":
        return False

    # 2. Cookie override
    cookie_mode = request.cookies.get("lanovel_view_mode", "").lower()
    if cookie_mode == "mobile":
        return True
    if cookie_mode == "pc":
        return False

    # 3. User-Agent detection
    ua = request.headers.get("user-agent", "")
    return bool(re.search(r'Mobile|Android|iPhone|iPad|iPod|BlackBerry|IEMobile|Opera Mini', ua, re.I))

def serve_library_view(request: Request):
    is_mobile = is_mobile_request(request)
    template_name = "library_mobile.html" if is_mobile else "library.html"
    response = templates.TemplateResponse(template_name, {"request": request, "is_mobile": is_mobile})
    
    # If explicit view query parameter was passed, persist to cookie
    view_param = request.query_params.get("view", "").lower()
    if view_param in ("mobile", "pc"):
        response.set_cookie(key="lanovel_view_mode", value=view_param, max_age=60*60*24*365)
    return response

@router.get(
    "/library",
    tags=["UI"],
    summary="서재 UI 페이지",
    description="'서재' UI 웹페이지를 렌더링합니다. (루트의 별칭)"
)
async def read_library_ui_alias(request: Request):
    return serve_library_view(request)

@router.get(
    "/m",
    tags=["UI"],
    summary="모바일 전용 서재 UI",
    description="모바일 전용 서재 웹페이지를 렌더링합니다."
)
async def read_mobile_library(request: Request):
    response = templates.TemplateResponse("library_mobile.html", {"request": request, "is_mobile": True})
    response.set_cookie(key="lanovel_view_mode", value="mobile", max_age=60*60*24*365)
    return response

@router.get(
    "/",
    tags=["UI"],
    summary="루트 페이지 (서재 UI)",
    description="'서재' UI 웹페이지를 렌더링합니다. 모바일 접속 시 모바일 전용 뷰가 서빙됩니다."
)
async def read_root(request: Request):
    return serve_library_view(request)
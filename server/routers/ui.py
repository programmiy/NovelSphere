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
    return templates.TemplateResponse("admin.html", {"request": request})

@router.get(
    "/logs",
    tags=["UI"],
    summary="로그 뷰어 UI 페이지",
    description="로그 뷰어 웹페이지를 렌더링합니다."
)
async def read_logs_ui(request: Request):
    return templates.TemplateResponse("log_viewer.html", {"request": request})

@router.get(
    "/library",
    tags=["UI"],
    summary="서재 UI 페이지",
    description="'서재' UI 웹페이지를 렌더링합니다. (루트의 별칭)"
)
async def read_library_ui_alias(request: Request):
    return templates.TemplateResponse("library.html", {"request": request})

@router.get(
    "/",
    tags=["UI"],
    summary="루트 페이지 (서재 UI)",
    description="'서재' UI 웹페이지를 렌더링합니다."
)
async def read_root(request: Request):
    return templates.TemplateResponse("library.html", {"request": request})
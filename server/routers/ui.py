import os
from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from typing import Optional
from server.settings import settings

router = APIRouter()
templates = Jinja2Templates(directory=settings.templates_dir)

@router.get("/book")
async def read_book_ui(request: Request):
    """책 UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("book_ui.html", {"request": request})

@router.get("/viewer")
async def read_viewer_ui(request: Request, book: Optional[str] = None):
    """로컬 뷰어 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("viewer.html", {"request": request, "book_name": book})

@router.get("/admin")
async def read_admin_ui(request: Request):
    """관리자 UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("admin.html", {"request": request})

@router.get("/logs")
async def read_logs_ui(request: Request):
    """로그 뷰어 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("log_viewer.html", {"request": request})

@router.get("/library")
async def read_library_ui_alias(request: Request):
    """'서재' UI 웹페이지를 렌더링합니다. (루트의 별칭)"""
    return templates.TemplateResponse("library.html", {"request": request})

@router.get("/")
async def read_root(request: Request):
    """'서재' UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse("library.html", {"request": request})
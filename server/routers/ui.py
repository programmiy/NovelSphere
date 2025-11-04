import os
from fastapi import APIRouter, Request
from fastapi.templating import Jinja2Templates
from typing import Optional

# Determine the correct path to the 'templates' directory
# This goes up one level from /routers to /server, then into /templates
script_dir = os.path.dirname(__file__)
templates_dir = os.path.join(script_dir, "..", "templates")

router = APIRouter()
templates = Jinja2Templates(directory=templates_dir)

@router.get("/book")
async def read_book_ui(request: Request):
    """책 UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse(request, "book_ui.html")

@router.get("/viewer")
async def read_viewer_ui(request: Request, book: Optional[str] = None):
    """로컬 뷰어 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse(request, "viewer.html", {"book_name": book})

@router.get("/admin")
async def read_admin_ui(request: Request):
    """관리자 UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse(request, "admin.html")

@router.get("/logs")
async def read_logs_ui(request: Request):
    """로그 뷰어 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse(request, "log_viewer.html")

@router.get("/library")
async def read_library_ui_alias(request: Request):
    """'서재' UI 웹페이지를 렌더링합니다. (루트의 별칭)"""
    return templates.TemplateResponse(request, "library.html")

@router.get("/")
async def read_root(request: Request):
    """'서재' UI 웹페이지를 렌더링합니다."""
    return templates.TemplateResponse(request, "library.html")

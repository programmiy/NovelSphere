import os
import json
import logging
from typing import Set, Dict, Optional, Any, List

logger = logging.getLogger(__name__)

# 운영 DB 파일을 절대 건드리지 않고 상태를 영구 보존하는 전용 안전 레지스트리 경로
REGISTRY_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), "reviewed_registry.json")

class ReviewedRegistryService:
    """
    운영 translations.db 파일의 파손/잠금 위험 없이
    도서 및 챕터 단위의 '검수완료 (수정 잠금)' 상태를 안전하게 관리하는 서비스입니다.
    """
    def __init__(self, file_path: str = REGISTRY_PATH):
        self.file_path = file_path
        self._reviewed_books: Set[str] = set()
        self._reviewed_chapters: Set[str] = set()
        self._load()

    def _load(self):
        if not os.path.exists(self.file_path):
            self._reviewed_books = set()
            self._reviewed_chapters = set()
            self._save()
            return

        try:
            with open(self.file_path, "r", encoding="utf-8") as f:
                data = json.load(f)
                self._reviewed_books = set(data.get("reviewed_books", []))
                self._reviewed_chapters = set(data.get("reviewed_chapters", []))
        except Exception as e:
            logger.error(f"[ReviewedRegistry] Failed to load registry from {self.file_path}: {e}")
            self._reviewed_books = set()
            self._reviewed_chapters = set()

    def _save(self):
        try:
            tmp_path = self.file_path + ".tmp"
            data = {
                "reviewed_books": sorted(list(self._reviewed_books)),
                "reviewed_chapters": sorted(list(self._reviewed_chapters)),
            }
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.file_path)
        except Exception as e:
            logger.error(f"[ReviewedRegistry] Failed to save registry to {self.file_path}: {e}")

    def is_book_reviewed(self, folder_name: str) -> bool:
        """도서 전체가 검수완료(잠금) 상태인지 확인합니다."""
        if not folder_name:
            return False
        return folder_name in self._reviewed_books

    def is_chapter_reviewed(self, url: str, folder_name: Optional[str] = None) -> bool:
        """
        특정 챕터(회차)가 검수완료(잠금) 상태인지 확인합니다.
        소설 전체가 검수완료 상태이거나 해당 챕터 URL이 개별 검수완료 상태이면 True를 반환합니다.
        """
        if folder_name and folder_name in self._reviewed_books:
            return True
        if not url:
            return False
        # URL 정규화 (후행 슬래시 제거 등 유연한 비교)
        cleaned_url = url.rstrip('/')
        return url in self._reviewed_chapters or cleaned_url in self._reviewed_chapters

    def get_reviewed_books(self) -> Set[str]:
        return set(self._reviewed_books)

    def get_reviewed_chapters(self) -> Set[str]:
        return set(self._reviewed_chapters)

    def set_book_reviewed(self, folder_name: str, is_reviewed: bool, chapter_urls: Optional[List[str]] = None) -> bool:
        """
        도서 전체 검수완료 상태를 토글합니다.
        도서 전체 ON 시: 하위 모든 챕터 URL도 일괄 검수완료 등록
        도서 전체 OFF 시: 도서 및 하위 모든 챕터 URL 잠금 해제
        """
        if not folder_name:
            return False

        if is_reviewed:
            self._reviewed_books.add(folder_name)
            if chapter_urls:
                for u in chapter_urls:
                    if u:
                        self._reviewed_chapters.add(u)
                        self._reviewed_chapters.add(u.rstrip('/'))
        else:
            self._reviewed_books.discard(folder_name)
            if chapter_urls:
                for u in chapter_urls:
                    if u:
                        self._reviewed_chapters.discard(u)
                        self._reviewed_chapters.discard(u.rstrip('/'))

        self._save()
        return True

    def set_chapter_reviewed(self, url: str, is_reviewed: bool, folder_name: Optional[str] = None, all_book_urls: Optional[List[str]] = None) -> Dict[str, Any]:
        """
        개별 챕터 검수완료 상태를 토글합니다.
        모든 챕터가 검수완료되면 도서 전체도 자동으로 검수완료 승격합니다.
        """
        if not url:
            return {"success": False, "is_chapter_reviewed": False, "is_book_reviewed": False}

        cleaned_url = url.rstrip('/')
        if is_reviewed:
            self._reviewed_chapters.add(url)
            self._reviewed_chapters.add(cleaned_url)
        else:
            self._reviewed_chapters.discard(url)
            self._reviewed_chapters.discard(cleaned_url)
            # 회차 잠금이 하나라도 풀리면 도서 전체 검수완료 상태도 자동 해제
            if folder_name and folder_name in self._reviewed_books:
                self._reviewed_books.discard(folder_name)

        # 모든 챕터가 검수 완료되었는지 검사하여 도서 전체 검수완료 자동 승격
        book_promoted = False
        if is_reviewed and folder_name and all_book_urls and len(all_book_urls) > 0:
            all_done = all((u in self._reviewed_chapters or u.rstrip('/') in self._reviewed_chapters) for u in all_book_urls if u)
            if all_done:
                self._reviewed_books.add(folder_name)
                book_promoted = True

        self._save()
        return {
            "success": True,
            "url": url,
            "is_chapter_reviewed": is_reviewed,
            "is_book_reviewed": (folder_name in self._reviewed_books) if folder_name else False,
            "book_promoted": book_promoted
        }

reviewed_service = ReviewedRegistryService()

"""Read-only LANOVEL book-cover brief lookup and frontispiece registration helper.

Reuses read-only DB opening, GPU/ComfyUI diagnostics, and LANOVEL server
registration from novel-illustration's novel_scene_helper without duplicating logic.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import sqlite3
import sys
from pathlib import Path
from typing import Any

_SCENE_HELPER_PATH = (
    Path(__file__).resolve().parents[2]
    / "novel-illustration"
    / "scripts"
    / "novel_scene_helper.py"
)


def _load_scene_helper():
    """Load shared read-only DB and environment helpers from novel_scene_helper."""
    spec = importlib.util.spec_from_file_location("_lanovel_scene_helper_shared", _SCENE_HELPER_PATH)
    if spec is None or spec.loader is None:
        raise ImportError(f"공유 헬퍼를 로드할 수 없습니다: {_SCENE_HELPER_PATH}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules["_lanovel_scene_helper_shared"] = mod
    spec.loader.exec_module(mod)
    return mod


_shared = _load_scene_helper()
DEFAULT_DB_PATH = _shared.DEFAULT_DB_PATH
DEFAULT_COMFY_URL = _shared.DEFAULT_COMFY_URL
DEFAULT_LANOVEL_URL = _shared.DEFAULT_LANOVEL_URL
DEFAULT_CHARACTERS_PATH = _shared.DEFAULT_CHARACTERS_PATH
open_readonly_db = _shared.open_readonly_db
list_books = _shared.list_books
list_chapters = _shared.list_chapters
extract_scene = _shared.extract_scene
check_environment = _shared.check_environment
register_illustration = _shared.register_illustration
load_character_registry = _shared.load_character_registry
save_character_anchor = _shared.save_character_anchor
list_character_anchors = _shared.list_character_anchors
add_character_subparsers = _shared.add_character_subparsers
handle_character_command = _shared.handle_character_command


def get_cover_brief(
    conn: sqlite3.Connection,
    book: str,
    sample_chapters: int = 2,
    lines_per_chapter: int = 25,
) -> dict[str, Any]:
    """Assemble synopsis, tags, chapter outline, and opening lines for cover design."""
    chapters = list_chapters(conn, book=book, limit=1000)
    if not chapters:
        raise ValueError(f"소설 '{book}'의 회차 데이터를 찾을 수 없습니다.")

    summary = ""
    notes = ""
    summary_source_url = ""
    try:
        act = conn.execute(
            """
            SELECT notes, summary, summary_source_url
            FROM book_activity
            WHERE folderName = ?
            LIMIT 1
            """,
            (book,),
        ).fetchone()
        if act:
            notes = (act["notes"] or "").strip()
            summary = (act["summary"] or "").strip()
            summary_source_url = (act["summary_source_url"] or "").strip()
    except sqlite3.OperationalError:
        pass

    tags: list[str] = []
    try:
        tag_rows = conn.execute(
            """
            SELECT t.name
            FROM tags t
            JOIN book_tags bt ON bt.tag_id = t.id
            WHERE bt.book_folderName = ?
            ORDER BY t.name ASC
            """,
            (book,),
        ).fetchall()
        tags = [str(r["name"]).strip() for r in tag_rows if (r["name"] or "").strip()]
    except sqlite3.OperationalError:
        pass

    opening_excerpts: list[dict[str, Any]] = []
    for ch in chapters[: max(1, sample_chapters)]:
        scene = extract_scene(
            conn,
            book=book,
            url=ch["url"],
            limit=max(1, lines_per_chapter),
        )
        opening_excerpts.append(
            {
                "index": ch["index"],
                "title": ch["title"],
                "url": ch["url"],
                "lines": scene["lines"],
            }
        )

    return {
        "book": book,
        "total_chapters": len(chapters),
        "tags": tags,
        "summary": summary,
        "notes": notes,
        "summary_source_url": summary_source_url,
        "first_chapters": [
            {"index": c["index"], "title": c["title"], "url": c["url"], "sentences": c["sentences"]}
            for c in chapters[:5]
        ],
        "opening_excerpts": opening_excerpts,
    }


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser for novel cover preparation."""
    parser = argparse.ArgumentParser(
        description="LANOVEL Read-Only 소설 표지 브리프 조회 및 환경 점검 도구"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_env = sub.add_parser("env-check", help="GPU 온도, 커밋 메모리, ComfyUI 상태 점검")
    p_env.add_argument("--server", default=DEFAULT_COMFY_URL, help="ComfyUI 서버 주소")
    p_env.add_argument("--json", action="store_true", help="JSON 형식으로 출력")

    p_books = sub.add_parser("books", help="DB 내 소설 목록 조회 (읽기 전용)")
    p_books.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB 경로")
    p_books.add_argument("--search", default="", help="소설 제목 검색어")
    p_books.add_argument("--limit", type=int, default=50, help="최대 표시 건수")

    p_brief = sub.add_parser("brief", help="표지 구상을 위한 줄거리·태그·초반 회차 추출 (읽기 전용)")
    p_brief.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB 경로")
    p_brief.add_argument("--book", required=True, help="소설 폴더명(folderName)")
    p_brief.add_argument("--chapters", type=int, default=2, help="추출할 초반 회차 수 (기본 2)")
    p_brief.add_argument("--lines", type=int, default=25, help="회차당 최대 문장 수 (기본 25)")
    p_brief.add_argument("--json", action="store_true", help="JSON 형식으로 출력")

    p_reg = sub.add_parser(
        "register-frontispiece",
        help="완성된 표지 아트를 지정 회차 최상단(TOP) 권두 삽화로 등록",
    )
    p_reg.add_argument("--server", default=DEFAULT_LANOVEL_URL, help="LANOVEL 서버 주소")
    p_reg.add_argument("--book", required=True, help="소설 폴더명(book_name)")
    p_reg.add_argument("--image", type=Path, required=True, help="등록할 PNG/JPG/WEBP 경로")
    p_reg.add_argument("--chapter-url", default="", help="대상 회차 URL (보통 1화 URL)")
    p_reg.add_argument("--chapter-title", default="", help="대상 회차 제목 (URL 미지정 시)")
    p_reg.add_argument("--after-pid", default="TOP", help="삽입 위치 PID (기본 TOP)")
    p_reg.add_argument("--caption", default="표지 일러스트", help="표시 캡션")
    p_reg.add_argument("--base64", action="store_true", help="Base64 전송 강제")
    p_reg.add_argument("--json", action="store_true", help="JSON 형식으로 출력")

    add_character_subparsers(sub)
    return parser


def main(argv: list[str] | None = None) -> int:
    """CLI entrypoint."""
    args = build_parser().parse_args(argv)

    if args.command == "env-check":
        report = check_environment(args.server)
        if args.json:
            print(json.dumps(report, ensure_ascii=False, indent=2))
            return 0
        gpu = report["gpu"]
        mem = report["memory"]
        comfy = report["comfyui"]
        rec = report["recommendations"]
        print("=== 표지 생성 로컬 환경 상태 ===")
        if gpu.get("available"):
            print(
                f"GPU       : {gpu['name']} | {gpu['temp_c']}°C | "
                f"VRAM {gpu['vram_used_mib']}/{gpu['vram_total_mib']} MiB | Util {gpu['util_pct']}%"
            )
        if mem:
            print(
                f"메모리    : 물리 여유 {mem['phys_avail_gib']}/{mem['phys_total_gib']} GiB | "
                f"가상 커밋 여유 {mem['commit_avail_gib']}/{mem['commit_limit_gib']} GiB"
            )
        print(
            f"ComfyUI   : {'실행 중' if comfy.get('up') else '중지됨'} ({comfy['server_url']}) | "
            f"권장={rec['default_mode']} | gpu_cool={rec['gpu_ready_without_cooldown']}"
        )
        return 0

    if args.command == "register-frontispiece":
        created = register_illustration(
            book=args.book,
            image_path=args.image,
            after_pid=args.after_pid,
            chapter_url=args.chapter_url,
            chapter_title=args.chapter_title,
            caption=args.caption,
            sort_order=0,
            server_url=args.server,
            use_base64=args.base64,
        )
        if args.json:
            print(json.dumps(created, ensure_ascii=False, indent=2))
        else:
            print(
                f"권두 표지 등록 완료: id={created.get('id')} | book={created.get('book_name')} | "
                f"after_pid={created.get('after_pid')} ({created.get('width')}x{created.get('height')})"
            )
        return 0

    char_exit = handle_character_command(args)
    if char_exit is not None:
        return char_exit

    conn = open_readonly_db(args.db)
    try:
        if args.command == "books":
            items = list_books(conn, search=args.search, limit=args.limit)
            for idx, item in enumerate(items, start=1):
                print(
                    f"{idx:3d}. {item['book']} | ch={item['chapters']} | "
                    f"sent={item['sentences']} (tr={item['translated_count']})"
                )
            return 0

        if args.command == "brief":
            brief = get_cover_brief(
                conn,
                book=args.book,
                sample_chapters=args.chapters,
                lines_per_chapter=args.lines,
            )
            if args.json:
                print(json.dumps(brief, ensure_ascii=False, indent=2))
                return 0
            print(f"=== 표지 기획 브리프: {brief['book']} (총 {brief['total_chapters']}화) ===")
            if brief["tags"]:
                print(f"태그   : {', '.join(brief['tags'])}")
            if brief["summary"]:
                print(f"줄거리 : {brief['summary']}")
            if brief["notes"]:
                print(f"메모   : {brief['notes']}")
            print("--- 초반 목차 ---")
            for ch in brief["first_chapters"]:
                print(f"  {ch['index']:2d}. {ch['title']} ({ch['sentences']} sents) | {ch['url']}")
            for ex in brief["opening_excerpts"]:
                print(f"\n--- [{ex['index']}화] {ex['title']} 도입부 ---")
                for line in ex["lines"]:
                    print(f"[{line['pid']}] {line['text']}")
            return 0
    finally:
        conn.close()

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

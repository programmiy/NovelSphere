"""Read-only LANOVEL novel scene lookup and local ComfyUI/GPU environment checker.

Strictly opens SQLite databases in read-only URI mode (?mode=ro) so production
databases are never locked or modified.
"""

from __future__ import annotations

import argparse
import base64
import ctypes
import json
import sqlite3
import subprocess
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_DB_PATH = Path(__file__).resolve().parents[4] / "server" / "translations.db"
DEFAULT_COMFY_URL = "http://127.0.0.1:8188"
DEFAULT_LANOVEL_URL = "http://127.0.0.1:8001"


class _MemoryStatusEx(ctypes.Structure):
    """Windows MEMORYSTATUSEX structure for commit limit inspection."""

    _fields_ = [
        ("dwLength", ctypes.c_ulong),
        ("dwMemoryLoad", ctypes.c_ulong),
        ("ullTotalPhys", ctypes.c_ulonglong),
        ("ullAvailPhys", ctypes.c_ulonglong),
        ("ullTotalPageFile", ctypes.c_ulonglong),
        ("ullAvailPageFile", ctypes.c_ulonglong),
        ("ullTotalVirtual", ctypes.c_ulonglong),
        ("ullAvailVirtual", ctypes.c_ulonglong),
        ("sullAvailExtendedVirtual", ctypes.c_ulonglong),
    ]


def open_readonly_db(db_path: Path) -> sqlite3.Connection:
    """Open an SQLite database strictly in read-only URI mode."""
    resolved = db_path.resolve()
    if not resolved.is_file():
        raise FileNotFoundError(f"데이터베이스 파일을 찾을 수 없습니다: {resolved}")
    uri = f"{resolved.as_uri()}?mode=ro"
    conn = sqlite3.connect(uri, uri=True)
    conn.row_factory = sqlite3.Row
    return conn


def list_books(conn: sqlite3.Connection, search: str = "", limit: int = 50) -> list[dict[str, Any]]:
    """Return available books with chapter and sentence counts."""
    params: list[Any] = []
    where = "WHERE folderName IS NOT NULL AND folderName != ''"
    if search.strip():
        where += " AND folderName LIKE ?"
        params.append(f"%{search.strip()}%")
    params.append(limit)
    rows = conn.execute(
        f"""
        SELECT
            folderName AS book,
            COUNT(DISTINCT url) AS chapters,
            COUNT(*) AS sentences,
            SUM(CASE WHEN translated IS NOT NULL AND translated != '' THEN 1 ELSE 0 END) AS translated_count
        FROM translations
        {where}
        GROUP BY folderName
        ORDER BY MAX(timestamp) DESC
        LIMIT ?
        """,
        params,
    ).fetchall()
    return [dict(row) for row in rows]


def list_chapters(conn: sqlite3.Connection, book: str, limit: int = 100) -> list[dict[str, Any]]:
    """Return chapters of a given book ordered by TOC sort order then insertion order."""
    rows = conn.execute(
        """
        SELECT
            url,
            COALESCE(NULLIF(MAX(title), ''), url) AS title,
            COUNT(*) AS sentences,
            MIN(COALESCE(toc_sort_order, 999999)) AS sort_order
        FROM translations
        WHERE folderName = ?
        GROUP BY url
        ORDER BY sort_order ASC, MIN(id) ASC
        LIMIT ?
        """,
        (book, limit),
    ).fetchall()
    return [
        {
            "index": idx,
            "title": row["title"],
            "url": row["url"],
            "sentences": row["sentences"],
        }
        for idx, row in enumerate(rows, start=1)
    ]


def _pid_matches_bound(pid_value: str | None, target: str) -> bool:
    """Compare PID tokens case-insensitively with exact string match."""
    return (pid_value or "").strip().lower() == target.strip().lower()


def extract_scene(
    conn: sqlite3.Connection,
    book: str,
    chapter_query: str = "",
    url: str = "",
    pid_start: str = "",
    pid_end: str = "",
    limit: int = 150,
) -> dict[str, Any]:
    """Extract ordered [pid] lines from a specific novel chapter."""
    target_url = url.strip()
    target_title = ""

    if not target_url:
        chapters = list_chapters(conn, book, limit=1000)
        if not chapters:
            raise ValueError(f"소설 '{book}'의 회차를 찾지 못했습니다.")

        q = chapter_query.strip()
        if not q:
            chosen = chapters[0]
        elif q.isdigit():
            idx = int(q)
            if idx < 1 or idx > len(chapters):
                raise ValueError(f"회차 번호 {idx}가 범위를 벗어났습니다 (1~{len(chapters)}).")
            chosen = chapters[idx - 1]
        else:
            q_lower = q.lower()
            exact = [c for c in chapters if c["title"].lower() == q_lower]
            partial = [c for c in chapters if q_lower in c["title"].lower()]
            matches = exact or partial
            if not matches:
                raise ValueError(f"제목 '{q}'와 일치하는 회차를 찾지 못했습니다.")
            chosen = matches[0]
        target_url = chosen["url"]
        target_title = chosen["title"]

    rows = conn.execute(
        """
        SELECT pid, original, translated, title
        FROM translations
        WHERE folderName = ? AND url = ?
        ORDER BY id ASC
        """,
        (book, target_url),
    ).fetchall()

    if not rows:
        raise ValueError(f"소설 '{book}' / URL '{target_url}'에 문장이 없습니다.")

    if not target_title:
        target_title = next((r["title"] for r in rows if r["title"]), target_url)

    lines: list[dict[str, str]] = []
    started = not bool(pid_start.strip())
    for row in rows:
        pid = (row["pid"] or "").strip()
        if not started:
            if _pid_matches_bound(pid, pid_start):
                started = True
            else:
                continue

        text = (row["translated"] or "").strip() or (row["original"] or "").strip()
        if text:
            lines.append({"pid": pid, "text": text})

        if pid_end.strip() and _pid_matches_bound(pid, pid_end):
            break
        if len(lines) >= limit:
            break

    return {
        "book": book,
        "title": target_title,
        "url": target_url,
        "line_count": len(lines),
        "lines": lines,
    }


def get_windows_memory_gb() -> dict[str, float]:
    """Read physical RAM and commit-limit virtual memory headroom in GiB."""
    if sys.platform != "win32":
        return {}
    stat = _MemoryStatusEx()
    stat.dwLength = ctypes.sizeof(_MemoryStatusEx)
    if not ctypes.windll.kernel32.GlobalMemoryStatusEx(ctypes.byref(stat)):
        return {}
    gib = 1024**3
    return {
        "phys_total_gib": round(stat.ullTotalPhys / gib, 2),
        "phys_avail_gib": round(stat.ullAvailPhys / gib, 2),
        "commit_limit_gib": round(stat.ullTotalPageFile / gib, 2),
        "commit_avail_gib": round(stat.ullAvailPageFile / gib, 2),
    }


def get_gpu_status() -> dict[str, Any]:
    """Query nvidia-smi for GPU temperature, utilization, and VRAM usage."""
    cmd = [
        "nvidia-smi",
        "--query-gpu=name,temperature.gpu,memory.used,memory.total,utilization.gpu",
        "--format=csv,noheader,nounits",
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, text=True, timeout=5, check=True)
    except (FileNotFoundError, subprocess.SubprocessError) as exc:
        return {"available": False, "error": str(exc)}

    line = proc.stdout.strip().splitlines()[0] if proc.stdout.strip() else ""
    parts = [p.strip() for p in line.split(",")]
    if len(parts) < 5:
        return {"available": False, "raw": line}
    return {
        "available": True,
        "name": parts[0],
        "temp_c": int(float(parts[1])),
        "vram_used_mib": int(float(parts[2])),
        "vram_total_mib": int(float(parts[3])),
        "util_pct": int(float(parts[4])),
    }


def get_comfy_status(server_url: str = DEFAULT_COMFY_URL) -> dict[str, Any]:
    """Check whether local ComfyUI server is reachable and inspect queue state."""
    base = server_url.rstrip("/")
    try:
        with urllib.request.urlopen(f"{base}/system_stats", timeout=3) as resp:
            stats = json.loads(resp.read().decode("utf-8"))
        with urllib.request.urlopen(f"{base}/queue", timeout=3) as resp:
            queue = json.loads(resp.read().decode("utf-8"))
    except (urllib.error.URLError, TimeoutError, json.JSONDecodeError) as exc:
        return {"up": False, "server_url": base, "error": str(exc)}

    devs = stats.get("devices") or []
    vram_free_gib = round(devs[0]["vram_free"] / (1024**3), 2) if devs else None
    return {
        "up": True,
        "server_url": base,
        "comfyui_version": stats.get("system", {}).get("comfyui_version"),
        "vram_free_gib": vram_free_gib,
        "queue_running": len(queue.get("queue_running", [])),
        "queue_pending": len(queue.get("queue_pending", [])),
    }


def check_environment(server_url: str = DEFAULT_COMFY_URL) -> dict[str, Any]:
    """Gather GPU, Windows commit memory, and ComfyUI health in one report."""
    mem = get_windows_memory_gb()
    gpu = get_gpu_status()
    comfy = get_comfy_status(server_url)

    commit_avail = mem.get("commit_avail_gib")
    edit_safe = bool(commit_avail is not None and commit_avail >= 18.0)
    gpu_cool = bool(gpu.get("available") and gpu.get("temp_c", 99) <= 45)
    return {
        "gpu": gpu,
        "memory": mem,
        "comfyui": comfy,
        "recommendations": {
            "default_mode": "t2i",
            "edit_mode_safe": edit_safe,
            "gpu_ready_without_cooldown": gpu_cool,
        },
    }


def register_illustration(
    *,
    book: str,
    image_path: Path,
    after_pid: str = "END",
    chapter_url: str = "",
    chapter_title: str = "",
    caption: str = "",
    sort_order: int = 0,
    server_url: str = DEFAULT_LANOVEL_URL,
    use_base64: bool = False,
    timeout_sec: float = 30.0,
) -> dict[str, Any]:
    """Register an illustration image into the running LANOVEL server library."""
    resolved_img = image_path.expanduser().resolve()
    if not resolved_img.is_file():
        raise FileNotFoundError(f"삽화 이미지 파일을 찾을 수 없습니다: {resolved_img}")
    if not chapter_url.strip() and not chapter_title.strip():
        raise ValueError("chapter_url 또는 chapter_title 중 하나 이상이 필요합니다.")

    base = server_url.rstrip("/")
    parsed = urllib.parse.urlparse(base)
    is_loopback = (parsed.hostname or "").lower() in {"127.0.0.1", "localhost", "::1"}

    payload: dict[str, Any] = {
        "book_name": book.strip(),
        "after_pid": (after_pid or "END").strip() or "END",
        "sort_order": int(sort_order),
        "caption": caption.strip() or None,
    }
    if chapter_url.strip():
        payload["chapter_url"] = chapter_url.strip()
    if chapter_title.strip():
        payload["chapter_title"] = chapter_title.strip()

    if use_base64 or not is_loopback:
        encoded = base64.b64encode(resolved_img.read_bytes()).decode("ascii")
        payload["image_base64"] = encoded
    else:
        payload["source_path"] = str(resolved_img)

    req = urllib.request.Request(
        f"{base}/api/illustrations",
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers={"Content-Type": "application/json; charset=utf-8"},
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=timeout_sec) as resp:
            return json.loads(resp.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"LANOVEL 서버 등록 실패 (HTTP {exc.code}): {body}") from exc


def build_parser() -> argparse.ArgumentParser:
    """Build the CLI argument parser."""
    parser = argparse.ArgumentParser(
        description="LANOVEL Read-Only 소설 장면 조회 및 ComfyUI/GPU 환경 점검 도구"
    )
    sub = parser.add_subparsers(dest="command", required=True)

    p_env = sub.add_parser("env-check", help="GPU 온도, 커밋 메모리, ComfyUI 상태 점검")
    p_env.add_argument("--server", default=DEFAULT_COMFY_URL, help="ComfyUI 서버 주소")
    p_env.add_argument("--json", action="store_true", help="JSON 형식으로 출력")

    p_books = sub.add_parser("books", help="DB 내 소설 목록 조회 (읽기 전용)")
    p_books.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB 경로")
    p_books.add_argument("--search", default="", help="소설 제목 검색어")
    p_books.add_argument("--limit", type=int, default=50, help="최대 표시 건수")

    p_ch = sub.add_parser("chapters", help="특정 소설의 회차 목록 조회 (읽기 전용)")
    p_ch.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB 경로")
    p_ch.add_argument("--book", required=True, help="소설 폴더명(folderName)")
    p_ch.add_argument("--limit", type=int, default=100, help="최대 표시 회차 수")

    p_sc = sub.add_parser("scene", help="회차 본문 및 PID 구간 추출 (읽기 전용)")
    p_sc.add_argument("--db", type=Path, default=DEFAULT_DB_PATH, help="SQLite DB 경로")
    p_sc.add_argument("--book", required=True, help="소설 폴더명(folderName)")
    p_sc.add_argument("--chapter", default="", help="회차 번호(1부터) 또는 회차 제목 일부")
    p_sc.add_argument("--url", default="", help="특정 회차 URL 직접 지정")
    p_sc.add_argument("--pid-start", default="", help="시작 PID (예: L5, p10)")
    p_sc.add_argument("--pid-end", default="", help="종료 PID (예: L20, p40)")
    p_sc.add_argument("--limit", type=int, default=120, help="최대 출력 문장 수")

    p_reg = sub.add_parser("register-illustration", help="생성된 삽화를 LANOVEL 서재 본문에 자동 등록")
    p_reg.add_argument("--server", default=DEFAULT_LANOVEL_URL, help="LANOVEL 서버 주소 (기본 http://127.0.0.1:8001)")
    p_reg.add_argument("--book", required=True, help="소설 폴더명(book_name)")
    p_reg.add_argument("--image", type=Path, required=True, help="등록할 PNG/JPG/WEBP 이미지 경로")
    p_reg.add_argument("--chapter-url", default="", help="대상 회차 URL")
    p_reg.add_argument("--chapter-title", default="", help="대상 회차 제목 (URL 미지정 시)")
    p_reg.add_argument("--after-pid", default="END", help="삽입 위치 PID (예: TOP, L10, p15, END)")
    p_reg.add_argument("--sort-order", type=int, default=0, help="동일 위치 정렬 순서")
    p_reg.add_argument("--caption", default="", help="삽화 캡션/설명 (선택)")
    p_reg.add_argument("--base64", action="store_true", help="source_path 대신 image_base64 전송 강제")
    p_reg.add_argument("--json", action="store_true", help="JSON 형식으로 출력")

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
        print("=== 로컬 생성 환경 상태 ===")
        if gpu.get("available"):
            print(
                f"GPU       : {gpu['name']} | {gpu['temp_c']}°C | "
                f"VRAM {gpu['vram_used_mib']}/{gpu['vram_total_mib']} MiB | Util {gpu['util_pct']}%"
            )
        else:
            print(f"GPU       : 확인 불가 ({gpu.get('error', 'unknown')})")
        if mem:
            print(
                f"메모리    : 물리 여유 {mem['phys_avail_gib']}/{mem['phys_total_gib']} GiB | "
                f"가상 커밋 여유 {mem['commit_avail_gib']}/{mem['commit_limit_gib']} GiB"
            )
        if comfy.get("up"):
            print(
                f"ComfyUI   : 실행 중 ({comfy['server_url']}, v{comfy.get('comfyui_version')}) | "
                f"대기열 {comfy['queue_running']}실행/{comfy['queue_pending']}대기"
            )
        else:
            print(f"ComfyUI   : 중지됨 ({comfy['server_url']})")
        print(
            f"권장 설정 : mode={rec['default_mode']} | "
            f"edit_safe={rec['edit_mode_safe']} | gpu_cool={rec['gpu_ready_without_cooldown']}"
        )
        return 0

    if args.command == "register-illustration":
        created = register_illustration(
            book=args.book,
            image_path=args.image,
            after_pid=args.after_pid,
            chapter_url=args.chapter_url,
            chapter_title=args.chapter_title,
            caption=args.caption,
            sort_order=args.sort_order,
            server_url=args.server,
            use_base64=args.base64,
        )
        if args.json:
            print(json.dumps(created, ensure_ascii=False, indent=2))
        else:
            print(
                f"등록 완료: id={created.get('id')} | book={created.get('book_name')} | "
                f"chapter={created.get('chapter_title') or created.get('chapter_url')} | "
                f"after_pid={created.get('after_pid')} ({created.get('width')}x{created.get('height')})"
            )
        return 0

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

        if args.command == "chapters":
            chapters = list_chapters(conn, book=args.book, limit=args.limit)
            for ch in chapters:
                print(f"{ch['index']:3d}. {ch['title']} ({ch['sentences']} sents) | {ch['url']}")
            return 0

        if args.command == "scene":
            scene = extract_scene(
                conn,
                book=args.book,
                chapter_query=args.chapter,
                url=args.url,
                pid_start=args.pid_start,
                pid_end=args.pid_end,
                limit=args.limit,
            )
            print(f"=== {scene['book']} :: {scene['title']} ({scene['line_count']} lines) ===")
            for line in scene["lines"]:
                print(f"[{line['pid']}] {line['text']}")
            return 0
    finally:
        conn.close()

    return 1


if __name__ == "__main__":
    raise SystemExit(main())

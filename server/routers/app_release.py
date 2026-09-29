import os
import re
import json
from pathlib import Path
from typing import Optional
from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, HTMLResponse
from pydantic import BaseModel

router = APIRouter(tags=["app_release"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PUBSPEC_PATH = PROJECT_ROOT / "mobile_app" / "pubspec.yaml"
APK_PATH = PROJECT_ROOT / "mobile_app" / "build" / "app" / "outputs" / "flutter-apk" / "app-release.apk"
APK_PATH_GRADLE = PROJECT_ROOT / "mobile_app" / "build" / "app" / "outputs" / "apk" / "release" / "app-release.apk"
RELEASE_NOTES_PATH = PROJECT_ROOT / "mobile_app" / "release_notes.json"


def resolve_apk_path() -> Path:
    """우선적으로 Flutter/Gradle 공식 빌드 산출물 경로를 확인하고, 없으면 server/static 내 최신 APK를 탐색."""
    if APK_PATH.exists():
        return APK_PATH
    if APK_PATH_GRADLE.exists():
        return APK_PATH_GRADLE
    static_dir = PROJECT_ROOT / "server" / "static"
    if static_dir.exists():
        static_apks = sorted(list(static_dir.glob("*.apk")), key=lambda p: p.stat().st_mtime, reverse=True)
        if static_apks:
            return static_apks[0]
    return APK_PATH_GRADLE if APK_PATH_GRADLE.exists() else APK_PATH


def get_release_notes() -> str:
    """저장된 릴리즈 노트 JSON을 읽어오며, 없을 경우 기본 문구를 반환합니다."""
    if RELEASE_NOTES_PATH.exists():
        try:
            data = json.loads(RELEASE_NOTES_PATH.read_text(encoding="utf-8"))
            if data.get("release_notes"):
                return data["release_notes"].strip()
        except Exception:
            pass
    return "초고속 벌크 동기화(8.9배 가속), 루비/방점 출판 스타일 렌더링 지원, 적응형 RPM 세션 휴식 및 토큰 예산 가변 청킹 적용"


def get_app_version_info():
    """mobile_app/pubspec.yaml 및 빌드된 APK 정보를 동적으로 분석하여 반환"""
    version = "1.0.0"
    build_number = 1

    if PUBSPEC_PATH.exists():
        try:
            content = PUBSPEC_PATH.read_text(encoding="utf-8")
            match = re.search(r"^version:\s*([0-9\.]+)\+?(\d+)?", content, re.MULTILINE)
            if match:
                version = match.group(1).strip()
                if match.group(2):
                    build_number = int(match.group(2).strip())
        except Exception:
            pass

    target_apk = resolve_apk_path()
    has_apk = target_apk.exists()
    file_size = target_apk.stat().st_size if has_apk else 0
    updated_at = int(target_apk.stat().st_mtime) if has_apk else 0

    full_version = f"{version}.{build_number}" if build_number else version

    return {
        "version": full_version,
        "base_version": version,
        "build_number": build_number,
        "has_apk": has_apk,
        "file_size": file_size,
        "file_name": f"lanovel-reader-v{full_version}.apk",
        "download_url": "/api/app/download",
        "release_notes": get_release_notes(),
        "updated_at": updated_at,
    }


class ReleaseNotesRequest(BaseModel):
    release_notes: str


class VersionUpdateRequest(BaseModel):
    version: Optional[str] = None
    build_number: Optional[int] = None


@router.get("/api/app/version")
async def get_app_version():
    """모바일 앱에서 새 버전 유무를 확인하기 위한 메타데이터 엔드포인트"""
    return get_app_version_info()


@router.post("/api/app/broadcast_update")
async def broadcast_app_update():
    """새로운 APK 빌드 완료 시 SSE 연결 중인 모바일 앱들에게 무설치 자동 업데이트 신호 브로드캐스트"""
    try:
        from server.notifications import broadcast_notification
        import time
        info = get_app_version_info()
        broadcast_notification({
            "id": f"update_{int(time.time())}",
            "type": "app_update",
            "title": f"새 버전 출시 (v{info['version']})",
            "message": "무설치 자동 업데이트가 배포되었습니다.",
            "version": info["version"],
            "build_number": info["build_number"],
            "timestamp": int(time.time()),
        })
        return {"status": "ok", "broadcasted": True, "version": info["version"]}
    except Exception as e:
        return {"status": "error", "detail": str(e)}


@router.post("/api/app/release_notes")
async def update_release_notes(req: ReleaseNotesRequest):
    """릴리즈 노트를 저장 및 영속화"""
    notes = req.release_notes.strip()
    RELEASE_NOTES_PATH.parent.mkdir(parents=True, exist_ok=True)
    RELEASE_NOTES_PATH.write_text(
        json.dumps({"release_notes": notes}, ensure_ascii=False, indent=2),
        encoding="utf-8"
    )
    return {"status": "ok", "release_notes": notes}


@router.post("/api/app/bump_version")
async def bump_app_version(req: VersionUpdateRequest):
    """pubspec.yaml 내의 버전 및 빌드 번호를 업데이트"""
    if not PUBSPEC_PATH.exists():
        raise HTTPException(status_code=404, detail="pubspec.yaml 파일을 찾을 수 없습니다.")

    content = PUBSPEC_PATH.read_text(encoding="utf-8")
    match = re.search(r"^version:\s*([0-9\.]+)\+?(\d+)?", content, re.MULTILINE)
    if not match:
        raise HTTPException(status_code=400, detail="pubspec.yaml에서 version 패턴을 찾을 수 없습니다.")

    cur_ver = match.group(1).strip()
    cur_build = int(match.group(2).strip()) if match.group(2) else 1

    new_ver = req.version.strip() if req.version else cur_ver
    new_build = req.build_number if req.build_number is not None else (cur_build + 1)

    new_version_line = f"version: {new_ver}+{new_build}"
    new_content = re.sub(r"^version:\s*.*", new_version_line, content, flags=re.MULTILINE)
    PUBSPEC_PATH.write_text(new_content, encoding="utf-8")

    return get_app_version_info()


@router.post("/api/app/upload")
async def upload_latest_apk(request: Request):
    """새로운 APK 바이너리를 직접 스트리밍 업로드하여 배포 산출물로 즉시 등록"""
    APK_PATH.parent.mkdir(parents=True, exist_ok=True)
    total_bytes = 0
    with open(APK_PATH, "wb") as f:
        async for chunk in request.stream():
            f.write(chunk)
            total_bytes += len(chunk)

    if total_bytes < 10000:
        if APK_PATH.exists():
            try:
                APK_PATH.unlink()
            except Exception:
                pass
        raise HTTPException(status_code=400, detail="유효하지 않거나 비어있는 APK 파일입니다.")

    return get_app_version_info()


@router.get("/api/app/download")
async def download_latest_apk():
    """최신 릴리즈 APK 바이너리 다운로드 엔드포인트"""
    target_apk = resolve_apk_path()
    if not target_apk.exists():
        raise HTTPException(
            status_code=404,
            detail="빌드된 APK 파일이 없습니다. PC에서 'flutter build apk --release'를 실행하거나 관리자 페이지에서 업로드해 주세요."
        )

    info = get_app_version_info()
    return FileResponse(
        path=str(target_apk),
        media_type="application/vnd.android.package-archive",
        filename=info["file_name"],
        headers={
            "Cache-Control": "no-cache, no-store, must-revalidate",
            "Content-Length": str(info["file_size"]),
        }
    )


@router.get("/download", response_class=HTMLResponse)
async def serve_download_page():
    """모바일 기기 브라우저에서 편리하게 접속하여 APK를 내려받을 수 있는 반응형 웹 랜딩 페이지"""
    info = get_app_version_info()
    size_mb = f"{info['file_size'] / (1024 * 1024):.1f} MB" if info["has_apk"] else "미빌드"

    status_badge = """
        <div style="display:inline-flex; align-items:center; gap:6px; background:#e6f4ea; color:#137333; padding:4px 12px; border-radius:20px; font-size:13px; font-weight:600;">
            <span style="width:8px; height:8px; background:#137333; border-radius:50%;"></span>
            최신 빌드 다운로드 준비 완료
        </div>
    """ if info["has_apk"] else """
        <div style="display:inline-flex; align-items:center; gap:6px; background:#fce8e6; color:#c5221f; padding:4px 12px; border-radius:20px; font-size:13px; font-weight:600;">
            <span style="width:8px; height:8px; background:#c5221f; border-radius:50%;"></span>
            APK 빌드 필요
        </div>
    """

    download_button = f"""
        <a href="/api/app/download" style="display:flex; align-items:center; justify-content:center; gap:10px; width:100%; box-sizing:border-box; background:linear-gradient(135deg, #3b82f6 0%, #1d4ed8 100%); color:#ffffff; font-size:17px; font-weight:700; text-decoration:none; padding:16px 24px; border-radius:14px; box-shadow:0 4px 14px rgba(37,99,235,0.35); transition:all 0.2s ease;">
            <svg style="width:22px; height:22px; fill:currentColor;" viewBox="0 0 24 24">
                <path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/>
            </svg>
            최신 APK 다운로드 ({size_mb})
        </a>
    """ if info["has_apk"] else """
        <button disabled style="display:flex; align-items:center; justify-content:center; width:100%; box-sizing:border-box; background:#e2e8f0; color:#94a3b8; font-size:16px; font-weight:700; padding:16px 24px; border-radius:14px; border:none; cursor:not-allowed;">
            APK가 준비되지 않았습니다
        </button>
    """

    html = f"""<!DOCTYPE html>
<html lang="ko">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no">
    <title>LANOVEL Reader 모바일 앱 다운로드</title>
    <style>
        * {{ margin:0; padding:0; box-sizing:border-box; font-family:-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Noto Sans KR", sans-serif; }}
        body {{
            background:#0f172a;
            color:#f8fafc;
            display:flex;
            justify-content:center;
            align-items:center;
            min-height:100vh;
            padding:20px;
        }}
        .card {{
            background:#1e293b;
            border:1px solid #334155;
            border-radius:24px;
            width:100%;
            max-width:440px;
            padding:32px 24px;
            text-align:center;
            box-shadow:0 20px 40px rgba(0,0,0,0.5);
        }}
        .logo-box {{
            width:76px;
            height:76px;
            background:linear-gradient(135deg, #6366f1 0%, #3b82f6 100%);
            border-radius:20px;
            display:inline-flex;
            align-items:center;
            justify-content:center;
            margin-bottom:18px;
            box-shadow:0 8px 20px rgba(99,102,241,0.4);
        }}
        .logo-box svg {{
            width:42px;
            height:42px;
            fill:#ffffff;
        }}
        h1 {{
            font-size:22px;
            font-weight:800;
            letter-spacing:-0.5px;
            margin-bottom:6px;
        }}
        .subtitle {{
            color:#94a3b8;
            font-size:14px;
            margin-bottom:16px;
        }}
        .meta-box {{
            background:#0f172a;
            border:1px solid #334155;
            border-radius:14px;
            padding:14px;
            margin:20px 0;
            display:flex;
            justify-content:space-around;
            text-align:center;
        }}
        .meta-item .label {{
            font-size:12px;
            color:#64748b;
            margin-bottom:4px;
        }}
        .meta-item .val {{
            font-size:15px;
            font-weight:700;
            color:#e2e8f0;
        }}
        .instructions {{
            background:rgba(59,130,246,0.08);
            border:1px solid rgba(59,130,246,0.2);
            border-radius:14px;
            padding:16px;
            text-align:left;
            margin-top:22px;
            font-size:13px;
            color:#cbd5e1;
            line-height:1.6;
        }}
        .instructions ol {{
            padding-left:20px;
            margin-top:6px;
        }}
        .instructions li {{
            margin-bottom:4px;
        }}
        .footer {{
            margin-top:24px;
            font-size:12px;
            color:#64748b;
        }}
        .footer a {{
            color:#38bdf8;
            text-decoration:none;
        }}
    </style>
</head>
<body>
    <div class="card">
        <div class="logo-box">
            <svg viewBox="0 0 24 24">
                <path d="M18 2H6c-1.1 0-2 .9-2 2v16c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V4c0-1.1-.9-2-2-2zM6 4h5v8l-2.5-1.5L6 12V4z"/>
            </svg>
        </div>
        <h1>LANOVEL Reader</h1>
        <div class="subtitle">오프라인 퍼스트 & 양방향 자동 동기화 리더</div>
        
        {status_badge}

        <div class="meta-box">
            <div class="meta-item">
                <div class="label">버전</div>
                <div class="val">v{info['version']}</div>
            </div>
            <div class="meta-item">
                <div class="label">빌드 번호</div>
                <div class="val">#{info['build_number']}</div>
            </div>
            <div class="meta-item">
                <div class="label">파일 크기</div>
                <div class="val">{size_mb}</div>
            </div>
        </div>

        {download_button}

        <div class="instructions">
            <strong>📱 간편 설치 안내:</strong>
            <ol>
                <li>위 버튼을 눌러 APK를 다운로드합니다.</li>
                <li>다운로드 완료 알림을 탭하여 설치를 시작합니다.</li>
                <li>'출처를 알 수 없는 앱 설치' 안내가 뜨면 <strong>[설정] &rarr; [허용]</strong>을 켜주세요.</li>
                <li><strong>이번 최초 설치 이후부터는 앱 내에서 시스템 설치창 없는 '무설치(무인) 자동 업데이트'</strong>가 지원됩니다.</li>
            </ol>
        </div>

        <div class="footer">
            LANOVEL Self-Hosted Suite &bull; <a href="/">관리자 홈으로 이동</a>
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html)

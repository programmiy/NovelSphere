import os
import re
from pathlib import Path
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, HTMLResponse

router = APIRouter(tags=["app_release"])

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
PUBSPEC_PATH = PROJECT_ROOT / "mobile_app" / "pubspec.yaml"
APK_PATH = PROJECT_ROOT / "mobile_app" / "build" / "app" / "outputs" / "flutter-apk" / "app-release.apk"


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

    has_apk = APK_PATH.exists()
    file_size = APK_PATH.stat().st_size if has_apk else 0
    updated_at = int(APK_PATH.stat().st_mtime) if has_apk else 0

    full_version = f"{version}.{build_number}" if build_number else version

    return {
        "version": full_version,
        "base_version": version,
        "build_number": build_number,
        "has_apk": has_apk,
        "file_size": file_size,
        "file_name": f"lanovel-reader-v{full_version}.apk",
        "download_url": "/api/app/download",
        "release_notes": "모바일 뷰어 스와이프로 다음화 넘기기 지원, 하단 바 현재 회차 진행도 표기 및 제어, 하단 여백 확보 및 텍스트 탭 개선",
        "updated_at": updated_at,
    }


@router.get("/api/app/version")
async def get_app_version():
    """모바일 앱에서 새 버전 유무를 확인하기 위한 메타데이터 엔드포인트"""
    return get_app_version_info()


@router.get("/api/app/download")
async def download_latest_apk():
    """최신 릴리즈 APK 바이너리 다운로드 엔드포인트"""
    if not APK_PATH.exists():
        raise HTTPException(
            status_code=404,
            detail="빌드된 APK 파일이 없습니다. PC에서 'flutter build apk --release'를 실행해 주세요."
        )

    info = get_app_version_info()
    return FileResponse(
        path=str(APK_PATH),
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
                <li><strong>이번 설치 이후부터는 앱 내에서 원클릭 자동 업데이트</strong>가 지원됩니다.</li>
            </ol>
        </div>

        <div class="footer">
            LANOVEL Self-Hosted Suite &bull; <a href="/">관리자 홈으로 이동</a>
        </div>
    </div>
</body>
</html>"""
    return HTMLResponse(content=html)

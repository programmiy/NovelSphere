#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
LANOVEL 모바일 버전 판올림 & 릴리즈 빌드 자동화 스크립트
- pubspec.yaml 버전 (Semantic Version + YYYYMMDDNN 빌드 번호) 자동 갱신
- release_notes.json 릴리즈 노트 갱신
- scripts/setup_mobile.ps1 -BuildApk 호출 및 산출물 검증
"""

import argparse
import datetime
import json
import os
import re
import subprocess
import sys
from pathlib import Path

# Windows 콘솔 인코딩 대응
if sys.platform == "win32":
    try:
        if sys.stdout.encoding.lower() != "utf-8":
            sys.stdout.reconfigure(encoding="utf-8", errors="replace")
            sys.stderr.reconfigure(encoding="utf-8", errors="replace")
    except Exception:
        pass

PROJECT_ROOT = Path(__file__).resolve().parents[4]
PUBSPEC_PATH = PROJECT_ROOT / "mobile_app" / "pubspec.yaml"
RELEASE_NOTES_PATH = PROJECT_ROOT / "mobile_app" / "release_notes.json"
SETUP_SCRIPT_PATH = PROJECT_ROOT / "scripts" / "setup_mobile.ps1"
OUTPUT_APK_PATH = PROJECT_ROOT / "server" / "static" / "lanovel-reader-release.apk"


def parse_current_version():
    if not PUBSPEC_PATH.exists():
        raise FileNotFoundError(f"pubspec.yaml을 찾을 수 없습니다: {PUBSPEC_PATH}")

    content = PUBSPEC_PATH.read_text(encoding="utf-8")
    match = re.search(r"^version:\s*([0-9\.]+)\+?(\d+)?", content, re.MULTILINE)
    if not match:
        raise ValueError(f"pubspec.yaml에서 version 필드를 파싱할 수 없습니다:\n{content[:200]}")

    base_ver = match.group(1).strip()
    build_num_str = match.group(2).strip() if match.group(2) else ""
    return base_ver, build_num_str


def calculate_next_build_number(current_build_str: str) -> str:
    today_str = datetime.datetime.now().strftime("%Y%m%d")
    seq = 1

    if current_build_str.startswith(today_str) and len(current_build_str) >= len(today_str) + 2:
        try:
            seq = int(current_build_str[len(today_str):]) + 1
        except ValueError:
            seq = 1

    return f"{today_str}{seq:02d}"


def update_pubspec_version(new_base_ver: str, new_build_num: str, dry_run: bool = False):
    content = PUBSPEC_PATH.read_text(encoding="utf-8")
    target_version_str = f"version: {new_base_ver}+{new_build_num}"

    new_content, count = re.subn(
        r"^version:\s*[0-9\.]+\+?\d*",
        target_version_str,
        content,
        count=1,
        flags=re.MULTILINE
    )

    if count == 0:
        raise RuntimeError("pubspec.yaml의 version 치환에 실패했습니다.")

    if not dry_run:
        PUBSPEC_PATH.write_text(new_content, encoding="utf-8")
    return target_version_str


def update_release_notes(notes: str, dry_run: bool = False):
    data = {"release_notes": notes.strip()}
    json_str = json.dumps(data, ensure_ascii=False, indent=2) + "\n"

    if not dry_run:
        RELEASE_NOTES_PATH.write_text(json_str, encoding="utf-8")
    return json_str


def execute_build():
    if not SETUP_SCRIPT_PATH.exists():
        raise FileNotFoundError(f"setup_mobile.ps1 스크립트를 찾을 수 없습니다: {SETUP_SCRIPT_PATH}")

    cmd = [
        "powershell",
        "-NoProfile",
        "-ExecutionPolicy", "Bypass",
        "-File", str(SETUP_SCRIPT_PATH),
        "-BuildApk"
    ]

    print(f"\n[BUILD] Flutter 릴리즈 APK 빌드 명령 실행 중: {' '.join(cmd)}")
    result = subprocess.run(cmd, cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        print(f"\n[ERROR] 빌드 중 오류 발생 (종료 코드: {result.returncode})", file=sys.stderr)
        return False
    return True


def main():
    parser = argparse.ArgumentParser(description="LANOVEL 모바일 버전 판올림 & 릴리즈 빌드 도구")
    parser.add_argument("--version", "-v", help="새 Semantic Version (예: 1.7.3, 미지정 시 기존 버전 유지)")
    parser.add_argument("--build-number", "-b", help="새 빌드 번호 (미지정 시 오늘 날짜 기준 자동 계산)")
    parser.add_argument("--notes", "-n", help="릴리즈 노트 내용 (release_notes.json에 기록)")
    parser.add_argument("--build", action="store_true", help="버전/노트 갱신 후 바로 setup_mobile.ps1 -BuildApk 빌드 실행")
    parser.add_argument("--dry-run", action="store_true", help="실제 파일 변경이나 빌드 없이 계산 결과만 미리보기")

    args = parser.parse_args()

    curr_base, curr_build = parse_current_version()
    new_base = args.version.strip() if args.version else curr_base
    new_build = args.build_number.strip() if args.build_number else calculate_next_build_number(curr_build)

    print("==========================================================")
    print("   LANOVEL Mobile Release & Bump Tool")
    print("==========================================================")
    print(f"현재 버전: {curr_base}+{curr_build}")
    print(f"대상 버전: {new_base}+{new_build} {'(DRY RUN)' if args.dry_run else ''}")

    # 1. pubspec.yaml 갱신
    ver_line = update_pubspec_version(new_base, new_build, dry_run=args.dry_run)
    print(f"[OK] pubspec.yaml -> {ver_line}")

    # 2. release_notes.json 갱신
    if args.notes:
        update_release_notes(args.notes, dry_run=args.dry_run)
        print(f"[OK] release_notes.json 갱신 완료: \"{args.notes.strip()}\"")
    elif not args.dry_run:
        print("[INFO] --notes가 지정되지 않아 기존 release_notes.json을 유지합니다.")

    # 3. 빌드 실행
    if args.build:
        if args.dry_run:
            print("[INFO] --dry-run 모드이므로 실제 빌드는 생략합니다.")
        else:
            success = execute_build()
            if not success:
                sys.exit(1)

            # 산출물 확인
            if OUTPUT_APK_PATH.exists():
                size_mb = OUTPUT_APK_PATH.stat().st_size / (1024 * 1024)
                mtime = datetime.datetime.fromtimestamp(OUTPUT_APK_PATH.stat().st_mtime).strftime("%Y-%m-%d %H:%M:%S")
                print("\n==========================================================")
                print("[SUCCESS] 모바일 릴리즈 APK 빌드 & 배포 동기화 완료!")
                print(f" 산출물: {OUTPUT_APK_PATH}")
                print(f" 크기: {size_mb:.2f} MB | 수정일시: {mtime}")
                print(f" 버전: {new_base}.{new_build}")
                print("==========================================================")
            else:
                print(f"\n[WARN] 주의: 산출물 파일({OUTPUT_APK_PATH})을 찾을 수 없습니다.", file=sys.stderr)
    else:
        print("\n[GUIDE] 빌드를 실행하려면 --build 플래그를 추가하거나, 수동으로 실행하세요:")
        print("   powershell -ExecutionPolicy Bypass -File .\\scripts\\setup_mobile.ps1 -BuildApk")


if __name__ == "__main__":
    main()

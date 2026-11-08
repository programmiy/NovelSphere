import os
import subprocess
import logging
import threading
import time
from typing import List, Dict, Any, Optional
from sqlalchemy.orm import Session
from sqlalchemy import func

from server.models import Translation, ManualTranslationNovel
from server.services import reviewed_service
import server.database as sdb

logger = logging.getLogger(__name__)

# hdtrans.exe 경로 정의
HDTRANS_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "tools", "hdtrans"))
HDTRANS_EXE = os.path.join(HDTRANS_DIR, "hdtrans.exe")
BR_TOKEN = "<!BR!>"


def is_hdtrans_available() -> bool:
    """hdtrans.exe 실행 파일이 로컬에 정상 존재하는지 확인"""
    return os.path.exists(HDTRANS_EXE) and os.path.isfile(HDTRANS_EXE)


def translate_paragraphs(paragraphs: List[str]) -> List[str]:
    """
    원문 문단 리스트를 hdTrans 엔진을 통해 일괄 번역.
    개행은 BR_TOKEN으로 보호하여 줄 수의 1:1 일치를 보장합니다.
    """
    if not paragraphs:
        return []

    if not is_hdtrans_available():
        raise FileNotFoundError(f"hdtrans.exe를 찾을 수 없습니다: {HDTRANS_EXE}")

    # 개행 보호 및 단일 줄 리스트 생성
    clean_lines = []
    index_map = []  # 실제 번역할 대상의 인덱스
    results = ["" for _ in paragraphs]

    for idx, p in enumerate(paragraphs):
        text = (p or "").strip()
        if not text:
            results[idx] = ""
            continue
        # 문단 내 개행을 토큰으로 변경
        flat = text.replace("\r\n", "\n").replace("\r", "\n").replace("\n", BR_TOKEN)
        clean_lines.append(flat)
        index_map.append(idx)

    if not clean_lines:
        return results

    input_payload = "\n".join(clean_lines)

    try:
        proc = subprocess.Popen(
            [HDTRANS_EXE, "--each"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            encoding="utf-8",
            cwd=HDTRANS_DIR,
        )
        stdout, stderr = proc.communicate(input=input_payload, timeout=60)
        if proc.returncode != 0:
            logger.warning(f"[hdTrans] Non-zero exit code: {proc.returncode}, stderr: {stderr}")

        translated_lines = stdout.splitlines()

        for idx, trans_line in enumerate(translated_lines):
            if idx < len(index_map):
                orig_idx = index_map[idx]
                restored = (
                    trans_line.replace(BR_TOKEN, "\n")
                    .replace(BR_TOKEN.lower(), "\n")
                    .strip()
                )
                results[orig_idx] = restored

    except Exception as e:
        logger.error(f"[hdTrans] 번역 실행 오류: {e}")
        raise e

    return results


def translate_episode_in_db(
    db: Session,
    folder_name: str,
    url: str,
    overwrite: bool = False,
) -> int:
    """
    특정 소설 회차(URL)의 문단들을 hdTrans로 초벌 번역하여 DB에 저장.
    overwrite=False인 경우 빈칸인 문단만 번역.
    번역된 문단 수 반환.
    """
    query = (
        db.query(Translation)
        .filter(Translation.folderName == folder_name, Translation.url == url)
        .order_by(Translation.toc_sort_order.asc(), Translation.id.asc())
    )
    rows = query.all()
    if not rows:
        return 0

    target_rows = []
    for r in rows:
        if overwrite or not r.translated or not r.translated.strip():
            target_rows.append(r)

    if not target_rows:
        return 0

    originals = [r.original for r in target_rows]
    translated_texts = translate_paragraphs(originals)

    for r, trans in zip(target_rows, translated_texts):
        r.translated = trans
        r.timestamp = 0  # 통계 집계(오늘 번역 등)에서 영구 제외되도록 0 처리

    db.commit()
    return len(target_rows)


class HdTransRunner:
    """소설 전체 백그라운드 초벌 번역 러너"""

    def __init__(self):
        self.status = "idle"  # idle, running, completed, stopped, error
        self.folder_name = ""
        self.total_episodes = 0
        self.processed_episodes = 0
        self.total_paragraphs_translated = 0
        self.current_episode_title = ""
        self.current_url = ""
        self.progress_percent = 0.0
        self.logs: List[str] = []
        self.error_message = ""
        self._thread: Optional[threading.Thread] = None
        self._stop_requested = False
        self._lock = threading.Lock()

    def get_status(self) -> Dict[str, Any]:
        with self._lock:
            return {
                "status": self.status,
                "folder_name": self.folder_name,
                "total_episodes": self.total_episodes,
                "processed_episodes": self.processed_episodes,
                "total_paragraphs_translated": self.total_paragraphs_translated,
                "current_episode_title": self.current_episode_title,
                "progress_percent": round(self.progress_percent, 1),
                "logs": self.logs[-30:],
                "error_message": self.error_message,
                "is_available": is_hdtrans_available(),
            }

    def add_log(self, msg: str):
        with self._lock:
            ts = time.strftime("%H:%M:%S")
            self.logs.append(f"[{ts}] {msg}")
            if len(self.logs) > 200:
                self.logs.pop(0)

    def stop(self):
        with self._lock:
            if self.status == "running":
                self._stop_requested = True
                self.add_log("🛑 사용자에 의한 초벌 번역 중지 요청")

    def start_novel_translation(self, folder_name: str, overwrite: bool = False):
        with self._lock:
            if self.status == "running":
                raise RuntimeError("이미 초벌 번역 작업이 진행 중입니다.")
            self.status = "running"
            self.folder_name = folder_name
            self.total_episodes = 0
            self.processed_episodes = 0
            self.total_paragraphs_translated = 0
            self.current_episode_title = ""
            self.progress_percent = 0.0
            self.logs = []
            self.error_message = ""
            self._stop_requested = False

        self._thread = threading.Thread(
            target=self._run_loop,
            args=(folder_name, overwrite),
            daemon=True,
        )
        self._thread.start()

    def _run_loop(self, folder_name: str, overwrite: bool):
        self.add_log(f"⚡ hdTrans 초벌 번역 엔진 가동: '{folder_name}'")
        db = next(sdb.get_db())

        try:
            # 해당 소설의 고유 URL 및 대표 회차 제목, 순서 조회
            eps_query = (
                db.query(
                    Translation.url,
                    func.min(Translation.title).label("title"),
                    func.min(Translation.toc_sort_order).label("sort_order"),
                )
                .filter(Translation.folderName == folder_name)
                .group_by(Translation.url)
                .order_by(func.min(Translation.toc_sort_order).asc(), Translation.url.asc())
            )
            episodes = eps_query.all()

            if not episodes:
                self.add_log("⚠️ 초벌 번역할 회차 데이터가 없습니다.")
                with self._lock:
                    self.status = "completed"
                    self.progress_percent = 100.0
                return

            with self._lock:
                self.total_episodes = len(episodes)

            self.add_log(f"총 {self.total_episodes}개 회차 초벌 번역 대기열 등록 완료.")

            for idx, ep in enumerate(episodes, 1):
                if self._stop_requested:
                    self.add_log("🛑 초벌 번역 작업이 안전하게 중단되었습니다.")
                    with self._lock:
                        self.status = "stopped"
                    return

                with self._lock:
                    self.current_url = ep.url
                    self.current_episode_title = ep.title or f"회차 {idx}"

                count = translate_episode_in_db(
                    db=db,
                    folder_name=folder_name,
                    url=ep.url,
                    overwrite=overwrite,
                )

                with self._lock:
                    self.processed_episodes = idx
                    self.total_paragraphs_translated += count
                    self.progress_percent = (idx / self.total_episodes) * 100.0

                self.add_log(
                    f"[{idx}/{self.total_episodes}] {self.current_episode_title} -> {count}개 문단 초벌 번역 완료"
                )

            self.add_log(
                f"🎉 '{folder_name}' 전체 초벌 번역 완료! (총 {self.total_paragraphs_translated}개 문단 반영)"
            )
            with self._lock:
                self.status = "completed"
                self.progress_percent = 100.0

        except Exception as e:
            logger.error(f"[hdTrans] 러너 루프 오류: {e}", exc_info=True)
            self.add_log(f"❌ 오류 발생: {str(e)}")
            with self._lock:
                self.status = "error"
                self.error_message = str(e)
        finally:
            db.close()


# 싱글톤 인스턴스
hdtrans_runner = HdTransRunner()

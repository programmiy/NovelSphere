# C:\ServerHub 공동 관리 서버 허브 고도화 및 안정성 개선 (2026-10-28)

## 📌 작업 개요
`C:\ServerHub`는 LANOVEL(포트 8001)과 ASMR Vault(포트 8000) 백엔드 서버를 통합 감지·제어·모니터링하는 공용 인프라입니다.
실시간 프로세스 점검 과정에서 발견된 **중복 프로세스 실행(싱글톤 부재), 과도한 TCP 소켓 낭비(TIME_WAIT 폭증), 1.5초 헬스체크 access 로그 도배로 인한 디스크 폭증(43MB/31MB), 프로세스 종료 누락(kill_by_port 부재)** 문제를 전면 진단하고 해결했습니다.

---

## 🛠️ 주요 변경 및 개선 내역

### 1. 단일 인스턴스(Single Instance) 보장 - Windows Named Mutex 도입
- **문제점**: 런처 더블 클릭이나 자동 시작 시 중복 실행 방어가 없어 `server_hub.pyw`와 `log_viewer.pyw`, Uvicorn 서버들이 2개 이상 복제 실행되어 포트 충돌 및 리소스 낭비 발생.
- **해결책**:
  - `hub_utils.py` 내 `acquire_single_instance_mutex` 구현 (`CreateMutexW`, `ERROR_ALREADY_EXISTS = 183` 검사).
  - `server_hub.pyw`: `Global\AntigravityServerHub_Tray_Mutex` 적용.
  - `log_viewer.pyw`: `Global\AntigravityServerHub_Viewer_Mutex` 적용 및 이미 실행 중인 경우 `bring_window_to_foreground`로 기존 창을 화면 맨 앞으로 복원 후 조용히 종료.

### 2. 고아 프로세스 및 서브프로세스 박멸을 위한 `kill_by_port` 통합
- **문제점**: `server_hub.pyw`에서 서버 중지/재시작 시 `self.process` 핸들만 검사하여, 재시작 전에 이미 켜져 있었거나 `--reload` 등으로 분기된 Uvicorn 자식 프로세스를 죽이지 못함.
- **해결책**:
  - `hub_utils.py`의 `kill_by_port(port)`를 `ServiceProcess.stop()`에 이식하여, 포트 8000/8001을 점유한 모든 프로세스 트리를 `taskkill /F /T /PID`로 원천 종료 보장.

### 3. 과도한 TCP 소켓 생성 및 `TIME_WAIT` 폭증 / Windows IOCP WinError 64 방어
- **문제점**:
  - `log_viewer.pyw`의 300ms 주기 `poll_logs` 내에서 `update_server_status()`(TCP 연결)가 매번 호출되어 수백 개의 `TIME_WAIT` 소켓 누적.
  - 강제 RST 방식의 `SO_LINGER (1, 0)` 옵션 사용 시, Windows IOCP (`IocpProactor`)에서 `AcceptEx` 도중 소켓이 일방적으로 끊겨 `[WinError 64] 지정된 네트워크 이름을 더 이상 사용할 수 없습니다` 및 `Accept failed on a socket` 에러 발생.
- **해결책**:
  - `poll_logs`는 300ms 순수 텍스트 렌더링에만 집중하도록 분리.
  - 서버 상태 감시는 `poll_integrated_status_loop` (2.5초)로 통합하여, 서버 가동 시에는 정상 HTTP GET 요청만 사용하도록 하여 Raw TCP 포트 프로브를 원천 차단.
  - `SO_LINGER` 강제 RST 옵션을 제거하고 정상 소켓 라이프사이클로 복원하여 IOCP WinError 64 완벽 해결.

### 4. 헬스체크 access 로그 도배 완화 및 로그 자동 로테이션
- **문제점**: 1.5초마다 `/api/status/summary`, `/api/health`, `/api/subtitles/status`를 호출하여 일 10만 줄 이상의 단순 200 OK 로그가 누적, 로그 파일 크기가 40MB를 초과하여 메모장 열기 렉 유발.
- **해결책**:
  - API 폴링 주기를 2.5초로 완화하여 access log 발생량을 40% 이상 절감.
  - 15MB 초과 시 자동으로 `.old`로 백업하고 0바이트로 초기화하는 `rotate_log_file` 적용.
  - `log_viewer.pyw`에 `[📦 로그 파일 비우기/회전]` 원클릭 버튼 추가.
  - 기존 43MB/31MB 대용량 로그 파일 수동 회전 완료 (`lanovel.log.old`, `asmr_vault.log.old`).

### 5. 가상환경(venv) 단일화 및 유연성 확보
- **사용자 요구**: venv는 LANOVEL 프로젝트(`C:\LANOVEL\venv`)에만 유지.
- **해결책**:
  - `hub_utils.get_python_exe()`에서 `custom_path`가 없으면 항상 `C:\LANOVEL\venv\Scripts\python(w).exe`를 최우선으로 일관되게 바인딩.
  - 시스템 기본 파이썬과의 충돌을 방지하고 LANOVEL 가상환경으로 단일 통합.

---

## 📂 변경된 파일 목록
- `C:\ServerHub\hub_utils.py` (신규: 공통 유틸리티, 루프백 소켓 락 59123/59124, `is_service_alive`)
- `C:\ServerHub\server_hub.pyw` (수정: 소켓 락 단일 인스턴스, 프로세스 상태 기반 모니터링, kill_by_port, 로테이션)
- `C:\ServerHub\log_viewer.pyw` (수정: 소켓 락 단일 인스턴스, 300ms 분리, 2.5s 통합 HTTP 감시, 수동 로그 회전)
- `C:\ServerHub\README.md` (수정: 최신 아키텍처 및 개선 사항 반영)
- `server/server.py` (수정: Windows IOCP WinError 64/121/1236 클라이언트 접속 끊김 예외 필터링 핸들러 탑재)
- `C:\LANOVEL\start_server_hub.bat` (LANOVEL 루트 바로가기)
- `C:\LANOVEL\open_logs.bat` (LANOVEL 루트 바로가기)

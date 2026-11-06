# Windows asyncio Proactor WinError 10054 연결 강제 종료 노이즈 완화 보고서

- **작업 일자**: 2026-11-06
- **관련 파일**:
  - `server/server.py`

---

## 1. 개요 및 배경
- 브라우저 관리자 페이지 새로고침, 탭 닫기, 크롬 확장과의 웹소켓/SSE 연결 재설정 시 서버 로그에 아래와 같은 `ConnectionResetError: [WinError 10054]` 에러 트레이스백이 출력되는 현상이 발생함:
  ```text
  ERROR - Exception in callback _ProactorBasePipeTransport._call_connection_lost(None)
  handle: <Handle _ProactorBasePipeTransport._call_connection_lost(None)>
  Traceback (most recent call last):
    File ".../asyncio/events.py", line 80, in _run
      self._context.run(self._callback, *self._args)
    File ".../asyncio/proactor_events.py", line 165, in _call_connection_lost
      self._sock.shutdown(socket.SHUT_RDWR)
  ConnectionResetError: [WinError 10054] 현재 연결은 원격 호스트에 의해 강제로 끊겼습니다
  ```
- **원인 분석**:
  - CPython의 Windows `ProactorEventLoop` 공식 알려진 이슈(Issue #67804).
  - 클라이언트가 RST 패킷으로 연결을 닫은 상태에서 `_ProactorBasePipeTransport._call_connection_lost`가 소켓을 닫기 위해 `self._sock.shutdown(socket.SHUT_RDWR)`을 무조건 호출하면서 Windows 소켓 계층에서 `WinError 10054` 예외가 발생.
  - 데이터 손실이나 서비스 장애를 유발하지 않는 무해한 소켓 종료 노이즈이지만, 상위 핸들러 미포획으로 ERROR 로그를 오염시킴.

---

## 2. 해결 방법 (`server/server.py`)

1. **`_ProactorBasePipeTransport._call_connection_lost` 원천 몽키패치**:
   - `server/server.py` 상단 Windows IOCP 패치 블록에 `_silenced_call_connection_lost`를 주입.
   - 소켓 종료 시 발생하는 `ConnectionResetError` 및 `WinError in (10054, 64, 121, 1236)`을 안전하게 포획 및 무음화하여 이벤트 루프 콜백 예외 전파를 차단.
2. **`windows_iocp_exception_handler` 필터 확장**:
   - `lifespan` 내 이벤트 루프 예외 핸들러에 `WinError 10054` 및 `ConnectionResetError`를 등록하여, 루프 수준의 잔여 노이즈 로그 출력을 원천 필터링.

---

## 3. 검증 결과
- 회귀 버그 및 전체 테스트 19건 전원 통과 (`tests/test_security_remediation.py`, `tests/test_notifications.py`, `tests/test_unclassified.py`).
- 클라이언트 소켓 강제 단절 시에도 에러 트레이스백 없이 조용하고 안전하게 연결 리소스가 정리됨을 확인.

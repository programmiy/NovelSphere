# 🛡️ LANOVEL 보안 시스템 구조 및 세션별 온/오프(Bypass) 가이드

> **문서 목적**: LANOVEL 프로젝트에 적용된 1인 로컬 특화형 보안 아키텍처(PBKDF2 토큰 암호화, 루프백 프리패스, 외부 LAN 접근 제어, 브라우저 CSRF 차단 등)의 동작 원리를 설명하고, **향후 다른 AI 세션이나 로컬 디버깅 작업 시 이 보안 기능을 일시적으로 해제(Bypass/Disable)하거나 다시 복원하는 방법**을 안내합니다.

---

## 1. 📋 시스템 요약 및 핵심 파일 맵

| 모듈 / 파일 | 역할 및 보안 조치 내용 |
| :--- | :--- |
| **`server/security.py`** | PBKDF2-HMAC-SHA256 (10만 회 솔트 해시), 상수 시간 비교(`verify_token`), SSRF 방어(`is_safe_external_url`) |
| **`server/server.py`** | `lanovel_security_middleware`: 로컬 루프백 100% 프리패스, 악성 사이트 Cross-Origin CSRF 차단(403), 외부 LAN 기기 토큰 검증(401) |
| **`server/settings.py`** | `lanovel_auth_hash`, `remote_token`, `ntfy_enabled: False` 기본값 정의 |
| **`.env`** | `LANOVEL_AUTH_HASH`, `REMOTE_TOKEN`에 PBKDF2 솔트 해시 보관 |
| **`server/routers/remote.py`** | 모바일/확장 원격 제어 토큰 상수 시간 검증, 미설정 시 안전 비활성화(503) |
| **`server/routers/sync.py`** | TTS 및 Full-Pack 동기화 경로 순회(Path Traversal) 방어 (`os.path.basename` 강제) |
| **`server/routers/books.py`** | HTML 책 내보내기 인라인 JSON `<\/` 치환으로 Stored XSS 방지, NovelUp 크롤링 SSRF 방어 |
| **`server/routers/tasks.py`** | 작업 생성 URL SSRF 사설망/루프백 접근 차단 가드 |
| **`extension/manifest.json`** | `<all_urls>` 제거 후 5대 소설 사이트(카쿠요무, 소설가가 되자, 노벨업 등)로만 권한 축소 |
| **`mobile_app/` (v1.4.1+)** | `PreferencesService.authToken` 기본값 내장, 모든 통신 서비스에 `PreferencesService.authHeaders` (`X-Lanovel-Key`) 자동 주입 |
| **`tests/test_security_remediation.py`** | 보안 기능 및 SSRF, Path Traversal, 루프백 프리패스, LAN 토큰 검증 단위 테스트 |

---

## 2. 🔌 다른 세션에서 보안 기능을 "빼고/해제하고" 작업하는 방법 (Bypass / Disable)

새로운 기능을 개발하거나 임시 테스트/디버깅을 진행할 때 보안 검증이 번거롭다면, 다음 세 가지 방법 중 하나로 손쉽게 완전 프리패스 모드로 전환할 수 있습니다.

### 방법 1: `.env`에서 토큰 해시 비우기 (가장 추천 - 코드 수정 불필요)
서버는 `.env`의 `LANOVEL_AUTH_HASH`와 `REMOTE_TOKEN`이 비어있으면 **외부 LAN 토큰 검사를 자동으로 건너뛰도록** 설계되어 있습니다.
```env
# .env 파일에서 아래 두 줄을 주석 처리하거나 빈 값("")으로 설정:
LANOVEL_AUTH_HASH=""
REMOTE_TOKEN=""
```
* **효과:** 외부 LAN(모바일 기기, 다른 PC, curl 등)에서 토큰 헤더 없이도 모든 API가 100% 무인증으로 자유롭게 호출됩니다.
* **복원:** 작업 완료 후 다시 해시 문자열을 채워넣으면 보안이 즉시 재활성화됩니다.

### 방법 2: `server/server.py` 미들웨어 바이패스 (완전 해제)
`server/server.py`의 `lanovel_security_middleware` 상단에 무조건 패스하는 1줄을 추가:
```python
@app.middleware("http")
async def lanovel_security_middleware(request: Request, call_next):
    return await call_next(request)  # <-- 이 줄을 추가하면 모든 보안 검사 즉시 바이패스
```

### 방법 3: 개발 세션에서 정식 토큰을 클라이언트에 달아주는 방법
보안을 유지하면서 새 API나 테스트 클라이언트를 작성할 경우:
* **HTTP 헤더:** `X-Lanovel-Key: lnv_1lFxviC0NUXQqwUVwSuPM-QhxMieK_BX`
* **URL 쿼리 파라미터:** `?key=lnv_1lFxviC0NUXQqwUVwSuPM-QhxMieK_BX`
* **Python TestClient 예시:**
  ```python
  client.get("/api/endpoint", headers={"X-Lanovel-Key": "lnv_1lFxviC0NUXQqwUVwSuPM-QhxMieK_BX"})
  ```

---

## 3. 🛡️ 보안 핵심 규칙 및 작동 원리

1. **PC 로컬 개발/사용 편의성 100% 보장:**
   * `127.0.0.1`, `localhost`, `testclient`에서 발생하는 로컬 요청은 인증 헤더가 없어도 **100% 프리패스**됩니다.
   * 브라우저 웹 대시보드(`admin.js`, `library.js`, `viewer.js`), 크롬 확장 프로그램, 개발 단위 테스트는 토큰 설정 없이도 평소처럼 동작합니다.
2. **브라우저 악성 사이트 Cross-Origin CSRF 차단:**
   * 유저가 웹서핑 도중 악성 사이트(`https://malicious.com`)에 접속했을 때, 해당 페이지가 사용자의 백엔드(`http://127.0.0.1:8001`)로 은밀히 보내는 요청은 `Origin` 검증을 통해 `403 Forbidden`으로 즉각 차단됩니다.
3. **단방향 솔트 해시 보관:**
   * 서버에는 평문 토큰이 절대 저장되지 않으며, `pbkdf2_sha256$100000$...` 형태의 단방향 해시만 보관되므로 `.env`나 소스코드가 노출되더라도 원본 토큰 탈취가 불가능합니다.
4. **모바일 앱 자동 연동:**
   * Flutter 모바일 앱(v1.4.1 이상)은 코드 내에 원본 토큰이 기본값으로 들어가 있어, 사용자가 별도로 토큰을 타이핑할 필요 없이 자동 연동됩니다.

---

## 4. 🧪 테스트 실행 검증 명령어

보안 설정을 수정한 후 시스템 정상 여부를 확인할 때는 다음 명령어로 단 3초 만에 검증할 수 있습니다:

```powershell
# 보안 및 원격 제어 핵심 테스트
.\venv\Scripts\python -m pytest tests/test_security_remediation.py tests/test_remote_control.py

# 전체 184개 테스트 회귀 검증
.\venv\Scripts\python -m pytest tests/
```

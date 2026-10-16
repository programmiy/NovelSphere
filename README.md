# 📖 LANOVEL

> **대규모 일본어 웹소설 AI 번역, 뷰어, 품질 검수 및 로컬 코퍼스 인텔리전스 플랫폼**

LANOVEL은 소설가가 되자, 카쿠요무, 노벨업, 하멜른 등의 일본어 웹소설을 Google Gemini 모델군을 활용하여 고품질 한국어로 번역하고, 수십만 건의 누적 코퍼스를 체계적으로 관리·감상·교정할 수 있는 종합 번역 관리 시스템입니다.

---

## 🌟 주요 핵심 기능

### 1. 🤖 다중 모델 AI 번역 & 쿼터 제어
- **Gemini 3.x Flash 다중 모델 파이프라인**: 문장의 길이와 난이도에 따라 `gemini-3.0-flash`, `3.6-flash`, `3.7-flash`, `3.8-flash`로 자동 분배 처리.
- **RPM Breather & 쿼터 동기화**: API 분당 호출 한도(RPM) 초과 방지 지연 제어 및 쿼터 초기화 시각(16시/17시) 기준 일일 집계 관리.
- **제외 번역 백업/복원**: 불필요한 광고, 배너, 공지사항 문장을 번역에서 원천 차단하고 안전하게 동기화.
- **실시간 작업 알림**: 번역 진행률, 10화 단위 마일스톤 및 챕터 완료 시 스마트폰(모바일 앱)/데스크톱 실시간 SSE 알림.

### 2. ⚡ 34만+ 로컬 코퍼스 AI 엔진 (Corpus AI)
- **외부 API 의존 없는 초고속 로컬 엔진**: 34만 문장의 누적 데이터를 증류한 전용 색인 DB(`corpus_ai.db`)로 0.05초 내 룩업.
- **2-Tier EBMT 번역 초안 합성**: 템플릿 치환(Tier 1)과 N-gram 구문 스티칭(Tier 2) 기반의 고속 초안 생성.
- **어투 일관성 신호등 & 고스트 텍스트**: 문체(존댓말/반말, 종결어미) 일치도 분석 및 실시간 자동완성 제안.
- **어휘 분해 & 인터랙티브 퀴즈**: 형태소 분석 기반 단어 분해 및 듀오링고 스타일의 단어/문장 퀴즈 지원.

### 3. 🔍 AI 번역 품질 검수 & 재재번역 (AI Review)
- **4대 악성 결함 탐지**: 다국어 오염(일본어/간체자/외국어 누출), 번역문 밀림(Off-by-One), AI Slop(헛소리/무한루프), 비문 탐지.
- **4분위수(P25, P50, P75) 재재번역 큐**: 문장 길이에 맞춘 최적 모델 매칭 및 재번역 대기열 운영.
- **Human-in-the-Loop 검수 UI**: 3D 맥락 패널, 틴더형 카드 스와이프, 즉시 편집 가능한 인풋 필드 제공.

### 4. 🎨 에스테틱 UI & 리더 경험
- **서재 (`/library`)**: 3D 기어 회전, 스팀 배관 증기 파티클, 5구 압력계 아날로그 게이지가 작동하는 **증기 차분기관(Steam Difference Engine)** 테마.
- **뷰어 (`/viewer`)**: 빛나는 닉시관 카운터와 레트로 진공관 앰비언트 글로우가 적용된 **3D 진공관 닉시관(Nixie Tube)** 테마.
- **관리자 (`/admin`)**: 하단 슬라이딩 도크(Dock)형 유사 번역 추천 패널, 사전(네이버/Weblio/Jisho) 즉시 연동.
- **DB 에디터 (`/db_editor`)**: 인명·용어 불일치 린터 교정기 및 정규식 일괄 치환 지원.

### 5. 📱 멀티 플랫폼 지원
- **크롬 확장 프로그램 (`extension`)**: 소설 연재 사이트에서 실시간 자동 번역 및 다음화 자동 이동.
- **Flutter 모바일 앱 (`mobile_app`)**: Hyper-Aesthetic Luminary UI, 고속 양방향 데이터 동기화, OTA 업데이트.
- **모바일 원격 제어 (`/remote`)**: 모바일 앱에서 PC 번역 확장을 새로고침/일시정지/다음화 예약할 수 있는 리모컨 허브.

---

## 🛠️ 시스템 아키텍처

```
LANOVEL/
├── server/                 # FastAPI 백엔드
│   ├── routers/            # 21개 모듈형 라우터 (ui, translation, admin, corpus_ai 등)
│   ├── services/           # 11개 비즈니스 서비스 (translation_engine, corpus_ai_service 등)
│   ├── templates/          # Jinja2 동적 템플릿 (library, viewer, admin 등)
│   ├── static/             # CSS/JS 정적 에셋 및 FX 애니메이션
│   ├── models.py           # SQLAlchemy ORM 스키마
│   ├── server.py           # FastAPI 앱 진입점 및 백그라운드 태스크
│   └── settings.py         # Pydantic 기반 환경설정 (.env 연동)
├── extension/              # Chrome 번역 수집 및 자동 네비게이션 확장 프로그램
├── mobile_app/             # Flutter 기반 모바일 뷰어 및 리모트 앱
├── scripts/                # 데이터 추출, 코퍼스 색인 빌드 및 진단 유틸리티
├── tests/                  # Pytest 기반 단위/통합 테스트 스위트 (170+ 테스트)
└── main.py                 # 데스크톱 Pywebview 런처 & 트레이 아이콘
```

---

## 🚀 빠른 시작

### 1. 필수 조건
- Python 3.11+
- Google Gemini API Key

### 2. 환경 설정
1. 가상환경 생성 및 활성화:
   ```bash
   python -m venv venv
   # Windows PowerShell
   .\venv\Scripts\Activate.ps1
   # macOS / Linux
   source venv/bin/activate
   ```

2. 의존성 패키지 설치:
   ```bash
   pip install -r requirements.txt
   ```

3. 환경 변수 파일(`.env`) 생성:
   ```ini
   GEMINI_API_KEY="your-gemini-api-key-here"
   DEBUG=False
   SERVER_HOST=0.0.0.0
   SERVER_PORT=8001
   ```

### 3. 애플리케이션 실행

#### 옵션 A. 데스크톱 앱 모드 (Pywebview 런처)
```bash
python main.py
```
* 시스템 트레이 아이콘 및 독립 웹뷰 창으로 LANOVEL 서재가 실행됩니다.

#### 옵션 B. 순수 FastAPI 웹 서버 모드
```bash
uvicorn server.server:app --host 0.0.0.0 --port 8000 --reload
```
* 브라우저에서 `http://localhost:8000/library` 로 접속합니다.

---

## 🧪 테스트 실행

프로젝트의 전체 테스트 스위트를 검증합니다:

```bash
pytest
```
* 170개 이상의 단위 및 통합 테스트가 모든 라우터, 서비스, 쿼터 및 변환 무결성을 검증합니다.

---

## 📑 API 문서

서버 실행 후 다음 주소에서 Swagger 및 ReDoc 대화형 API 명세를 확인할 수 있습니다:
- **Swagger UI**: `http://localhost:8000/docs`
- **ReDoc**: `http://localhost:8000/redoc`

---

## 🌿 브랜치 전략

- `main`: 안정화된 배포 브랜치
- `extra`: 활성 개발, 신규 기능 구현 및 리팩토링 브랜치
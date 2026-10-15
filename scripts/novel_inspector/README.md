# Novel Inspector (소설 분석 및 작명 보조 전용 툴킷)

새로운 웹소설(카쿠요무, 소설가가 되자 등)의 정보를 분석하고, 기존 서재 작명 규칙을 조회하기 위한 정규화 도구입니다.

---

## 📁 구성 파일

* **`target_url.txt`**  
  분석할 소설의 웹소설 URL을 적어두는 텍스트 파일입니다.
* **`fetch_novel.py`**  
  URL에서 제목, 작가, 캐치프레이즈, 줄거리, 태그를 자동으로 추출해 출력하고 파일로 저장하는 핵심 스크립트입니다.
* **`list_library_folders.py`**  
  현재 서재(`translations.db`)에 등록된 모든 폴더명과 최근 소설 매핑을 한눈에 조회하는 스크립트입니다.
* **`output/`**  
  분석 결과가 자동으로 저장되는 디렉토리 (`last_novel.json`, `last_summary.txt`).

---

## 🚀 사용법

### 1. 소설 URL 분석 (둘 중 하나 사용)
```powershell
# 방법 A: target_url.txt에 URL을 적어두고 그냥 실행
.\venv\Scripts\python.exe scripts\novel_inspector\fetch_novel.py

# 방법 B: 실행 시 인자로 직접 URL 전달
.\venv\Scripts\python.exe scripts\novel_inspector\fetch_novel.py "https://kakuyomu.jp/works/16818093073317257284"
```

### 2. 현재 서재 폴더명 목록 및 최근 작업 조회
```powershell
.\venv\Scripts\python.exe scripts\novel_inspector\list_library_folders.py
```

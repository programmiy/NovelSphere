# 📋 [작업 계획서] SQLite FTS5 Trigram 하이브리드 라우팅 및 검색 병목 최적화

> **문서 버전**: 2.0.0 (3글자 미만 LIKE 하이브리드 분기 & 기존 FTS5 DROP/재생성 & 유사도/사전 서비스 병목 전수 개선)  
> **작성 일자**: 2026-10-15  
> **대상 디렉토리 및 파일**:  
> - 엔진/스키마: [`server/server.py`](file:///C:/LANOVEL/server/server.py), [`server/database.py`](file:///C:/LANOVEL/server/database.py), [`server/database_corpus.py`](file:///C:/LANOVEL/server/database_corpus.py)  
> - 검색 병목 서비스: [`server/services/similarity_service.py`](file:///C:/LANOVEL/server/services/similarity_service.py), [`server/services/dictionary_service.py`](file:///C:/LANOVEL/server/services/dictionary_service.py), [`server/services/corpus_ai_service.py`](file:///C:/LANOVEL/server/services/corpus_ai_service.py)  
> - API 라우터: [`server/routers/data_crud.py`](file:///C:/LANOVEL/server/routers/data_crud.py)  
> **목적**: SQLite Trigram(3-gram) 토크나이저의 2글자 이하 토큰 미생성 제약을 완벽히 방어하는 **글자 수 기반 하이브리드 라우팅**을 구현하고, `similarity_service`와 `dictionary_service` 등 37만 건 풀 스캔 병목을 1~2ms 인덱스 룩업으로 가속합니다.

---

## 1. Trigram 토크나이저의 치명적 제약과 해결책 (Core Engineering)

### ① 1~2글자 한자/단어 검색 시 Trigram의 한계와 하이브리드 라우팅
* **Trigram의 동작 원리**: 텍스트를 정확히 **연속된 3글자(3 characters)** 단위로 분해하여 색인합니다.
* **치명적 문제**: 검색어가 3글자 미만(1~2글자)일 때는 인덱스에 매칭할 토큰 자체가 없습니다.
  * 일본어/한국어 핵심 어휘의 절반 이상(`魔力`, `魔王`, `勇者`, `마력`, `검사`)은 2글자입니다.
  * 만약 2글자 단어를 무조건 `MATCH '"魔力"'`으로 질의하면 **결과가 0건**으로 나오는 치명적 결함이 발생합니다.
* **해결책 (글자 수 기반 하이브리드 라우팅)**:
  ```python
  clean_q = query.strip()
  if len(clean_q) >= 3:
      # 3글자 이상: Trigram FTS5 인덱스 100% 활용 (1~2ms 초고속 스캔)
      # 예: 'エルフ', 'ため息', '슬라임', '마법사'
      fts_q = '"' + clean_q.replace('"', '""') + '"'
      cursor.execute("SELECT rowid FROM translations_fts WHERE translations_fts MATCH ? LIMIT ?", (fts_q, limit))
  else:
      # 1~2글자 (예: '魔力', '魔王', '용사'): Trigram 토큰 부재 구간이므로 LIKE/폴더 인덱스 폴백
      like_pattern = f"%{clean_q}%"
      cursor.execute("SELECT id FROM translations WHERE original LIKE ? OR translated LIKE ? LIMIT ?", (like_pattern, like_pattern, limit))
  ```

### ② `IF NOT EXISTS` 함정 방지 (기존 unicode61 테이블 강제 마이그레이션)
* 이미 `translations.db`에는 과거 `unicode61`로 생성된 `translations_fts` 테이블이 존재합니다.
* 단순 `CREATE VIRTUAL TABLE IF NOT EXISTS ...`를 실행하면 SQLite는 생성을 건너뛰어 기존 토크나이저가 그대로 유지됩니다.
* **해결책**: `sqlite_master`에서 `translations_fts`의 생성 SQL을 검사하여 `trigram`이 포함되어 있지 않으면 반드시 **`DROP TABLE IF EXISTS translations_fts;`를 실행한 후 재생성 및 rebuild**합니다.

### ③ Connection 캐시(`cache_size`) 한계 극복 ➔ OS 레벨 `mmap_size` 집중
* `server/database.py`가 SQLAlchemy `NullPool` 환경이므로 연결 종료 시 커넥션 레벨 메모리(`cache_size`)는 휘발됩니다.
* 따라서 커넥션마다 무의미하게 64MB 캐시를 할당하는 대신, **OS 레벨 파일 캐시를 공유하는 `PRAGMA mmap_size = 268435456;` (256MB 메모리 매핑)**과 `PRAGMA synchronous = NORMAL;`에 집중하여 디스크 I/O를 원천 차단합니다.

---

## 2. 진짜 검색 병목 대상 전수 개선 (Target Services)

현재 37만 문장에 대해 무거운 `LIKE '%...%'` 풀 테이블 스캔을 돌리고 있는 핵심 병목 파일들을 전수 교체합니다:

1. **[`server/services/similarity_service.py`](file:///C:/LANOVEL/server/services/similarity_service.py)**:
   * `get_top5_expressions()` 및 `get_similar_examples_data()`:
   * 현재 `Translation.original.contains(kw) | Translation.translated.contains(kw)`로 37만 건 전체를 풀 스캔 중.
   * ➔ 하이브리드 FTS5 룩업으로 교체하여 후보 120건을 1ms 내에 추출.
2. **[`server/services/dictionary_service.py`](file:///C:/LANOVEL/server/services/dictionary_service.py)**:
   * `find_corpus_examples()` 및 `get_word_quiz()`:
   * 현재 `Translation.original.contains(kw)`로 풀 스캔 중.
   * ➔ 하이브리드 FTS5 룩업으로 교체.
3. **[`server/services/corpus_ai_service.py`](file:///C:/LANOVEL/server/services/corpus_ai_service.py)**:
   * Tier 1 유사 문장 합성 시 기존에는 단순 문장 길이(`WHERE length(ja_clean) BETWEEN ? AND ? LIMIT 30`)로 무작위 30건을 뽑아 `difflib`을 돌렸음.
   * ➔ 원문에서 3글자 이상 핵심 어절을 추출해 `corpus_templates_fts` (trigram)로 연관도 높은 상위 30건을 뽑아 `difflib`을 돌림으로써 **번역 합성 적중률 극대화**.
4. **[`server/routers/data_crud.py`](file:///C:/LANOVEL/server/routers/data_crud.py)**:
   * 데이터 검색 엔드포인트의 하이브리드 분기 적용.

---

## 3. 새 세션 실행 단계별 체크리스트 (Step-by-Step Tasks)

### [Task 1] `translations_fts` 스키마 검사 및 Trigram 재생성
* [ ] [`server/server.py`](file:///C:/LANOVEL/server/server.py)의 `init_indexes()` 고도화:
  ```python
  # 기존 테이블이 trigram을 쓰는지 스키마 검증
  row = connection.exec_driver_sql("SELECT sql FROM sqlite_master WHERE type='table' AND name='translations_fts'").fetchone()
  need_recreate = True
  if row and row[0] and "trigram" in row[0].lower():
      need_recreate = False
      
  if need_recreate:
      logger.info("Migrating translations_fts to Trigram tokenizer...")
      connection.exec_driver_sql("DROP TABLE IF EXISTS translations_fts;")
      connection.exec_driver_sql("""
          CREATE VIRTUAL TABLE translations_fts USING fts5(
              original,
              translated,
              content='translations',
              content_rowid='id',
              tokenize='trigram'
          );
      """)
      connection.exec_driver_sql("INSERT INTO translations_fts(translations_fts) VALUES('rebuild');")
  ```

### [Task 2] 하이브리드 검색 헬퍼 모듈 작성 (`server/services/search_helper.py`)
* [ ] 3글자 이상 `MATCH`, 1~2글자 `LIKE`를 전담하는 공통 함수 구현:
  ```python
  def search_translation_ids(db_cursor, query: str, limit: int = 100, folder: Optional[str] = None) -> List[int]:
      clean_q = (query or "").strip()
      if not clean_q:
          return []
          
      if len(clean_q) >= 3:
          fts_q = '"' + clean_q.replace('"', '""') + '"'
          if folder:
              # folder 필터가 있을 경우 메인 테이블 JOIN
              sql = """
                  SELECT t.id FROM translations_fts f
                  JOIN translations t ON f.rowid = t.id
                  WHERE translations_fts MATCH ? AND t.folderName = ?
                  LIMIT ?
              """
              rows = db_cursor.execute(sql, (fts_q, folder, limit)).fetchall()
          else:
              sql = "SELECT rowid FROM translations_fts WHERE translations_fts MATCH ? LIMIT ?"
              rows = db_cursor.execute(sql, (fts_q, limit)).fetchall()
          return [r[0] for r in rows]
      else:
          # 1~2글자: LIKE 폴백 (folder 인덱스 적극 활용)
          like_pat = f"%{clean_q}%"
          if folder:
              sql = "SELECT id FROM translations WHERE folderName = ? AND (original LIKE ? OR translated LIKE ?) LIMIT ?"
              rows = db_cursor.execute(sql, (folder, like_pat, like_pat, limit)).fetchall()
          else:
              sql = "SELECT id FROM translations WHERE original LIKE ? OR translated LIKE ? LIMIT ?"
              rows = db_cursor.execute(sql, (like_pat, like_pat, limit)).fetchall()
          return [r[0] for r in rows]
  ```

### [Task 3] `similarity_service.py` & `dictionary_service.py` 풀 스캔 제거
* [ ] [`server/services/similarity_service.py`](file:///C:/LANOVEL/server/services/similarity_service.py):
  * `get_top5_expressions()`: `Translation.original.contains(kw)` 대신 `search_translation_ids()`로 ID 리스트를 먼저 가져온 후 `Translation.id.in_(ids)`로 조회.
* [ ] [`server/services/dictionary_service.py`](file:///C:/LANOVEL/server/services/dictionary_service.py):
  * `find_corpus_examples()`: 동일하게 하이브리드 검색 함수 적용.
* [ ] [`server/routers/data_crud.py`](file:///C:/LANOVEL/server/routers/data_crud.py):
  * 기존 FTS5 검색 블록을 `search_translation_ids()` 헬퍼로 통합 교체.

### [Task 4] `corpus_ai_service.py` 템플릿 후보 Trigram 추출 적용
* [ ] [`server/database_corpus.py`](file:///C:/LANOVEL/server/database_corpus.py):
  * `corpus_templates_fts USING fts5(ja_clean, translated, tokenize='trigram')` 신설.
* [ ] [`server/services/corpus_ai_service.py`](file:///C:/LANOVEL/server/services/corpus_ai_service.py):
  * Tier 1 매칭 시, 입력 문장에서 3글자 이상 키워드를 추출하여 `corpus_templates_fts MATCH`로 유사 후보 30건을 정밀 추출하도록 개선.

### [Task 5] SQLite 엔진 OS 메모리 매핑(`mmap_size`) 최적화
* [ ] [`server/database.py`](file:///C:/LANOVEL/server/database.py) 및 [`server/database_corpus.py`](file:///C:/LANOVEL/server/database_corpus.py):
  * `NullPool`에서도 효과가 유지되는 OS 레벨 튜닝 적용:
    ```python
    cursor.execute("PRAGMA journal_mode = WAL;")
    cursor.execute("PRAGMA synchronous = NORMAL;")
    cursor.execute("PRAGMA mmap_size = 268435456;")  # 256MB OS 페이지 캐시 매핑
    ```

---

## 4. 검증 및 테스트 방법 (Verification)

1. **1~2글자 검색 누락 방지 전수 검증 (가장 중요)**:
   * 2글자 단어(`魔力`, `魔王`, `마력`, `용사`) 검색 시 결과가 0건이 나오지 않고 정상 반환되는지 확인.
   * 3글자 단어(`エルフ`, `ため息`, `슬라임`) 검색 시 FTS5 `MATCH` 인덱스를 타고 **2ms 이내**에 응답하는지 확인.
2. **`similarity_service` 응답 속도 측정**:
   * 관리자 화면에서 단락 클릭 시 하단 유사 번역 도크 로딩 시간이 기존 ~300ms에서 **10ms 이하**로 단축되었는지 확인.
3. **인덱스 용량 점검**:
   * `translations.db` 파일 크기 증가폭 확인 (예상 증가치: +150~200MB). 디스크 여유 공간 정상 여부 확인.
4. **Pytest 단위 테스트**:
   ```bash
   pytest tests/test_data_crud.py
   pytest tests/test_similarity.py
   ```

---

## 5. 롤백 및 안전장치 (Safety & Rollback)

* FTS5 가상 테이블은 인덱스이므로, 문제 발생 시 `DROP TABLE translations_fts;`를 실행하면 언제든 원본 데이터 손실 없이 롤백됩니다.
* `search_translation_ids()` 헬퍼 내부에 `try...except`를 두어 FTS 오류 시 안전하게 기존 `LIKE` 쿼리로 자동 폴백되도록 2중 안전장치를 마련합니다.

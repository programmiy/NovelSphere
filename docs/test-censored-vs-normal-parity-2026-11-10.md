# 검열 소설 vs 정상 번역 상호 역격리 및 통계/미분류 완전 무결성 검증

> **작업 일자**: 2026-11-10  
> **관련 모듈**: `server/routers/data_crud.py`, `server/quota.py`, `server/services/collector_service.py`, `tests/test_censored_vs_normal_strict_parity.py`

---

## 1. 검증 배경 및 사용자 요구사항

사용자 지시:
> **"검열소설만 미분류보관함으로 이동하지않고 자기이름 폴더 생성해서 보관되어야하고 통계에 잡히지도 않아야하고 정상번역은 이거의 역인지 다시한번검증해"**

### 핵심 대조 기준 (Exact Parity Matrix)

| 구분 | 미분류 보관함 유입 여부 | 서재 폴더 생성/귀속 | 오늘 번역/API 통계 집계 |
| :--- | :--- | :--- | :--- |
| **검열 소설** (`ManualTranslationNovel` / `/raw_collector`) | ❌ **절대 안 감** (`folderName` 본인 이름 유지) | ⭕ **자기이름 폴더로 서재 직행** | ❌ **영구 원천 배제 (0건)** (`timestamp=0`, 쿼리 제외) |
| **정상 번역** (브라우저 확장 / 일반 웹소설) | ⭕ **100% 미분류 보관함 적재** (`folderName=None`) | ❌ **자기이름 폴더 생성 절대 금지** | ⭕ **정상 100% 집계** (문단/회차/쿼터 실적 반영) |

---

## 2. 코드베이스 전수 검증 및 보강 내역

### 2-1. 검열 소설 원천 통계 배제 보강
1. **`server/services/collector_service.py`**:
   - 원문 수집 시 `timestamp=0`으로 적재하도록 명시하여 통계 윈도우(`timestamp >= window_start`)에 유입되는 것을 원천 차단.
2. **`server/quota.py` (`get_today_translations_count`, `get_today_episodes_count`)**:
   - `manual_folders = {r[0] for r in db.query(ManualTranslationNovel.folderName).all() if r[0]}`
   - `today_urls` 및 `count` 쿼리에 `Translation.folderName.notin_(manual_folders)` 및 `Translation.translated != ""` 조건을 결합하여 검열 소설과 빈칸 레코드가 통계에 1문단이라도 잡히는 것을 영구 방어.
3. **운영 DB 정리**:
   - `manual_translation_novels`에 등록된 검열 소설의 잔여 `timestamp > 0` 레코드 6건을 `timestamp = 0`으로 정리 완료.

### 2-2. 정상 번역 미분류 보관함 직행 및 통계 집계 보장
1. **`server/routers/data_crud.py` (`upsert_translations`)**:
   - `is_manual_novel`이 아닌 모든 정상 번역은 신규 저장 시 무조건 `new_folder = None` (미분류 보관함).
   - 동일 URL 동기화에서도 `manual_folders`가 아니면 미분류 레코드를 절대로 기존 폴더로 덮어쓰지 않음.
   - 정상 번역 타임스탬프(`timestamp=item.timestamp`)는 유지되어 오늘 번역 문단/회차 수 및 API 쿼터에 정상 실적으로 계측됨.

---

## 3. 단위 테스트 검증 결과

- `tests/test_censored_vs_normal_strict_parity.py`: 검열 소설(폴더 유지, 통계 0건) vs 정상 번역(미분류 강제, 통계 정확 집계) 상호 역격리 동작 100% 검증 통과.
- 미분류/복원 관련 전체 11개 테스트(1.88s) 전원 통과.

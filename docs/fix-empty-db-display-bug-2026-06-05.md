# 목록 조회 본문 텍스트 누락으로 인한 빈 화면 버그 수정 (2026-06-05)

## 1. 수정 배경
* DB 성능 개선 후 웹 UI 및 익스텐션 화면에서 데이터가 보이지 않아 DB가 누락된 것처럼 표시되는 현상이 발생했습니다.

## 2. 원인 분석
* 목록 조회 API 경량화 과정에서 [data_crud.py](file:///C:/LANOVEL/server/routers/data_crud.py)의 `/translations_by_folder` 엔드포인트가 본문(`original`, `translated`) 데이터를 제외(빈 문자열)하고 전송하도록 수정되었습니다.
* 하지만 웹 UI([admin.js](file:///C:/LANOVEL/server/static/admin.js)) 및 익스텐션([history.js](file:///C:/LANOVEL/extension/history.js))은 해당 API 응답의 본문 데이터를 참조해 화면을 직접 그리도록 설계되어 있습니다. 이 때문에 화면에 텍스트가 표시되지 않는 오동작이 발생했습니다.
* **실제 데이터베이스 파일(185MB)의 원본 데이터는 유실 없이 온전히 보존되어 있습니다.**

## 3. 해결 조치
* [data_crud.py](file:///C:/LANOVEL/server/routers/data_crud.py#L264-L290)에서 `Translation.original`과 `Translation.translated` 필드를 다시 쿼리하고 응답에 포함시켜 전달하도록 복구했습니다.

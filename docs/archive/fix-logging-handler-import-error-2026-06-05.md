# logging.handlers 임포트 오류 수정 (2026-06-05)

## 1. 수정 배경
* 로컬 개발 환경에서 `pytest` 실행 시, `tests/test_main.py` 수집 과정에서 아래와 같은 오류가 발생하며 전체 테스트가 중단되는 현상이 있었습니다.
  ```text
  AttributeError: module 'logging' has no attribute 'handlers'
  ```

## 2. 변경 사항
* [server.py](file:///C:/LANOVEL/server/server.py)의 임포트 구문에 `import logging.handlers`를 추가하여 `TimedRotatingFileHandler` 참조 시 발생하는 `AttributeError`를 해결했습니다.
  ```diff
  @@ -6,3 +6,4 @@
   import subprocess
   import logging
  +import logging.handlers
   from contextlib import asynccontextmanager
  ```

## 3. 결과 검증
* `pytest` 실행 결과, 수집(Collection) 에러가 해결되고 테스트 러너가 정상 작동하는 것을 확인했습니다.

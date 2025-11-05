# 리팩토링으로 인한 NameError 버그 수정

## 작업 일시
- 2025년 11월 5일

## 문제 상황
- `server.py`의 엔드포인트를 각 라우터로 분리하는 리팩토링을 진행한 후, `translation.py`에서 `NameError: name 'script_dir' is not defined` 오류가 발생하며 서버 실행에 실패했습니다.

## 원인 분석
- 리팩토링 과정에서 각 라우터의 `DATABASE_FILE` 정의를 `config.py`로 중앙화하면서 `script_dir` 변수의 정의를 함께 제거했습니다.
- 하지만 `translation.py`에서는 여전히 `script_dir` 변수를 사용하여 `API_KEY_FILE`의 경로를 설정하고 있어 `NameError`가 발생했습니다.
- 또한, `get_api_key` 함수가 `server.py`와 `translation.py`에 중복으로 존재하고, `server.py`의 함수는 더 이상 사용되지 않는 상태였습니다.

## 해결 내용
1.  **설정 중앙화:** `API_KEY_FILE` 상수 또한 `config.py`로 이동하여 설정을 중앙화했습니다.
2.  **의존성 수정:** `translation.py`가 `config.py`에서 `API_KEY_FILE`을 직접 임포트하도록 수정하여 `script_dir` 의존성을 제거했습니다.
3.  **코드 정리:** `server.py`에 남아있던 중복되고 사용되지 않는 `get_api_key` 함수를 삭제했습니다.

## 기대 효과
- 서버가 정상적으로 실행됩니다.
- 설정이 `config.py`로 중앙화되어 코드의 일관성과 유지보수성이 향상됩니다.

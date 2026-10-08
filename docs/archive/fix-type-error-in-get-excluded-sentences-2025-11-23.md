# [버그 수정] 제외된 문장 조회 API의 TypeError 해결

- **파일:** `server/routers/translation.py`
- **날짜:** 2025-11-23

## 문제

`GET /excluded_sentences` 엔드포인트에서 내부 헬퍼 함수 `_get_excluded_sentences_for_url`를 호출할 때 데이터베이스 세션(`db`) 인자를 전달하지 않아 `TypeError`가 발생하는 문제가 있었습니다.

## 해결

`get_excluded_sentences` 함수 내에서 `_get_excluded_sentences_for_url` 함수를 호출할 때 `db` 객체를 올바르게 전달하도록 수정했습니다.

**수정 전:**
```python
def get_excluded_sentences(url: str, db: Session = Depends(get_db)):
    excluded_originals = _get_excluded_sentences_for_url(url)
    return {"excluded_texts": list(excluded_originals)}
```

**수정 후:**
```python
def get_excluded_sentences(url: str, db: Session = Depends(get_db)):
    excluded_originals = _get_excluded_sentences_for_url(url, db)
    return {"excluded_texts": list(excluded_originals)}
```

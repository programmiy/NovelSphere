# [Feature] 번역 모델을 Gemini 2.5 Pro로 변경

- **파일:** `server/routers/translation.py`
- **날짜:** 2025-11-14

## 변경 내용

기존에 사용하던 `gemini-2.5-flash` 모델에서 `gemini-2.5-pro` 모델로 번역 API를 변경했습니다.

- **이유:** 번역 품질 향상 및 특정 문제 해결을 위해 더 강력한 모델로 전환합니다.
- **영향:** 번역 요청 시 Pro 모델을 사용하게 되므로, 번역 결과의 정확성과 일관성이 향상될 것으로 기대됩니다.

### 기존 코드

```python
api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key={settings.gemini_api_key}"
```

### 변경된 코드

```python
api_url = f"https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key={settings.gemini_api_key}"
```

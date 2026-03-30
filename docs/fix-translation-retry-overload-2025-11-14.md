# [Fix] 번역 재시도 시 과부하 방지를 위한 지연 시간 증가

- **파일:** `extension/content.js`
- **날짜:** 2025-11-14

## 문제

번역 묶음(chunk) 처리에 실패했을 때, `handleFailure` 함수가 실패한 묶음을 더 작은 단위로 나누어 재시도하는 과정에서 API 서버에 과부하를 유발할 수 있었습니다. 이는 재시도되는 묶음 간의 지연 시간이 1초로 매우 짧아, 짧은 시간 안에 여러 요청이 몰렸기 때문입니다.

## 해결

`handleFailure` 함수 내에서 재시도되는 묶음(sub-chunk) 사이의 대기 시간을 1초(1000ms)에서 10초(10000ms)로 늘렸습니다.

- 이 변경을 통해, 실패한 번역 작업이 재시도될 때 서버에 가해지는 부하를 분산시키고, `503 Service Unavailable`과 같은 과부하 오류 발생 가능성을 줄였습니다.

### 기존 코드

```javascript
                if (index < subChunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 1000));
                }
```

### 변경된 코드

```javascript
                if (index < subChunks.length - 1) {
                    await new Promise(resolve => setTimeout(resolve, 10000));
                }
```

# CI 워크플로우의 자동 병합 오류 수정

## 문제

`extra` 브랜치에 푸시할 때 실행되는 `auto-pr.yml` 워크플로우가 Pull Request(PR)를 생성한 직후 자동 병합(auto-merge)을 활성화하려고 시도했습니다. 하지만 이 시점에는 아직 다른 CI 파이프라인(테스트, 린트 등)의 상태 확인이 완료되지 않았기 때문에, PR이 불안정한(unstable) 상태로 간주되어 다음과 같은 GraphQL API 오류가 발생했습니다.

```
GraphQL: Pull request Pull request is in unstable status (enablePullRequestAutoMerge)
```

## 해결

사용자의 요청에 따라, 오류를 유발하는 자동 병합 활성화 단계를 `auto-pr.yml` 워크플로우에서 완전히 제거했습니다. 이로써 PR은 생성만 되고, 병합은 수동으로 또는 다른 조건에 따라 처리될 수 있도록 변경되었습니다.

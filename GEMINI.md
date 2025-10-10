앞으로 모든 답변은 한국어로 하고, 전문가처럼 간결하게 핵심만 말해줘.

[코드를 수정해야할 때]

1. **코드 수정:** 요청된 코드 수정 작업을 수행합니다. 복잡한 작업일경우 분할해 수행한다.
3. 기능이 정상작동되는지 확인하고 이후의 단계를 진행합니다.
4. **문서 생성:**

   * 수정 사항에 대한 마크다운 문서를 프로젝트 루트의 `docs/` 폴더 안에 생성합니다.
   * 파일명은 `docs/[기능]-[버전].md` 형식으로 합니다. (예: `docs/fix-login-bug-v1.1.md`)
5. **커밋:**

   * 수정된 **코드 파일**과 생성된 **문서 파일**을 함께 스테이징합니다.
   * 두 파일을 **하나의 커밋**으로 묶습니다. 커밋 메시지는 문서 파일명과 유사하게 작성합니다.
6. 원격 저장소 는 `main`만 존재 , `origin`사용하지 않음
7. **마무리:** (git push main extra (로컬 extra를 원격 main에 푸시)
## 8. 권장 병합 워크플로우 (Rebase 사용)

`extra` 브랜치의 작업이 완료되면, 아래의 `rebase` 방식을 따라 충돌을 최소화하며 `main`에 병합합니다.

1.  **`main` 브랜치 최신화**
    ```shell
    git checkout main
    git pull main main
    ```

2.  **`extra` 브랜치 재배치 (Rebase)**
    ```shell
    git checkout extra
    git rebase main
    ```
    *(이 과정에서 충돌이 발생하면, `extra` 브랜치에서 먼저 해결합니다.)*

3.  **`main` 브랜치에 병합 및 푸시**
    ```shell
    git checkout main
    git merge extra
    git push main main
    ```

4.  **작업 브랜치로 복귀**
    ```shell
    git checkout extra
    ```
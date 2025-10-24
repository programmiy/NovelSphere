앞으로 모든 답변은 한국어로 하고, 전문가처럼 간결하게 핵심만 말해줘.

[코드를 수정해야할 때]

1. **코드 수정:** 요청된 코드 수정 작업을 수행합니다. 복잡한 작업일경우 분할해 수행한다.
2. 기능이 정상작동되는지 확인하고 이후의 단계를 진행합니다.
3. **문서 생성:**

   * 수정 사항에 대한 마크다운 문서를 프로젝트 루트의 `docs/` 폴더 안에 생성합니다.
   * 파일명은 `docs/[기능]-[버전].md` 형식으로 합니다. (예: `docs/fix-login-bug-v1.1.md`)
4. **커밋:**

   * 수정된 **코드 파일**과 생성된 **문서 파일**을 함께 스테이징합니다.
   * 두 파일을 **하나의 커밋**으로 묶습니다. 커밋 메시지는 문서 파일명과 유사하게 작성합니다.
5. 원격 저장소 는 `main`만 존재 , `origin`사용하지 않음
6. **마무리:** (git push main extra:extragit push main extra (로컬 extra를 원격 EXTRA에 푸시)

## 8. 병합 워크플로우 (Pull Request 사용)

7번 항목(`git push main extra:extra`)을 실행하여 '원격 `extra` 브랜치'로 코드를 푸시한 후, 아래의 Pull Request(PR) 방식을 따릅니다


1. Pull Request(PR) 생성

* Git 플랫폼(GitHub, GitLab 등)에서 `extra` 브랜치 → `main` 브랜치로의 PR을 생성합니다.

2. MCP 서버 자동 테스트 실행

* PR이 생성되면, MCP 서버가 이를 자동으로 감지합니다.
* 서버는 3번 항목(기능 테스트)과 4번 항목(문서 존재 여부)을 자동으로 검사합니다.

3. **병합 (Merge)**

   * 모든 자동 테스트가 통과하고 동료의 코드 리뷰가 완료되면, PR을 `main` 브랜치로 병합합니다.
   * *(권장: `Rebase and Merge` 옵션을 사용하여 `main` 브랜치의 커밋 히스토리를 깔끔하게 유지합니다.)*

   4. **작업 브랜치로 복귀**

      * `main` 브랜치가 최신화되었으므로, 로컬 `extra` 브랜치도 최신 `main`을 반영합니다.
        ```shell
        git checkout main
        git pull main main
        git checkout extra
        git rebase main
        ```

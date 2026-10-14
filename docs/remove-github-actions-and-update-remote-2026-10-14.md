# CI/CD(GitHub Actions) 제거 및 원격 저장소 설정 갱신 (2026-10-14)

## 1. 개요
* 기존 LANOVEL 저장소(`main` 리모트)와의 연결을 종료하고, NovelSphere 저장소(`origin` 리모트) 체계로 전환함에 따라 불필요해진 GitHub Actions CI/CD 워크플로우를 제거함.
* `GEMINI.md` 내 원격 푸시 및 브랜치 동기화 작업 가이드를 최신 저장소(`origin`) 구조에 맞게 갱신함.

## 2. 세부 변경 사항
1. **GitHub Actions 워크플로우 제거 (`.github/workflows/`)**
   * `.github/workflows/ci-pipeline.yml`: PR 생성 시 pytest 및 docs 변경 검사를 수행하던 파이프라인 삭제
   * `.github/workflows/auto-pr.yml`: `extra` 브랜치 푸시 시 자동 PR을 생성하던 워크플로우 삭제
   * `.github/` 디렉토리 완전 정리

2. **원격 저장소 가이드 갱신 (`GEMINI.md`)**
   * 기존: `main` 리모트 사용 (`git push main extra:main`), GitHub Actions 자동 병합 전제
   * 변경: `origin` 리모트(`NovelSphere.git`) 기준 적용 (`git push origin extra:main`), 로컬 브랜치 병합 방식으로 정리

## 3. 영향도 분석
* 애플리케이션 런타임(FastAPI 서버, Chrome 확장 프로그램, Flutter 모바일 앱 등) 코드와는 무관하므로 서비스 구동 및 빌드에 영향 없음.
* 향후 단위 테스트는 로컬 환경에서 `pytest`를 직접 구동하여 검증 진행.

# [Part 3] LANOVEL 모바일 앱(Flutter) 하이퍼 에스테틱 럭셔리 & 햅틱 UI 개편 명세서

> **디자인 기조**: **Hyper-Aesthetic Luminary & Haptic Luxury**  
> **핵심 방향**: 앰비언트 오로라 메쉬, 유려한 글래스모피즘(Glassmorphism), 네온 글로우 등 **일부러 설계된 고비용 프리미엄 리소스를 100% 유지**하되, 고비용 그래픽이 120fps ProMotion 디스플레이에서도 물 흐르듯 매끄럽게 구동되도록 **렌더링 레이어 최적화(RepaintBoundary)** 및 **Thumb Zone 48dp 터치 타깃**을 정밀 완성  
> **대상 파일**:
> - `mobile_app/lib/ui/library/library_screen.dart`
> - `mobile_app/lib/ui/themes/hyper_aesthetic_theme.dart`
> - `mobile_app/lib/ui/themes/reader_themes.dart`

---

## 1. 정체성 재정의: 하이퍼 에스테틱의 럭셔리 마감

LANOVEL 모바일 앱의 '하이퍼 에스테틱(Hyper-Aesthetic Luminary UI)'은 흔한 플랫 앱들의 단조로움을 거부하고, **"자원 소모를 아끼지 않는 극상의 감성적 비주얼과 손끝으로 전해지는 아날로그 햅틱"**을 제공하기 위해 설계된 의도적인 아트워크입니다. 이번 개편은 이 정체성을 완벽히 보존하며 명품 수준의 퍼포먼스를 달성합니다:

1. **고비용 앰비언트 오로라 메쉬 (`HyperAmbientMeshBackground`)의 120fps 캐싱**:
   - 화면 배경에서 부드럽게 유영하는 오로라 메쉬의 몽환적인 비주얼을 유지합니다.
   - 서재 스크롤 시 오로라 셰이더가 불필요하게 전체 화면을 리페인팅하지 않도록 `RepaintBoundary`로 레이어를 완전히 격리하여, 고사양의 화려한 배경 위에서도 서재 스크롤이 120fps로 극도로 부드럽게 작동하도록 최적화.
2. **글래스모피즘 독(Glass Dock)과 Thumb Zone의 완벽한 조화**:
   - 하단 플로팅 글래스 바의 초정밀 백드롭 블러(BackdropFilter), 은은한 네온 림라이트(Glow)의 럭셔리한 느낌을 유지.
   - 내부 탭 아이콘의 터치 타깃을 **정확히 48×48dp**로 보장하고, 탭 선택 시 애플 Taptic Engine 수준의 섬세한 다단 햅틱(`HapticFeedback.selectionClick()`) 튜닝.
3. **책 표지(Tome Card)의 3D 뎁스 및 루미너리 림라이트**:
   - 책 표지 테두리에 테마별 앰비언트 포인트 컬러가 미세하게 반사되는 **루미너리 림라이트(Luminary Rim-light)** 적용.
   - 독서 진도율(Progress) 바를 단순 막대가 아닌 보석처럼 빛나는 마이크로 네온 게이지로 승화.

---

## 2. 구체적 Dart 코드 고도화 명세 (`library_screen.dart`)

### 2.1 오로라 메쉬의 격리 렌더링 (RepaintBoundary Layer Isolation)
```dart
@override
Widget build(BuildContext context) {
  final currentTheme = ReaderThemes.currentTheme;

  return Scaffold(
    backgroundColor: currentTheme.backgroundColor,
    body: Stack(
      children: [
        // [1] 의도된 고비용 오로라 메쉬를 독립 렌더 레이어로 격리 (스크롤과 연산 분리)
        Positioned.fill(
          child: RepaintBoundary(
            child: HyperAmbientMeshBackground(
              theme: currentTheme,
              child: const SizedBox.expand(),
            ),
          ),
        ),

        // [2] 전면 서재 콘텐츠 스크롤 뷰 (버벅임 제로, 120fps 보장)
        Positioned.fill(
          child: _buildCurrentTab(currentTheme),
        ),

        // [3] 하단 하이퍼 에스테틱 글래스 도킹 바
        Positioned(
          left: 0,
          right: 0,
          bottom: 0,
          child: _buildHyperGlassBottomBar(currentTheme),
        ),
      ],
    ),
  );
}
```

### 2.2 럭셔리 글래스 독 (Thumb Zone & 48dp 터치 보장)
블러와 글로우를 살리면서 손가락이 닿는 모든 면적을 48dp 터치 타깃으로 확보:
```dart
Widget _buildHyperGlassBottomBar(ReaderThemeData theme) {
  final primary = HyperAestheticTheme.getAmbientPrimary(theme);

  return SafeArea(
    child: Container(
      margin: const EdgeInsets.fromLTRB(16, 0, 16, 12),
      height: 68,
      decoration: HyperAestheticTheme.glassBox(
        theme: theme,
        borderRadius: 34,
        opacity: 0.78,
        borderWidth: 1.2,
        glow: true,
        glowColor: primary.withOpacity(0.28),
      ),
      child: ClipRRect(
        borderRadius: BorderRadius.circular(34),
        child: BackdropFilter(
          filter: ImageFilter.blur(sigmaX: 24, sigmaY: 24),
          child: Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: List.generate(items.length, (idx) {
              final isSelected = (_currentNavIndex == idx);
              final item = items[idx];

              return InkWell(
                onTap: () {
                  HapticFeedback.selectionClick();
                  setState(() => _currentNavIndex = idx);
                  if (idx == 0) _loadLibrary();
                },
                borderRadius: BorderRadius.circular(24),
                // 최소 48x48dp 이상의 안전한 엄지 터치 영역 확보
                child: ConstrainedBox(
                  constraints: const BoxConstraints(minWidth: 54, minHeight: 48),
                  child: AnimatedContainer(
                    duration: const Duration(milliseconds: 250),
                    curve: Curves.easeOutBack, // 탄력 있는 마이크로 인터랙션
                    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 8),
                    decoration: BoxDecoration(
                      color: isSelected ? primary.withOpacity(0.22) : Colors.transparent,
                      borderRadius: BorderRadius.circular(20),
                      border: isSelected ? Border.all(color: primary.withOpacity(0.5), width: 1.2) : null,
                    ),
                    child: Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        Icon(
                          item['icon'] as IconData,
                          size: 22,
                          color: isSelected ? primary : theme.subTextColor.withOpacity(0.7),
                        ),
                        if (isSelected) ...[
                          const SizedBox(width: 8),
                          Text(
                            item['label'] as String,
                            style: TextStyle(
                              color: isSelected ? primary : theme.textColor,
                              fontSize: 13,
                              fontWeight: FontWeight.bold,
                              letterSpacing: -0.2,
                            ),
                          ),
                        ],
                      ],
                    ),
                  ),
                ),
              );
            }),
          ),
        ),
      ),
    ),
  );
}
```

### 2.3 럭셔리 북 커버 (Luminary Rim-light)
책 표지 테두리에 테마별 앰비언트 글로우가 은은하게 흐르는 하이엔드 카드:
```dart
Widget _buildHyperBookCard(Book book, ReaderThemeData theme) {
  final accent = HyperAestheticTheme.getAmbientPrimary(theme);

  return Container(
    decoration: BoxDecoration(
      borderRadius: BorderRadius.circular(16),
      boxShadow: [
        BoxShadow(
          color: (theme.isDark ? Colors.black : Colors.black12).withOpacity(0.3),
          blurRadius: 16,
          offset: const Offset(0, 8),
        ),
        // 은은한 루미너리 림라이트
        BoxShadow(
          color: accent.withOpacity(theme.isDark ? 0.18 : 0.08),
          blurRadius: 20,
          spreadRadius: 1,
        ),
      ],
    ),
    child: ClipRRect(
      borderRadius: BorderRadius.circular(16),
      child: Stack(
        children: [
          // 책 표지 및 콘텐츠
          _buildCoverContent(book, theme),
          // 미세한 상단 글래스 하이라이트 림
          Positioned(
            top: 0, left: 0, right: 0, height: 1.5,
            child: Container(
              decoration: BoxDecoration(
                gradient: LinearGradient(
                  colors: [Colors.white.withOpacity(0.4), Colors.transparent],
                ),
              ),
            ),
          ),
        ],
      ),
    ),
  );
}
```

---

## 3. 실행 체크리스트 (별도 세션 진행용)

1. [ ] `HyperAmbientMeshBackground`를 `RepaintBoundary`로 감싸 스크롤 성능 120fps 보장
2. [ ] 하단 글래스 캡슐 바의 각 아이템 터치 타깃을 최소 48×48dp로 정밀 확장
3. [ ] 탭 선택 및 책 터치 시 기분 좋은 햅틱(`selectionClick`, `lightImpact`) 피드백 튜닝
4. [ ] 책 그리드 커버에 루미너리 림라이트와 3D 뎁스 섀도우를 추가하여 압도적 시각미 완성
5. [ ] 다크/미드나이트/세피아 테마별 앰비언트 컬러 조화 최종 검증

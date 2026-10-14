import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'reader_themes.dart';

/// ============================================================================
/// LANOVEL 하이퍼 에스테틱 모바일 디자인 시스템 (Hyper-Aesthetic Luminary UI)
/// ----------------------------------------------------------------------------
/// - 자원 소모를 아끼지 않는 극상의 비주얼 에스테틱 (Fluid Ambient Blur, Glassmorphism)
/// - 한 손 조작성을 극한으로 끌어올린 햅틱 인터랙티브 컴포넌트
/// ============================================================================

class HyperAestheticTheme {
  /// 테마별 앰비언트 글로우 메인 컬러 추출
  static Color getAmbientPrimary(ReaderThemeData theme) {
    if (theme.isDark) {
      if (theme.id == 'midnight') return const Color(0xFF6366F1); // Indigo
      if (theme.id == 'charcoal') return const Color(0xFF10B981); // Emerald
      if (theme.id == 'mocha') return const Color(0xFFF59E0B);    // Amber
      if (theme.id == 'slate') return const Color(0xFF38BDF8);    // Sky
      return const Color(0xFF8B5CF6);                             // Purple
    } else {
      if (theme.id == 'mint') return const Color(0xFF10B981);
      if (theme.id == 'rose') return const Color(0xFFF43F5E);
      if (theme.id == 'lavender') return const Color(0xFF8B5CF6);
      if (theme.id == 'sepia') return const Color(0xFFD97706);
      return const Color(0xFF3B82F6);
    }
  }

  static Color getAmbientSecondary(ReaderThemeData theme) {
    if (theme.isDark) {
      if (theme.id == 'midnight') return const Color(0xFFEC4899);
      if (theme.id == 'charcoal') return const Color(0xFF06B6D4);
      if (theme.id == 'mocha') return const Color(0xFFEA580C);
      return const Color(0xFF3B82F6);
    } else {
      if (theme.id == 'mint') return const Color(0xFF06B6D4);
      if (theme.id == 'rose') return const Color(0xFFFB923C);
      if (theme.id == 'lavender') return const Color(0xFFEC4899);
      return const Color(0xFF8B5CF6);
    }
  }

  /// 정제된 싱글 레벨 서피스 및 글래스 박스 데코레이션
  static BoxDecoration glassBox({
    required ReaderThemeData theme,
    double borderRadius = 18,
    double opacity = 1.0,
    Color? customTint,
    Color? customBorder,
    double borderWidth = 1.0,
    bool glow = false,
    Color? glowColor,
  }) {
    final baseColor = customTint ?? theme.surfaceColor;
    final borderColor = customBorder ?? (theme.isDark
        ? Colors.white.withOpacity(0.09)
        : theme.borderColor.withOpacity(0.85));

    final effectiveGlow = glowColor ?? getAmbientPrimary(theme);

    return BoxDecoration(
      color: baseColor.withOpacity(opacity.clamp(0.0, 1.0)),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: borderColor,
        width: borderWidth,
      ),
      boxShadow: [
        BoxShadow(
          color: Colors.black.withOpacity(theme.isDark ? 0.28 : 0.04),
          blurRadius: 10,
          offset: const Offset(0, 3),
        ),
        if (glow)
          BoxShadow(
            color: effectiveGlow.withOpacity(theme.isDark ? 0.16 : 0.08),
            blurRadius: 16,
            spreadRadius: 1,
            offset: const Offset(0, 2),
          ),
      ],
    );
  }
}

/// ============================================================================
/// 배경 앰비언트 서피스 위젯 (Lightweight Static Ambient Surface)
/// ----------------------------------------------------------------------------
/// GPU 부하를 유발하는 무한 회전 블러를 제거하고, 정갈한 단색 배경과 미세한
/// 앰비언트 비네트 효과를 RepaintBoundary로 완전히 격리하여 120fps 스크롤 성능 보장
/// ============================================================================
class HyperAmbientMeshBackground extends StatelessWidget {
  final ReaderThemeData theme;
  final Widget child;

  const HyperAmbientMeshBackground({
    super.key,
    required this.theme,
    required this.child,
  });

  @override
  Widget build(BuildContext context) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);
    final secondary = HyperAestheticTheme.getAmbientSecondary(theme);

    return RepaintBoundary(
      child: Stack(
        children: [
          // 1. 테마 기본 단색 배경
          Positioned.fill(
            child: ColoredBox(color: theme.background),
          ),

          // 2. 미세한 정적 앰비언트 비네트 (GPU 프레임 드랍 제로)
          Positioned.fill(
            child: DecoratedBox(
              decoration: BoxDecoration(
                gradient: RadialGradient(
                  center: const Alignment(0.65, -0.75),
                  radius: 1.3,
                  colors: [
                    primary.withOpacity(theme.isDark ? 0.08 : 0.035),
                    secondary.withOpacity(theme.isDark ? 0.04 : 0.015),
                    Colors.transparent,
                  ],
                  stops: const [0.0, 0.45, 1.0],
                ),
              ),
            ),
          ),

          // 3. 전면 실제 콘텐츠
          Positioned.fill(
            child: child,
          ),
        ],
      ),
    );
  }
}

/// ============================================================================
/// 정제된 단일 레벨 서피스 카드 (Single-Level Surface Card)
/// ----------------------------------------------------------------------------
/// 스크롤 뷰 내 불필요한 BackdropFilter를 배제하여 120fps 부드러움을 보장하고,
/// 섬세한 1px 헤어라인 보더와 절제된 깊이감으로 Impeccable 원칙 준수
/// ============================================================================
class HyperGlassCard extends StatelessWidget {
  final ReaderThemeData theme;
  final Widget child;
  final double borderRadius;
  final double blur;
  final double opacity;
  final Color? customTint;
  final Color? customBorder;
  final EdgeInsetsGeometry padding;
  final EdgeInsetsGeometry? margin;
  final bool glow;
  final Color? glowColor;
  final VoidCallback? onTap;

  const HyperGlassCard({
    super.key,
    required this.theme,
    required this.child,
    this.borderRadius = 18,
    this.blur = 0.0,
    this.opacity = 1.0,
    this.customTint,
    this.customBorder,
    this.padding = const EdgeInsets.all(16),
    this.margin,
    this.glow = false,
    this.glowColor,
    this.onTap,
  });

  @override
  Widget build(BuildContext context) {
    final decoration = HyperAestheticTheme.glassBox(
      theme: theme,
      borderRadius: borderRadius,
      opacity: opacity,
      customTint: customTint,
      customBorder: customBorder,
      glow: glow,
      glowColor: glowColor,
    );

    Widget content;
    if (blur > 0) {
      content = Container(
        margin: margin,
        decoration: decoration,
        child: ClipRRect(
          borderRadius: BorderRadius.circular(borderRadius),
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: blur, sigmaY: blur),
            child: Padding(
              padding: padding,
              child: child,
            ),
          ),
        ),
      );
    } else {
      content = Container(
        margin: margin,
        decoration: decoration,
        padding: padding,
        child: child,
      );
    }

    if (onTap != null) {
      return GestureDetector(
        onTap: () {
          HapticFeedback.lightImpact();
          onTap!();
        },
        behavior: HitTestBehavior.opaque,
        child: content,
      );
    }
    return content;
  }
}

/// ============================================================================
/// 정밀 햅틱 캡슐 버튼 (Precision Haptic Pill Button)
/// ----------------------------------------------------------------------------
/// 48dp 안심 터치 타깃 + 마이크로 바운스 + 1px 보더의 절제된 버튼 컴포넌트
/// ============================================================================
class HyperHapticPill extends StatefulWidget {
  final ReaderThemeData theme;
  final Widget? icon;
  final String label;
  final VoidCallback onTap;
  final bool isPrimary;
  final double height;
  final EdgeInsetsGeometry padding;

  const HyperHapticPill({
    super.key,
    required this.theme,
    this.icon,
    required this.label,
    required this.onTap,
    this.isPrimary = false,
    this.height = 44,
    this.padding = const EdgeInsets.symmetric(horizontal: 16),
  });

  @override
  State<HyperHapticPill> createState() => _HyperHapticPillState();
}

class _HyperHapticPillState extends State<HyperHapticPill> {
  bool _isPressed = false;

  @override
  Widget build(BuildContext context) {
    final primaryColor = HyperAestheticTheme.getAmbientPrimary(widget.theme);

    final bg = widget.isPrimary
        ? primaryColor
        : (widget.theme.isDark
            ? widget.theme.surfaceColor
            : widget.theme.surfaceColor);

    final textColor = widget.isPrimary
        ? Colors.white
        : widget.theme.textColor;

    return ConstrainedBox(
      constraints: BoxConstraints(minHeight: widget.height, minWidth: 48),
      child: GestureDetector(
        onTapDown: (_) => setState(() => _isPressed = true),
        onTapUp: (_) {
          setState(() => _isPressed = false);
          HapticFeedback.lightImpact();
          widget.onTap();
        },
        onTapCancel: () => setState(() => _isPressed = false),
        behavior: HitTestBehavior.opaque,
        child: AnimatedScale(
          scale: _isPressed ? 0.96 : 1.0,
          duration: const Duration(milliseconds: 120),
          curve: Curves.easeOutCubic,
          child: Container(
            height: widget.height,
            padding: widget.padding,
            decoration: BoxDecoration(
              color: bg,
              borderRadius: BorderRadius.circular(widget.height / 2),
              border: Border.all(
                color: widget.isPrimary
                    ? Colors.white.withOpacity(0.25)
                    : widget.theme.borderColor.withOpacity(0.85),
                width: 1.0,
              ),
              boxShadow: [
                BoxShadow(
                  color: Colors.black.withOpacity(widget.theme.isDark ? 0.22 : 0.04),
                  blurRadius: 8,
                  offset: const Offset(0, 2),
                ),
                if (widget.isPrimary)
                  BoxShadow(
                    color: primaryColor.withOpacity(0.25),
                    blurRadius: 10,
                    offset: const Offset(0, 3),
                  ),
              ],
            ),
            child: Row(
              mainAxisSize: MainAxisSize.min,
              mainAxisAlignment: MainAxisAlignment.center,
              children: [
                if (widget.icon != null) ...[
                  widget.icon!,
                  const SizedBox(width: 6),
                ],
                Text(
                  widget.label,
                  style: TextStyle(
                    color: textColor,
                    fontSize: 13,
                    fontWeight: FontWeight.w600,
                    letterSpacing: -0.2,
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

/// ============================================================================
/// 정제된 프로그레스 링 (Refined Circular Progress Ring)
/// ----------------------------------------------------------------------------
/// 독서 진도율을 단정하고 명확하게 시각화하는 원형 게이지
/// ============================================================================
class HyperProgressRing extends StatelessWidget {
  final double progress; // 0.0 ~ 1.0
  final double size;
  final ReaderThemeData theme;
  final Widget? centerWidget;

  const HyperProgressRing({
    super.key,
    required this.progress,
    this.size = 48,
    required this.theme,
    this.centerWidget,
  });

  @override
  Widget build(BuildContext context) {
    final primary = HyperAestheticTheme.getAmbientPrimary(theme);

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // 배경 트랙
          CircularProgressIndicator(
            value: 1.0,
            strokeWidth: 3.5,
            valueColor: AlwaysStoppedAnimation<Color>(
              theme.isDark ? Colors.white12 : Colors.black12,
            ),
          ),
          // 진행 표시 링
          CircularProgressIndicator(
            value: progress.clamp(0.0, 1.0),
            strokeWidth: 3.5,
            strokeCap: StrokeCap.round,
            valueColor: AlwaysStoppedAnimation<Color>(primary),
          ),
          if (centerWidget != null) centerWidget!,
        ],
      ),
    );
  }
}

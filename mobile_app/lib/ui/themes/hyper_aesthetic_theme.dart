import 'dart:math' as math;
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

  /// 극상의 글래스모피즘 박스 데코레이션
  static BoxDecoration glassBox({
    required ReaderThemeData theme,
    double borderRadius = 20,
    double opacity = 0.55,
    Color? customTint,
    Color? customBorder,
    double borderWidth = 1.0,
    bool glow = false,
    Color? glowColor,
  }) {
    final baseColor = customTint ?? (theme.isDark ? theme.surfaceColor : Colors.white);
    final borderColor = customBorder ?? (theme.isDark
        ? Colors.white.withOpacity(0.14)
        : Colors.white.withOpacity(0.85));

    final effectiveGlow = glowColor ?? getAmbientPrimary(theme);

    return BoxDecoration(
      color: baseColor.withOpacity(opacity),
      borderRadius: BorderRadius.circular(borderRadius),
      border: Border.all(
        color: borderColor,
        width: borderWidth,
      ),
      boxShadow: [
        BoxShadow(
          color: (theme.isDark ? Colors.black : Colors.black12).withOpacity(theme.isDark ? 0.35 : 0.06),
          blurRadius: 18,
          offset: const Offset(0, 8),
        ),
        if (glow)
          BoxShadow(
            color: effectiveGlow.withOpacity(theme.isDark ? 0.28 : 0.16),
            blurRadius: 24,
            spreadRadius: 2,
            offset: const Offset(0, 4),
          ),
      ],
    );
  }
}

/// ============================================================================
/// 배경 앰비언트 리퀴드 글로우 오브 위젯 (Fluid Animated Ambient Glow)
/// ----------------------------------------------------------------------------
/// 화면 배경에서 부드럽게 유영하며 호흡하는 다층 오로라 블러 메쉬
/// ============================================================================
class HyperAmbientMeshBackground extends StatefulWidget {
  final ReaderThemeData theme;
  final Widget child;

  const HyperAmbientMeshBackground({
    super.key,
    required this.theme,
    required this.child,
  });

  @override
  State<HyperAmbientMeshBackground> createState() => _HyperAmbientMeshBackgroundState();
}

class _HyperAmbientMeshBackgroundState extends State<HyperAmbientMeshBackground>
    with SingleTickerProviderStateMixin {
  late AnimationController _controller;

  @override
  void initState() {
    super.initState();
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 14),
    )..repeat(reverse: true);
  }

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c1 = HyperAestheticTheme.getAmbientPrimary(widget.theme);
    final c2 = HyperAestheticTheme.getAmbientSecondary(widget.theme);

    return Stack(
      children: [
        // 1. 테마 기본 바탕색
        Positioned.fill(
          child: Container(color: widget.theme.background),
        ),

        // 2. 유영하는 앰비언트 오로라 오브 (GPU 하드웨어 가속)
        Positioned.fill(
          child: AnimatedBuilder(
            animation: _controller,
            builder: (context, _) {
              final t = _controller.value;
              final sinT = math.sin(t * math.pi * 2);
              final cosT = math.cos(t * math.pi * 2);

              return Stack(
                children: [
                  // 상단 좌측 앰비언트 글로우 오브
                  Positioned(
                    top: -80 + (sinT * 40),
                    left: -60 + (cosT * 30),
                    width: 320,
                    height: 320,
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          colors: [
                            c1.withOpacity(widget.theme.isDark ? 0.28 : 0.18),
                            c1.withOpacity(0.0),
                          ],
                        ),
                      ),
                    ),
                  ),

                  // 중앙 우측 앰비언트 글로우 오브
                  Positioned(
                    top: 220 + (cosT * 50),
                    right: -90 + (sinT * 40),
                    width: 360,
                    height: 360,
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          colors: [
                            c2.withOpacity(widget.theme.isDark ? 0.22 : 0.14),
                            c2.withOpacity(0.0),
                          ],
                        ),
                      ),
                    ),
                  ),

                  // 하단 좌측 보조 앰비언트 오브
                  Positioned(
                    bottom: -50 + (sinT * 30),
                    left: 20 + (cosT * 30),
                    width: 280,
                    height: 280,
                    child: Container(
                      decoration: BoxDecoration(
                        shape: BoxShape.circle,
                        gradient: RadialGradient(
                          colors: [
                            c1.withOpacity(widget.theme.isDark ? 0.18 : 0.12),
                            c1.withOpacity(0.0),
                          ],
                        ),
                      ),
                    ),
                  ),
                ],
              );
            },
          ),
        ),

        // 3. 전체 백드롭 필터 블러 (오로라를 벨벳처럼 부드럽게 융합)
        Positioned.fill(
          child: BackdropFilter(
            filter: ImageFilter.blur(sigmaX: 45, sigmaY: 45),
            child: const SizedBox.expand(),
          ),
        ),

        // 4. 전면 실제 콘텐츠
        widget.child,
      ],
    );
  }
}

/// ============================================================================
/// 프로스티드 아크릴 글래스 카드 (Frosted Glass Container)
/// ----------------------------------------------------------------------------
/// BackdropFilter blur와 림 라이트 1px 보더로 럭셔리 질감 표현
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
    this.borderRadius = 22,
    this.blur = 16.0,
    this.opacity = 0.58,
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

    Widget content = Container(
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

    if (onTap != null) {
      return GestureDetector(
        onTap: () {
          HapticFeedback.lightImpact();
          onTap!();
        },
        child: content,
      );
    }
    return content;
  }
}

/// ============================================================================
/// 하이퍼 햅틱 네온 캡슐 버튼 (Hyper Haptic Pill Button)
/// ----------------------------------------------------------------------------
/// 마이크로 바운스 애니메이션 + 햅틱 + 네온 림라이트가 결합된 최첨단 조작 버튼
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
    this.height = 42,
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
            ? Colors.white.withOpacity(0.12)
            : widget.theme.surfaceColor.withOpacity(0.85));

    final textColor = widget.isPrimary
        ? Colors.white
        : widget.theme.textColor;

    return GestureDetector(
      onTapDown: (_) => setState(() => _isPressed = true),
      onTapUp: (_) {
        setState(() => _isPressed = false);
        HapticFeedback.mediumImpact();
        widget.onTap();
      },
      onTapCancel: () => setState(() => _isPressed = false),
      child: AnimatedScale(
        scale: _isPressed ? 0.94 : 1.0,
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
                  ? Colors.white.withOpacity(0.35)
                  : widget.theme.borderColor.withOpacity(0.6),
              width: 1.2,
            ),
            boxShadow: [
              if (widget.isPrimary)
                BoxShadow(
                  color: primaryColor.withOpacity(0.4),
                  blurRadius: 16,
                  offset: const Offset(0, 4),
                )
              else
                BoxShadow(
                  color: Colors.black.withOpacity(widget.theme.isDark ? 0.25 : 0.05),
                  blurRadius: 8,
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
                  fontWeight: FontWeight.bold,
                  letterSpacing: -0.3,
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// ============================================================================
/// 네온 원형 프로그레스 링 (Neon Circular Progress Ring)
/// ----------------------------------------------------------------------------
/// 독서 진도율을 직관적이고 휘황찬란하게 표현하는 듀얼 그라디언트 링
/// ============================================================================
class HyperProgressRing extends StatelessWidget {
  final double progress; // 0.0 ~ 1.0
  final double size;
  final ReaderThemeData theme;
  final Widget? centerWidget;

  const HyperProgressRing({
    super.key,
    required this.progress,
    this.size = 54,
    required this.theme,
    this.centerWidget,
  });

  @override
  Widget build(BuildContext context) {
    final c1 = HyperAestheticTheme.getAmbientPrimary(theme);
    final c2 = HyperAestheticTheme.getAmbientSecondary(theme);

    return SizedBox(
      width: size,
      height: size,
      child: Stack(
        alignment: Alignment.center,
        children: [
          // 배경 트랙
          CircularProgressIndicator(
            value: 1.0,
            strokeWidth: 4.0,
            valueColor: AlwaysStoppedAnimation<Color>(
              theme.isDark ? Colors.white10 : Colors.black12,
            ),
          ),
          // 그라디언트 활성 링
          ShaderMask(
            shaderCallback: (bounds) {
              return SweepGradient(
                startAngle: 0.0,
                endAngle: math.pi * 2,
                colors: [c1, c2, c1],
                stops: const [0.0, 0.5, 1.0],
              ).createShader(bounds);
            },
            child: CircularProgressIndicator(
              value: progress.clamp(0.0, 1.0),
              strokeWidth: 4.5,
              strokeCap: StrokeCap.round,
              valueColor: const AlwaysStoppedAnimation<Color>(Colors.white),
            ),
          ),
          if (centerWidget != null) centerWidget!,
        ],
      ),
    );
  }
}

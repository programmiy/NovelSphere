import 'dart:math' as math;
import 'dart:ui';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'reader_themes.dart';

/// ============================================================================
/// LANOVEL 하이퍼 에스테틱 모바일 디자인 시스템 (Hyper-Aesthetic Luminary UI)
/// ----------------------------------------------------------------------------
/// - 자원 소모를 아끼지 않는 극상의 비주얼 에스테틱 (Impeller GLSL Fluid Aurora Mesh & Glassmorphism)
/// - 오프스크린 SaveLayer(BackdropFilter)를 배제한 단일 패스 프래그먼트 셰이더로 120Hz 고정
/// - 한 손 조작성을 극한으로 끌어올린 햅틱 인터랙티브 컴포넌트
/// ============================================================================

class HyperAestheticTheme {
  static FragmentProgram? _cachedMeshProgram;
  static Future<FragmentProgram?>? _loadingMeshFuture;

  /// 사전 로드된 프래그먼트 셰이더 프로그램 반환 (첫 프레임 즉시 바인딩용)
  static FragmentProgram? get cachedMeshProgram => _cachedMeshProgram;

  /// Impeller 커스텀 프래그먼트 셰이더(`shaders/hyper_ambient_mesh.frag`) 사전 로드 및 캐싱
  static Future<FragmentProgram?> loadMeshShaderProgram() {
    if (_cachedMeshProgram != null) {
      return Future.value(_cachedMeshProgram);
    }
    return _loadingMeshFuture ??= _initMeshProgram();
  }

  static Future<FragmentProgram?> _initMeshProgram() async {
    try {
      _cachedMeshProgram = await FragmentProgram.fromAsset(
        'shaders/hyper_ambient_mesh.frag',
      );
      return _cachedMeshProgram;
    } catch (_) {
      return null;
    }
  }

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

  /// 오로라 유체 간섭(Silk Interference)을 위한 제3 하이라이트 컬러 추출
  static Color getAmbientTertiary(ReaderThemeData theme) {
    if (theme.isDark) {
      if (theme.id == 'midnight') return const Color(0xFF38BDF8); // Cyan Glow
      if (theme.id == 'charcoal') return const Color(0xFF8B5CF6); // Violet
      if (theme.id == 'mocha') return const Color(0xFFF43F5E);    // Warm Rose
      if (theme.id == 'slate') return const Color(0xFF818CF8);    // Soft Indigo
      return const Color(0xFF06B6D4);                             // Deep Cyan
    } else {
      if (theme.id == 'mint') return const Color(0xFF14B8A6);
      if (theme.id == 'rose') return const Color(0xFFA855F7);
      if (theme.id == 'lavender') return const Color(0xFF38BDF8);
      if (theme.id == 'sepia') return const Color(0xFFEAB308);
      return const Color(0xFF06B6D4);
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
/// Impeller 커스텀 프래그먼트 셰이더 기반 오로라 유체 메쉬 배경 (Fluid Aurora Mesh)
/// ----------------------------------------------------------------------------
/// - 기존 Container 3개 + 풀스크린 BackdropFilter(sigma: 45)의 SaveLayer 병목을 완전 제거
/// - 단일 패스(Single-pass) GLSL 프래그먼트 셰이더(`shaders/hyper_ambient_mesh.frag`)로
///   도메인 워핑 유체 실크(Fluid Mesh)와 미세 필름 그레인(Micro Film Grain)을 동시에 연산
/// - CustomPainter(repaint: _controller) + RepaintBoundary 격리로 위젯 리빌드 0회, 120Hz 고정
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
  State<HyperAmbientMeshBackground> createState() =>
      _HyperAmbientMeshBackgroundState();
}

class _HyperAmbientMeshBackgroundState extends State<HyperAmbientMeshBackground>
    with SingleTickerProviderStateMixin, WidgetsBindingObserver {
  late final AnimationController _controller;
  FragmentShader? _shader;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    // 600초 주기의 연속 타임라인 (1.0배속 초 단위 진행, 경계 끊김 없는 왕복)
    _controller = AnimationController(
      vsync: this,
      duration: const Duration(seconds: 600),
    )..repeat(reverse: true);

    // 사전 로드된 프로그램이 있으면 첫 프레임부터 즉시 바인딩
    final cached = HyperAestheticTheme.cachedMeshProgram;
    if (cached != null) {
      _shader = cached.fragmentShader();
    } else {
      _bindShader();
    }
  }

  Future<void> _bindShader() async {
    final program = await HyperAestheticTheme.loadMeshShaderProgram();
    if (!mounted || program == null) return;
    setState(() {
      _shader = program.fragmentShader();
    });
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    // 앱이 백그라운드로 전환되면 셰이더 틱을 즉시 멈춰 배터리 소모 0% 보장
    if (state == AppLifecycleState.resumed) {
      if (!_controller.isAnimating) {
        _controller.repeat(reverse: true);
      }
    } else if (state == AppLifecycleState.paused ||
        state == AppLifecycleState.hidden) {
      _controller.stop();
    }
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _controller.dispose();
    _shader?.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final c1 = HyperAestheticTheme.getAmbientPrimary(widget.theme);
    final c2 = HyperAestheticTheme.getAmbientSecondary(widget.theme);
    final c3 = HyperAestheticTheme.getAmbientTertiary(widget.theme);

    return Stack(
      children: [
        // 1. 독립 렌더 레이어로 격리된 단일 패스 GPU 오로라 프래그먼트 셰이더
        Positioned.fill(
          child: RepaintBoundary(
            child: CustomPaint(
              painter: _HyperAuroraShaderPainter(
                animation: _controller,
                shader: _shader,
                theme: widget.theme,
                primaryColor: c1,
                secondaryColor: c2,
                tertiaryColor: c3,
              ),
              isComplex: true,
              willChange: true,
            ),
          ),
        ),

        // 2. 전면 실제 콘텐츠 (셰이더 애니메이션과 레이어 완전 분리)
        Positioned.fill(
          child: widget.child,
        ),
      ],
    );
  }
}

class _HyperAuroraShaderPainter extends CustomPainter {
  final Animation<double> animation;
  final FragmentShader? shader;
  final ReaderThemeData theme;
  final Color primaryColor;
  final Color secondaryColor;
  final Color tertiaryColor;
  final Paint _shaderPaint = Paint();

  _HyperAuroraShaderPainter({
    required this.animation,
    required this.shader,
    required this.theme,
    required this.primaryColor,
    required this.secondaryColor,
    required this.tertiaryColor,
  }) : super(repaint: animation);

  @override
  void paint(Canvas canvas, Size size) {
    final rect = Offset.zero & size;
    final activeShader = shader;

    if (activeShader != null) {
      // uTime: 초 단위 연속 시간 (0.0 ~ 600.0)
      final timeSeconds = animation.value * 600.0;
      final isDark = theme.isDark ? 1.0 : 0.0;
      final intensity = theme.id == 'oled'
          ? 0.52
          : (theme.isDark ? 1.0 : 0.85);

      final bg = theme.background;

      // Uniforms [0..16] — shaders/hyper_ambient_mesh.frag 레이아웃과 1:1 매핑
      activeShader
        ..setFloat(0, size.width)
        ..setFloat(1, size.height)
        ..setFloat(2, timeSeconds)
        ..setFloat(3, isDark)
        ..setFloat(4, intensity)
        ..setFloat(5, bg.red / 255.0)
        ..setFloat(6, bg.green / 255.0)
        ..setFloat(7, bg.blue / 255.0)
        ..setFloat(8, primaryColor.red / 255.0)
        ..setFloat(9, primaryColor.green / 255.0)
        ..setFloat(10, primaryColor.blue / 255.0)
        ..setFloat(11, secondaryColor.red / 255.0)
        ..setFloat(12, secondaryColor.green / 255.0)
        ..setFloat(13, secondaryColor.blue / 255.0)
        ..setFloat(14, tertiaryColor.red / 255.0)
        ..setFloat(15, tertiaryColor.green / 255.0)
        ..setFloat(16, tertiaryColor.blue / 255.0);

      _shaderPaint.shader = activeShader;
      canvas.drawRect(rect, _shaderPaint);
      return;
    }

    // 셰이더 에셋 초기화 전 첫 1프레임 또는 미지원 환경용 경량 폴백 (SaveLayer 없음)
    canvas.drawRect(rect, Paint()..color = theme.background);
    final t = animation.value * 600.0 * 0.4;
    final c1Center = Alignment(
      -0.45 + 0.25 * math.sin(t * 0.7),
      -0.65 + 0.20 * math.cos(t * 0.5),
    );
    final c2Center = Alignment(
      0.55 + 0.25 * math.cos(t * 0.6),
      0.15 + 0.25 * math.sin(t * 0.8),
    );

    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          center: c1Center,
          radius: 1.15,
          colors: [
            primaryColor.withOpacity(theme.isDark ? 0.18 : 0.08),
            Colors.transparent,
          ],
        ).createShader(rect),
    );
    canvas.drawRect(
      rect,
      Paint()
        ..shader = RadialGradient(
          center: c2Center,
          radius: 1.25,
          colors: [
            secondaryColor.withOpacity(theme.isDark ? 0.14 : 0.06),
            Colors.transparent,
          ],
        ).createShader(rect),
    );
  }

  @override
  bool shouldRepaint(covariant _HyperAuroraShaderPainter oldDelegate) {
    return oldDelegate.shader != shader ||
        oldDelegate.theme.id != theme.id ||
        oldDelegate.primaryColor != primaryColor ||
        oldDelegate.secondaryColor != secondaryColor ||
        oldDelegate.tertiaryColor != tertiaryColor;
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

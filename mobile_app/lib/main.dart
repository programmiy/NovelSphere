import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'services/local_notification_service.dart';
import 'services/notification_service.dart';
import 'services/preferences_service.dart';
import 'services/status_dashboard_service.dart';
import 'services/tts_audio_service.dart';
import 'ui/library/library_screen.dart';
import 'ui/themes/hyper_aesthetic_theme.dart';
import 'ui/themes/reader_themes.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 환경 설정, Impeller 오로라 프래그먼트 셰이더, TTS 서비스 및 로컬 알림 플러그인 초기화
  await Future.wait([
    PreferencesService.init(),
    HyperAestheticTheme.loadMeshShaderProgram(),
  ]);
  await TtsAudioService.init();
  await LocalNotificationService.init();

  // 시스템 상단바 투명화
  SystemChrome.setSystemUIOverlayStyle(
    const SystemUiOverlayStyle(
      statusBarColor: Colors.transparent,
      statusBarIconBrightness: Brightness.dark,
    ),
  );

  runApp(const LanovelApp());
}

class LanovelApp extends StatefulWidget {
  const LanovelApp({super.key});

  @override
  State<LanovelApp> createState() => _LanovelAppState();
}

class _LanovelAppState extends State<LanovelApp> {
  @override
  void initState() {
    super.initState();
    // 실시간 로컬 SSE 리스너 및 15분 주기 초절전 대시보드 현황 서비스 가동
    NotificationService.startRealtimeListener();
    StatusDashboardService.start();
  }

  @override
  void dispose() {
    NotificationService.stopRealtimeListener();
    StatusDashboardService.stop();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);

    return MaterialApp(
      navigatorKey: lanovelNavigatorKey,
      title: 'LANOVEL Reader',
      debugShowCheckedModeBanner: false,
      theme: ThemeData(
        useMaterial3: true,
        brightness: theme.isDark ? Brightness.dark : Brightness.light,
        scaffoldBackgroundColor: theme.background,
        colorScheme: ColorScheme(
          brightness: theme.isDark ? Brightness.dark : Brightness.light,
          primary: theme.accentColor,
          onPrimary: Colors.white,
          secondary: theme.accentColor,
          onSecondary: Colors.white,
          error: Colors.redAccent,
          onError: Colors.white,
          surface: theme.surfaceColor,
          onSurface: theme.textColor,
        ),
        fontFamily: PreferencesService.systemFont,
      ),
      home: const LibraryScreen(),
    );
  }
}

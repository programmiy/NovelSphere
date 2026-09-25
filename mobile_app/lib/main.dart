import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'services/preferences_service.dart';
import 'services/tts_audio_service.dart';
import 'ui/library/library_screen.dart';
import 'ui/themes/reader_themes.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  
  // 환경 설정 및 TTS 서비스 초기화
  await PreferencesService.init();
  await TtsAudioService.init();

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
  Widget build(BuildContext context) {
    final theme = ReaderThemes.getTheme(PreferencesService.theme);

    return MaterialApp(
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

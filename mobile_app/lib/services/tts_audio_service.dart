import 'dart:io';
import 'package:audioplayers/audioplayers.dart';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'preferences_service.dart';

class TtsAudioService {
  static final AudioPlayer _player = AudioPlayer();
  static bool _isPlaying = false;
  static double _speed = 1.0;
  static String? _currentBook;
  static String? _currentChapter;

  static AudioPlayer get player => _player;
  static bool get isPlaying => _isPlaying;
  static double get speed => _speed;
  static String? get currentBook => _currentBook;
  static String? get currentChapter => _currentChapter;

  static Future<void> init() async {
    _player.onPlayerStateChanged.listen((state) {
      _isPlaying = (state == PlayerState.playing);
    });
  }

  static Future<String> _getLocalAudioPath(String book, String chapter) async {
    final docsDir = await getApplicationDocumentsDirectory();
    final ttsDir = Directory(p.join(docsDir.path, 'tts_cache', book));
    if (!await ttsDir.exists()) {
      await ttsDir.create(recursive: true);
    }
    final safeName = chapter.replaceAll(RegExp(r'[^\w\s\-]'), '').trim();
    return p.join(ttsDir.path, '$safeName.mp3');
  }

  /// PC 서버에서 생성된 챕터 TTS 오디오가 로컬에 있는지 확인
  static Future<bool> hasLocalAudio(String book, String chapter) async {
    final path = await _getLocalAudioPath(book, chapter);
    return await File(path).exists();
  }

  /// PC 서버로부터 해당 챕터의 TTS 오디오를 다운로드하여 캐싱 (사용자 코멘트 반영)
  static Future<bool> downloadChapterTts(String book, String chapter) async {
    final localPath = await _getLocalAudioPath(book, chapter);
    if (await File(localPath).exists()) {
      return true; // 이미 로컬에 있음
    }

    final serverUrl = PreferencesService.serverUrl.replaceAll(RegExp(r'/+$'), '');
    final uri = Uri.parse('$serverUrl/api/sync/tts-pack?book=${Uri.encodeComponent(book)}&chapter=${Uri.encodeComponent(chapter)}');

    try {
      final res = await http.get(uri).timeout(const Duration(seconds: 40));
      if (res.statusCode == 200) {
        await File(localPath).writeAsBytes(res.bodyBytes, flush: true);
        return true;
      }
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error downloading TTS audio: $e');
      }
    }
    return false;
  }

  /// 챕터 오디오 재생 시작
  static Future<bool> playChapterAudio(String book, String chapter) async {
    final localPath = await _getLocalAudioPath(book, chapter);
    final file = File(localPath);

    if (!await file.exists()) {
      // 로컬에 없으면 PC 서버에서 즉시 다운로드 시도
      final downloaded = await downloadChapterTts(book, chapter);
      if (!downloaded || !await file.exists()) {
        return false;
      }
    }

    _currentBook = book;
    _currentChapter = chapter;

    await _player.stop();
    await _player.setPlaybackRate(_speed);
    await _player.play(DeviceFileSource(localPath));
    return true;
  }

  static Future<void> pause() async {
    await _player.pause();
  }

  static Future<void> resume() async {
    await _player.resume();
  }

  static Future<void> stop() async {
    await _player.stop();
    _currentBook = null;
    _currentChapter = null;
  }

  static Future<void> setSpeed(double newSpeed) async {
    _speed = newSpeed;
    await _player.setPlaybackRate(newSpeed);
  }

  static Future<void> seekRelative(int seconds) async {
    final currentPos = await _player.getCurrentPosition() ?? Duration.zero;
    final newPos = currentPos + Duration(seconds: seconds);
    await _player.seek(newPos < Duration.zero ? Duration.zero : newPos);
  }
}

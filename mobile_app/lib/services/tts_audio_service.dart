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

  static String _sanitizeFileName(String name) {
    final sanitized = name.replaceAll(RegExp(r'[^\p{L}\p{N}\s\-_]', unicode: true), '').trim();
    final fallback = sanitized.isEmpty ? 'item' : sanitized;
    final hash = name.codeUnits.fold<int>(0, (prev, elem) => (prev * 31 + elem) & 0xFFFFFF);
    final hexHash = hash.toRadixString(16).padLeft(6, '0');
    final truncated = fallback.length > 40 ? fallback.substring(0, 40).trim() : fallback;
    return '${truncated}_$hexHash';
  }

  static Future<String> _getLocalAudioPath(String book, String chapter, {String ext = 'mp3'}) async {
    final docsDir = await getApplicationDocumentsDirectory();
    final safeBook = _sanitizeFileName(book);
    final ttsDir = Directory(p.join(docsDir.path, 'tts_cache', safeBook));
    if (!await ttsDir.exists()) {
      await ttsDir.create(recursive: true);
    }
    final safeName = _sanitizeFileName(chapter);
    return p.join(ttsDir.path, '$safeName.$ext');
  }

  /// PC 서버에서 생성된 챕터 TTS 오디오가 로컬에 있는지 확인
  static Future<bool> hasLocalAudio(String book, String chapter) async {
    for (var ext in ['mp3', 'm4a', 'opus', 'ogg']) {
      final path = await _getLocalAudioPath(book, chapter, ext: ext);
      if (await File(path).exists()) return true;
    }
    return false;
  }

  /// PC 서버로부터 해당 챕터의 TTS 오디오를 다운로드하여 캐싱 (유니코드/확장자 보존 & 원자적 저장)
  static Future<bool> downloadChapterTts(String book, String chapter) async {
    if (await hasLocalAudio(book, chapter)) {
      return true; // 이미 로컬에 있음
    }

    final serverUrl = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);
    final uri = Uri.parse('$serverUrl/api/sync/tts-pack?book=${Uri.encodeComponent(book)}&chapter=${Uri.encodeComponent(chapter)}');

    try {
      final res = await http.get(uri, headers: PreferencesService.authHeaders).timeout(const Duration(seconds: 40));
      if (res.statusCode == 200) {
        String ext = 'mp3';
        final cType = res.headers['content-type'] ?? '';
        if (cType.contains('audio/mp4') || cType.contains('audio/m4a')) {
          ext = 'm4a';
        } else if (cType.contains('audio/ogg') || cType.contains('audio/opus')) {
          ext = 'opus';
        }
        final finalPath = await _getLocalAudioPath(book, chapter, ext: ext);
        final tempFile = File('$finalPath.part');
        await tempFile.writeAsBytes(res.bodyBytes, flush: true);
        if (await File(finalPath).exists()) {
          await File(finalPath).delete();
        }
        await tempFile.rename(finalPath);
        return true;
      }
      return false;
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error downloading TTS audio: $e');
      }
      return false;
    }
  }

  /// 챕터 오디오 재생 시작 (다양한 포맷 지원)
  static Future<bool> playChapterAudio(String book, String chapter) async {
    String? activePath;
    for (var ext in ['mp3', 'm4a', 'opus', 'ogg']) {
      final pth = await _getLocalAudioPath(book, chapter, ext: ext);
      if (await File(pth).exists()) {
        activePath = pth;
        break;
      }
    }

    if (activePath == null) {
      final downloaded = await downloadChapterTts(book, chapter);
      if (downloaded) {
        for (var ext in ['mp3', 'm4a', 'opus', 'ogg']) {
          final pth = await _getLocalAudioPath(book, chapter, ext: ext);
          if (await File(pth).exists()) {
            activePath = pth;
            break;
          }
        }
      }
    }

    if (activePath == null) {
      return false;
    }

    _currentBook = book;
    _currentChapter = chapter;

    await _player.stop();
    await _player.setPlaybackRate(_speed);
    await _player.play(DeviceFileSource(activePath));
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

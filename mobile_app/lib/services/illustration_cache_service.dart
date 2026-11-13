import 'dart:io';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import '../models/novel_illustration.dart';
import 'preferences_service.dart';

/// 소설 본문 삽화 이미지의 로컬 디스크 캐시 및 서버 다운로드 관리 서비스
class IllustrationCacheService {
  static Directory? _rootDir;
  static final Map<int, String> _sessionPathCache = {};

  static Future<Directory> getRootDir() async {
    if (_rootDir != null) {
      if (!await _rootDir!.exists()) {
        await _rootDir!.create(recursive: true);
      }
      return _rootDir!;
    }
    final docsDir = await getApplicationDocumentsDirectory();
    final dir = Directory(p.join(docsDir.path, 'illustrations'));
    if (!await dir.exists()) {
      await dir.create(recursive: true);
    }
    _rootDir = dir;
    return dir;
  }

  static String? buildNetworkUrl(int illustrationId) {
    final base = PreferencesService.normalizeServerUrl(PreferencesService.serverUrl);
    if (base.isEmpty) return null;
    return '$base/api/illustrations/$illustrationId/image';
  }

  static Map<String, String> buildAuthHeaders() {
    return Map<String, String>.from(PreferencesService.authHeaders);
  }

  static String? getCachedPathSync(NovelIllustration illu) {
    final cached = _sessionPathCache[illu.id];
    if (cached != null) {
      final f = File(cached);
      if (f.existsSync() && f.lengthSync() > 0) {
        if (p.basename(cached) == illu.cacheFileName) {
          return cached;
        }
      }
    }
    final root = _rootDir;
    if (root == null) return null;
    final target = File(p.join(root.path, illu.cacheFileName));
    if (target.existsSync() && target.lengthSync() > 0) {
      _sessionPathCache[illu.id] = target.path;
      return target.path;
    }
    return null;
  }

  static Future<Map<int, String>> resolveLocalPaths(List<NovelIllustration> items) async {
    final result = <int, String>{};
    if (items.isEmpty) return result;
    final root = await getRootDir();
    for (final item in items) {
      final file = File(p.join(root.path, item.cacheFileName));
      if (await file.exists() && await file.length() > 0) {
        _sessionPathCache[item.id] = file.path;
        result[item.id] = file.path;
      }
    }
    return result;
  }

  static Future<void> _cleanupOldVersions(Directory root, int id, String keepFileName) async {
    final prefix = 'illu_${id}_';
    try {
      await for (final entity in root.list()) {
        if (entity is File) {
          final name = p.basename(entity.path);
          if (name.startsWith(prefix) && name != keepFileName) {
            try {
              await entity.delete();
            } catch (_) {}
          }
        }
      }
    } catch (_) {}
  }

  static Future<String?> ensureDownloaded(
    NovelIllustration illu, {
    Duration timeout = const Duration(seconds: 25),
  }) async {
    final root = await getRootDir();
    final targetName = illu.cacheFileName;
    final targetFile = File(p.join(root.path, targetName));

    if (await targetFile.exists() && await targetFile.length() > 0) {
      await _cleanupOldVersions(root, illu.id, targetName);
      _sessionPathCache[illu.id] = targetFile.path;
      return targetFile.path;
    }

    final url = buildNetworkUrl(illu.id);
    if (url == null) return null;

    try {
      final resp = await http
          .get(Uri.parse(url), headers: buildAuthHeaders())
          .timeout(timeout);
      if (resp.statusCode == 200 && resp.bodyBytes.isNotEmpty) {
        final tmpFile = File(p.join(root.path, '.$targetName.tmp'));
        await tmpFile.writeAsBytes(resp.bodyBytes, flush: true);
        if (await targetFile.exists()) {
          await targetFile.delete();
        }
        await tmpFile.rename(targetFile.path);
        await _cleanupOldVersions(root, illu.id, targetName);
        _sessionPathCache[illu.id] = targetFile.path;
        return targetFile.path;
      }
    } catch (e) {
      debugPrint('Illustration download failed (id=${illu.id}): $e');
    }
    return null;
  }

  static Future<void> syncAllIllustrations(
    List<NovelIllustration> items, {
    int concurrency = 3,
  }) async {
    if (items.isEmpty) return;
    await getRootDir();
    final step = concurrency.clamp(1, 6);
    for (var i = 0; i < items.length; i += step) {
      final chunk = items.sublist(i, (i + step).clamp(0, items.length));
      await Future.wait(chunk.map((item) => ensureDownloaded(item)));
    }
  }

  static Future<void> deleteByIds(Iterable<int> ids) async {
    final idSet = ids.toSet();
    if (idSet.isEmpty) return;
    final root = await getRootDir();
    for (final id in idSet) {
      _sessionPathCache.remove(id);
    }
    try {
      await for (final entity in root.list()) {
        if (entity is File) {
          final name = p.basename(entity.path);
          for (final id in idSet) {
            if (name.startsWith('illu_${id}_') || name.startsWith('.illu_${id}_')) {
              try {
                await entity.delete();
              } catch (_) {}
              break;
            }
          }
        }
      }
    } catch (_) {}
  }

  static Future<void> pruneAllExcept(Set<int> validIds) async {
    final root = await getRootDir();
    final pattern = RegExp(r'^illu_(\d+)_');
    try {
      await for (final entity in root.list()) {
        if (entity is File) {
          final name = p.basename(entity.path);
          final match = pattern.firstMatch(name);
          if (match != null) {
            final fileId = int.tryParse(match.group(1) ?? '');
            if (fileId != null && !validIds.contains(fileId)) {
              _sessionPathCache.remove(fileId);
              try {
                await entity.delete();
              } catch (_) {}
            }
          }
        }
      }
    } catch (_) {}
  }
}

import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:http/http.dart' as http;
import 'package:package_info_plus/package_info_plus.dart';
import 'package:path_provider/path_provider.dart';

import 'preferences_service.dart';

class AppUpdateInfo {
  final String version;
  final int buildNumber;
  final int fileSize;
  final String releaseNotes;
  final bool hasApk;

  AppUpdateInfo({
    required this.version,
    required this.buildNumber,
    required this.fileSize,
    required this.releaseNotes,
    required this.hasApk,
  });

  factory AppUpdateInfo.fromJson(Map<String, dynamic> json) {
    return AppUpdateInfo(
      version: json['version'] as String? ?? '1.0.0',
      buildNumber: (json['build_number'] as num?)?.toInt() ?? 1,
      fileSize: (json['file_size'] as num?)?.toInt() ?? 0,
      releaseNotes: json['release_notes'] as String? ?? '',
      hasApk: json['has_apk'] as bool? ?? false,
    );
  }
}

class AppUpdateService {
  static const MethodChannel _installerChannel =
      MethodChannel('com.lanovel.lanovel_reader/app_installer');

  /// 현재 설치된 앱의 버전 정보
  static Future<PackageInfo> getPackageInfo() async {
    return await PackageInfo.fromPlatform();
  }

  /// PC 서버에 새 버전이 있는지 확인
  static Future<AppUpdateInfo?> checkForUpdate({
    bool silent = true,
    BuildContext? context,
  }) async {
    final serverUrl = PreferencesService.serverUrl;
    if (serverUrl.isEmpty) {
      if (!silent && context != null && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('PC 서버 주소가 설정되지 않았습니다.')),
        );
      }
      return null;
    }

    try {
      final res = await http
          .get(Uri.parse('$serverUrl/api/app/version'))
          .timeout(const Duration(seconds: 4));

      if (res.statusCode == 200) {
        final data = jsonDecode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
        final updateInfo = AppUpdateInfo.fromJson(data);

        final currentPkg = await getPackageInfo();
        final currentBuild = int.tryParse(currentPkg.buildNumber) ?? 1;

        // 서버의 빌드 번호가 더 높거나, 빌드 번호가 같더라도 버전 문자열이 높은 경우
        final isNewer = updateInfo.buildNumber > currentBuild ||
            (updateInfo.buildNumber == currentBuild &&
                _compareSemVer(updateInfo.version, currentPkg.version) > 0);

        if (isNewer && updateInfo.hasApk) {
          if (PreferencesService.autoSilentUpdate) {
            // 별도 대화상자 없이 백그라운드에서 바로 무설치 자동 업데이트 실행
            if (context != null && context.mounted) {
              performSilentBackgroundUpdate(updateInfo, context: context);
            } else {
              performSilentBackgroundUpdate(updateInfo);
            }
          } else {
            if (context != null && context.mounted) {
              showUpdateDialog(context, updateInfo, currentPkg.version);
            }
          }
          return updateInfo;
        } else {
          if (!silent && context != null && context.mounted) {
            ScaffoldMessenger.of(context).showSnackBar(
              SnackBar(
                content: Text('현재 최신 버전(v${currentPkg.version})을 사용 중입니다.'),
                backgroundColor: Colors.teal,
              ),
            );
          }
        }
      }
    } catch (e) {
      if (!silent && context != null && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('업데이트 확인 실패: $e')),
        );
      }
    }
    return null;
  }

  /// 간단한 시맨틱 버전 비교 (1.0.2 vs 1.0.1)
  static int _compareSemVer(String v1, String v2) {
    try {
      final p1 = v1.split('.').map((e) => int.tryParse(e) ?? 0).toList();
      final p2 = v2.split('.').map((e) => int.tryParse(e) ?? 0).toList();
      final len = p1.length > p2.length ? p1.length : p2.length;
      for (int i = 0; i < len; i++) {
        final n1 = i < p1.length ? p1[i] : 0;
        final n2 = i < p2.length ? p2[i] : 0;
        if (n1 != n2) return n1.compareTo(n2);
      }
    } catch (_) {}
    return 0;
  }

  /// 업데이트 팝업 표시
  /// 업데이트 팝업 표시
  static void showUpdateDialog(
    BuildContext context,
    AppUpdateInfo updateInfo,
    String currentVersion,
  ) {
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => AlertDialog(
        icon: const Icon(Icons.system_update_rounded, size: 40, color: Colors.indigo),
        title: Text(
          '새 버전 발견 (v${updateInfo.version})',
          style: const TextStyle(fontWeight: FontWeight.bold),
        ),
        content: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text('현재 버전: v$currentVersion → 최신: v${updateInfo.version}'),
            if (updateInfo.fileSize > 0) ...[
              const SizedBox(height: 4),
              Text(
                '다운로드 크기: ${(updateInfo.fileSize / (1024 * 1024)).toStringAsFixed(1)} MB',
                style: TextStyle(color: Colors.grey.shade600, fontSize: 13),
              ),
            ],
            if (updateInfo.releaseNotes.isNotEmpty) ...[
              const SizedBox(height: 12),
              const Text('주요 업데이트 내용:', style: TextStyle(fontWeight: FontWeight.w600)),
              const SizedBox(height: 4),
              Container(
                width: double.infinity,
                padding: const EdgeInsets.all(8),
                decoration: BoxDecoration(
                  color: Colors.grey.shade100,
                  borderRadius: BorderRadius.circular(6),
                ),
                child: Text(
                  updateInfo.releaseNotes,
                  style: const TextStyle(fontSize: 13),
                ),
              ),
            ],
            const SizedBox(height: 12),
            Container(
              padding: const EdgeInsets.all(10),
              decoration: BoxDecoration(
                color: Colors.indigo.shade50,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.indigo.shade100),
              ),
              child: Row(
                children: [
                  const Icon(Icons.flash_on_rounded, size: 18, color: Colors.indigo),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      '안드로이드 시스템 재설치 화면 없이 앱 내에서 바로 무설치(무인) 자동 교체 및 재실행됩니다.',
                      style: TextStyle(fontSize: 12, color: Colors.indigo.shade900),
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
        actions: [
          TextButton(
            onPressed: () => Navigator.pop(dialogCtx),
            child: const Text('나중에'),
          ),
          FilledButton.icon(
            icon: const Icon(Icons.download_rounded, size: 18),
            label: const Text('무설치 자동 업데이트'),
            onPressed: () {
              Navigator.pop(dialogCtx);
              downloadAndInstall(context, updateInfo);
            },
          ),
        ],
      ),
    );
  }

  /// APK 다운로드 후 안드로이드 시스템 무인(Silent) 설치 실행
  static Future<void> downloadAndInstall(
    BuildContext context,
    AppUpdateInfo updateInfo,
  ) async {
    final serverUrl = PreferencesService.serverUrl;
    if (serverUrl.isEmpty) return;

    double progress = 0.0;
    int receivedBytes = 0;
    int totalBytes = updateInfo.fileSize;
    bool isCancelled = false;
    bool isApplying = false;

    // 진행률 다이얼로그 표시
    StateSetter? setProgressState;
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (dialogCtx) => StatefulBuilder(
        builder: (ctx, setState) {
          setProgressState = setState;
          final percent = totalBytes > 0
              ? (receivedBytes / totalBytes).clamp(0.0, 1.0)
              : progress;
          return AlertDialog(
            title: Text(isApplying ? '📦 무설치 업데이트 적용 중' : '앱 업데이트 다운로드'),
            content: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                if (!isApplying) ...[
                  LinearProgressIndicator(value: percent > 0 ? percent : null),
                  const SizedBox(height: 16),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      Text('${(percent * 100).toStringAsFixed(0)}% 완료'),
                      if (totalBytes > 0)
                        Text(
                          '${(receivedBytes / (1024 * 1024)).toStringAsFixed(1)} / ${(totalBytes / (1024 * 1024)).toStringAsFixed(1)} MB',
                          style: const TextStyle(fontSize: 12, color: Colors.grey),
                        ),
                    ],
                  ),
                  const SizedBox(height: 8),
                  const Text(
                    '다운로드가 끝나면 설치 화면 없이 백그라운드에서 즉시 교체됩니다.',
                    style: TextStyle(fontSize: 12, color: Colors.grey),
                  ),
                ] else ...[
                  const SizedBox(height: 8),
                  const Center(
                    child: SizedBox(
                      width: 48,
                      height: 48,
                      child: CircularProgressIndicator(strokeWidth: 3),
                    ),
                  ),
                  const SizedBox(height: 20),
                  const Text(
                    '시스템 재설치 화면 없이 최신 버전으로 교체 중입니다.\n잠시 후 앱이 자동으로 재실행됩니다.',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontSize: 13, height: 1.4),
                  ),
                ],
              ],
            ),
            actions: [
              if (!isApplying)
                TextButton(
                  onPressed: () {
                    isCancelled = true;
                    Navigator.pop(dialogCtx);
                  },
                  child: const Text('취소'),
                ),
            ],
          );
        },
      ),
    );

    try {
      final client = http.Client();
      final request = http.Request('GET', Uri.parse('$serverUrl/api/app/download'));
      final response = await client.send(request);

      if (response.statusCode != 200) {
        throw Exception('서버 응답 오류 (HTTP ${response.statusCode})');
      }

      if (response.contentLength != null && response.contentLength! > 0) {
        totalBytes = response.contentLength!;
      }

      final tempDir = await getTemporaryDirectory();
      final apkFile = File('${tempDir.path}/lanovel-reader-update.apk');
      if (await apkFile.exists()) {
        await apkFile.delete();
      }

      final sink = apkFile.openWrite();

      await for (var chunk in response.stream) {
        if (isCancelled) {
          await sink.close();
          client.close();
          if (await apkFile.exists()) await apkFile.delete();
          return;
        }
        sink.add(chunk);
        receivedBytes += chunk.length;
        if (setProgressState != null) {
          setProgressState!(() {});
        }
      }

      await sink.flush();
      await sink.close();
      client.close();

      if (setProgressState != null) {
        setProgressState!(() {
          isApplying = true;
        });
      }

      // 다이얼로그 닫기
      if (context.mounted && Navigator.canPop(context)) {
        Navigator.pop(context);
      }

      // 패키지 설치 화면 호출
      final success = await _installerChannel.invokeMethod<bool>(
        'installApk',
        {'filePath': apkFile.path},
      );

      if (success != true && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('설치 화면 호출에 실패했습니다. 파일 관리자에서 APK를 직접 실행해 주세요.'),
          ),
        );
      }
    } catch (e) {
      if (context.mounted && Navigator.canPop(context)) {
        Navigator.pop(context);
      }
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('다운로드 실패: $e')),
        );
      }
    }
  }

  static bool _isBackgroundUpdating = false;

  /// 팝업/안내 없이 백그라운드에서 완전히 자동으로 수행하는 무설치 업데이트
  static Future<void> performSilentBackgroundUpdate(
    AppUpdateInfo updateInfo, {
    BuildContext? context,
  }) async {
    if (_isBackgroundUpdating) return;
    _isBackgroundUpdating = true;

    try {
      final serverUrl = PreferencesService.serverUrl;
      if (serverUrl.isEmpty) return;

      // 사용자에게 방해되지 않는 하단 스낵바 알림
      if (context != null && context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(
            content: Row(
              children: [
                const SizedBox(
                  width: 14,
                  height: 14,
                  child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white),
                ),
                const SizedBox(width: 10),
                Expanded(
                  child: Text(
                    '새 버전(v${updateInfo.version}) 백그라운드 무설치 자동 업데이트 중...',
                    style: const TextStyle(fontSize: 12),
                  ),
                ),
              ],
            ),
            duration: const Duration(seconds: 3),
            backgroundColor: Colors.indigo.shade700,
            behavior: SnackBarBehavior.floating,
          ),
        );
      }

      final client = http.Client();
      final request = http.Request('GET', Uri.parse('$serverUrl/api/app/download'));
      final response = await client.send(request);

      if (response.statusCode != 200) {
        throw Exception('HTTP ${response.statusCode}');
      }

      final tempDir = await getTemporaryDirectory();
      final apkFile = File('${tempDir.path}/lanovel-reader-update.apk');
      if (await apkFile.exists()) {
        await apkFile.delete();
      }

      final sink = apkFile.openWrite();
      await for (var chunk in response.stream) {
        sink.add(chunk);
      }
      await sink.flush();
      await sink.close();
      client.close();

      // 설치 창 호출
      await _installerChannel.invokeMethod<bool>(
        'installApk',
        {'filePath': apkFile.path},
      );
    } catch (e) {
      debugPrint('[AppUpdateService] Auto silent update error: $e');
    } finally {
      _isBackgroundUpdating = false;
    }
  }
}

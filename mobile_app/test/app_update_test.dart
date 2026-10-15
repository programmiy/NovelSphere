import 'package:flutter_test/flutter_test.dart';
import 'package:lanovel_reader/services/app_update_service.dart';

void main() {
  group('AppUpdateInfo & Version Comparison Tests', () {
    test('AppUpdateInfo parses json with full version and base_version', () {
      final json = {
        'version': '1.5.0.2026101401',
        'base_version': '1.5.0',
        'build_number': 2026101401,
        'has_apk': true,
        'file_size': 24593703,
        'file_name': 'lanovel-reader-v1.5.0.2026101401.apk',
        'download_url': '/api/app/download',
        'release_notes': '테스트 릴리즈',
      };

      final info = AppUpdateInfo.fromJson(json);

      expect(info.version, '1.5.0.2026101401');
      expect(info.baseVersion, '1.5.0');
      expect(info.buildNumber, 2026101401);
      expect(info.fileSize, 24593703);
      expect(info.hasApk, isTrue);
      expect(info.releaseNotes, '테스트 릴리즈');
    });

    test('Same build number and same base version should NOT trigger update', () {
      final serverInfo = AppUpdateInfo(
        version: '1.5.0.2026101401',
        baseVersion: '1.5.0',
        buildNumber: 2026101401,
        fileSize: 1000,
        releaseNotes: '',
        hasApk: true,
      );

      const currentBuild = 2026101401;
      const currentVersion = '1.5.0';

      // SemVer logic
      int compareSemVer(String v1, String v2) {
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

      final isNewer = serverInfo.buildNumber > currentBuild ||
          (serverInfo.buildNumber == currentBuild &&
              compareSemVer(serverInfo.baseVersion, currentVersion) > 0);

      expect(isNewer, isFalse, reason: '동일 빌드 및 버전일 때 새 버전으로 오판단하지 않아야 합니다.');
    });

    test('Higher build number should trigger update', () {
      final serverInfo = AppUpdateInfo(
        version: '1.5.0.2026101402',
        baseVersion: '1.5.0',
        buildNumber: 2026101402,
        fileSize: 1000,
        releaseNotes: '',
        hasApk: true,
      );

      const currentBuild = 2026101401;
      const currentVersion = '1.5.0';

      int compareSemVer(String v1, String v2) {
        final p1 = v1.split('.').map((e) => int.tryParse(e) ?? 0).toList();
        final p2 = v2.split('.').map((e) => int.tryParse(e) ?? 0).toList();
        final len = p1.length > p2.length ? p1.length : p2.length;
        for (int i = 0; i < len; i++) {
          final n1 = i < p1.length ? p1[i] : 0;
          final n2 = i < p2.length ? p2[i] : 0;
          if (n1 != n2) return n1.compareTo(n2);
        }
        return 0;
      }

      final isNewer = serverInfo.buildNumber > currentBuild ||
          (serverInfo.buildNumber == currentBuild &&
              compareSemVer(serverInfo.baseVersion, currentVersion) > 0);

      expect(isNewer, isTrue);
    });

    test('Higher base version with same build number should trigger update', () {
      final serverInfo = AppUpdateInfo(
        version: '1.5.1.2026101401',
        baseVersion: '1.5.1',
        buildNumber: 2026101401,
        fileSize: 1000,
        releaseNotes: '',
        hasApk: true,
      );

      const currentBuild = 2026101401;
      const currentVersion = '1.5.0';

      int compareSemVer(String v1, String v2) {
        final p1 = v1.split('.').map((e) => int.tryParse(e) ?? 0).toList();
        final p2 = v2.split('.').map((e) => int.tryParse(e) ?? 0).toList();
        final len = p1.length > p2.length ? p1.length : p2.length;
        for (int i = 0; i < len; i++) {
          final n1 = i < p1.length ? p1[i] : 0;
          final n2 = i < p2.length ? p2[i] : 0;
          if (n1 != n2) return n1.compareTo(n2);
        }
        return 0;
      }

      final isNewer = serverInfo.buildNumber > currentBuild ||
          (serverInfo.buildNumber == currentBuild &&
              compareSemVer(serverInfo.baseVersion, currentVersion) > 0);

      expect(isNewer, isTrue);
    });
  });
}

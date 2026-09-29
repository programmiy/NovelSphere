import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/server_analytics.dart';
import 'preferences_service.dart';

class ServerAnalyticsService {
  /// PC 서버로부터 번역 및 품질 통계 분석 데이터 조회
  static Future<ServerAnalyticsData?> fetchAnalytics({String? folderName}) async {
    final serverUrl = PreferencesService.serverUrl.trim();
    if (serverUrl.isEmpty) {
      if (kDebugMode) {
        print('[ServerAnalyticsService] serverUrl is empty');
      }
      return null;
    }

    try {
      final uri = Uri.parse(
        '$serverUrl/admin/analytics${folderName != null && folderName.isNotEmpty && folderName != '__all__' ? '?folder_name=${Uri.encodeComponent(folderName)}' : ''}',
      );

      final response = await http.get(uri).timeout(const Duration(seconds: 10));

      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
        if (decoded['status'] == 'success') {
          return ServerAnalyticsData.fromJson(decoded);
        }
      }
      return null;
    } catch (e) {
      if (kDebugMode) {
        print('[ServerAnalyticsService] fetchAnalytics error: $e');
      }
      return null;
    }
  }

  /// 특정 소설의 회차별 세부 드릴다운 정보 조회
  static Future<Map<String, dynamic>?> fetchNovelDrilldown(String folderName) async {
    final serverUrl = PreferencesService.serverUrl.trim();
    if (serverUrl.isEmpty || folderName.isEmpty) return null;

    try {
      final uri = Uri.parse('$serverUrl/admin/analytics/novel?folder_name=${Uri.encodeComponent(folderName)}');
      final response = await http.get(uri).timeout(const Duration(seconds: 8));

      if (response.statusCode == 200) {
        final decoded = json.decode(utf8.decode(response.bodyBytes)) as Map<String, dynamic>;
        if (decoded['status'] == 'success') {
          return decoded;
        }
      }
      return null;
    } catch (e) {
      if (kDebugMode) {
        print('[ServerAnalyticsService] fetchNovelDrilldown error: $e');
      }
      return null;
    }
  }
}

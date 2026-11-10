import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/special_batch_models.dart';
import 'preferences_service.dart';

class SpecialBatchService {
  static String get _serverUrl => PreferencesService.serverUrl.trim();
  static Map<String, String> _headers([Map<String, String>? extra]) => {
    ...PreferencesService.authHeaders,
    if (extra != null) ...extra,
  };

  /// 특별 적재 큐에 보관된 소설 목록 및 통계 조회
  static Future<List<SpecialBatchNovel>> fetchNovels() async {
    if (_serverUrl.isEmpty) return [];
    try {
      final uri = Uri.parse('$_serverUrl/api/special_batch/novels');
      final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        final novels = (decoded['novels'] as List<dynamic>?) ?? [];
        return novels
            .map((e) => SpecialBatchNovel.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return [];
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] fetchNovels error: $e');
      return [];
    }
  }

  /// 특정 소설의 회차 목록 조회
  static Future<List<SpecialBatchChapter>> fetchChapters(String? folderName) async {
    if (_serverUrl.isEmpty) return [];
    try {
      final queryParams = <String, String>{};
      if (folderName != null && folderName.isNotEmpty) {
        queryParams['folder_name'] = folderName;
      }
      final uri = Uri.parse('$_serverUrl/api/special_batch/chapters').replace(queryParameters: queryParams);
      final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        final chapters = (decoded['chapters'] as List<dynamic>?) ?? [];
        return chapters
            .map((e) => SpecialBatchChapter.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return [];
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] fetchChapters error: $e');
      return [];
    }
  }

  /// 문단 목록 및 상세 조회
  static Future<Map<String, dynamic>> fetchItems({
    String? folderName,
    String? chapterUrl,
    String status = 'staged',
    int limit = 100,
    int offset = 0,
  }) async {
    if (_serverUrl.isEmpty) return {'items': <SpecialBatchItem>[], 'total': 0, 'staged': 0};
    try {
      final queryParams = <String, String>{
        'limit': limit.toString(),
        'offset': offset.toString(),
      };
      if (folderName != null && folderName.isNotEmpty) {
        queryParams['folder_name'] = folderName;
      }
      if (chapterUrl != null && chapterUrl.isNotEmpty) {
        queryParams['chapter_url'] = chapterUrl;
      }
      if (status.isNotEmpty) {
        queryParams['status'] = status;
      }

      final uri = Uri.parse('$_serverUrl/api/special_batch/items').replace(queryParameters: queryParams);
      final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        final rawItems = (decoded['items'] as List<dynamic>?) ?? [];
        final items = rawItems
            .map((e) => SpecialBatchItem.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
        final counts = decoded['counts'] as Map<String, dynamic>? ?? {};

        return {
          'items': items,
          'total': (decoded['total'] as num?)?.toInt() ?? 0,
          'staged': (counts['staged'] as num?)?.toInt() ?? 0,
          'approved': (counts['approved'] as num?)?.toInt() ?? 0,
          'skipped': (counts['skipped'] as num?)?.toInt() ?? 0,
        };
      }
      return {'items': <SpecialBatchItem>[], 'total': 0, 'staged': 0};
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] fetchItems error: $e');
      return {'items': <SpecialBatchItem>[], 'total': 0, 'staged': 0};
    }
  }

  /// 단일 항목 승인 (본 DB translations 즉시 승격)
  static Future<bool> approveItem(int id, {String? translatedText}) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/special_batch/approve');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({
          'id': id,
          if (translatedText != null) 'translated_text': translatedText,
        }),
      ).timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] approveItem error: $e');
      return false;
    }
  }

  /// 일괄 승인 (소설 또는 회차 단위)
  static Future<Map<String, dynamic>> batchApprove({
    String? folderName,
    String? chapterUrl,
    String? batchId,
  }) async {
    if (_serverUrl.isEmpty) return {'success': false, 'count': 0};
    try {
      final uri = Uri.parse('$_serverUrl/api/special_batch/batch_approve');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({
          if (folderName != null) 'folder_name': folderName,
          if (chapterUrl != null) 'chapter_url': chapterUrl,
          if (batchId != null) 'batch_id': batchId,
        }),
      ).timeout(const Duration(seconds: 15));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        return {
          'success': true,
          'count': (decoded['approved_count'] as num?)?.toInt() ?? 0,
          'message': decoded['message'] as String? ?? '승인 완료',
        };
      }
      return {'success': false, 'count': 0};
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] batchApprove error: $e');
      return {'success': false, 'count': 0};
    }
  }

  /// 건너뛰기
  static Future<bool> skipItem(int id) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/special_batch/skip');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({'id': id}),
      ).timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] skipItem error: $e');
      return false;
    }
  }

  /// 되돌리기 (Undo)
  static Future<bool> undoItem(int id) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/special_batch/undo');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({'id': id}),
      ).timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] undoItem error: $e');
      return false;
    }
  }

  /// 텍스트 수정 저장
  static Future<bool> updateText(int id, String text) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/special_batch/update_text');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({'id': id, 'translated_text': text}),
      ).timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[SpecialBatchService] updateText error: $e');
      return false;
    }
  }
}

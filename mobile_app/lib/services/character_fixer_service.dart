import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/character_fix_models.dart';
import 'preferences_service.dart';

class CharacterFixerService {
  static String get _serverUrl => PreferencesService.serverUrl.trim();
  static Map<String, String> _headers([Map<String, String>? extra]) => {
    ...PreferencesService.authHeaders,
    if (extra != null) ...extra,
  };

  /// 서버의 소설 폴더 목록 및 문단 수 조회
  static Future<List<Map<String, dynamic>>> fetchFolders() async {
    if (_serverUrl.isEmpty) return [];
    try {
      var uri = Uri.parse('$_serverUrl/api/db_editor/folders');
      var res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 8));
      if (res.statusCode != 200) {
        uri = Uri.parse('$_serverUrl/api/db_editor/novels');
        res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 8));
      }
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        if (decoded is List) {
          return decoded.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        } else if (decoded is Map) {
          final folders = (decoded['folders'] ?? decoded['novels'] ?? []) as List<dynamic>;
          return folders.map((e) => Map<String, dynamic>.from(e as Map)).toList();
        }
      }
      return [];
    } catch (e) {
      if (kDebugMode) print('[CharacterFixerService] fetchFolders error: $e');
      return [];
    }
  }

  /// 소설별 인명/고유명사 교정 규칙 조회 (PC 서버와 1:1 일원화)
  static Future<List<CharacterRule>> fetchRules(String folderName) async {
    if (_serverUrl.isEmpty) return [];
    try {
      final uri = Uri.parse('$_serverUrl/api/db_editor/rules?folderName=${Uri.encodeComponent(folderName)}');
      final res = await http.get(uri, headers: _headers()).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        if (decoded is Map) {
          final rulesList = (decoded['rules'] as List<dynamic>?) ?? [];
          return rulesList.map((e) => CharacterRule.fromJson(Map<String, dynamic>.from(e as Map))).toList();
        } else if (decoded is List) {
          return decoded.map((e) => CharacterRule.fromJson(Map<String, dynamic>.from(e as Map))).toList();
        }
      }
      return [];
    } catch (e) {
      if (kDebugMode) print('[CharacterFixerService] fetchRules error: $e');
      return [];
    }
  }

  /// 규칙 저장
  static Future<bool> saveRules(String folderName, List<CharacterRule> rules) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/db_editor/rules');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({
          'folderName': folderName,
          'rules': rules.map((r) => r.toJson()).toList(),
        }),
      ).timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[CharacterFixerService] saveRules error: $e');
      return false;
    }
  }

  /// 통계 기반 오독 단어 자동 발굴 (로컬 공기 통계)
  static Future<List<MisreadingCandidate>> discoverMisreadings({
    required String folderName,
    required String source,
    required String target,
  }) async {
    if (_serverUrl.isEmpty) return [];
    try {
      final uri = Uri.parse('$_serverUrl/api/db_editor/discover_misreadings');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({
          'folderName': folderName,
          'source': source,
          'target': target,
        }),
      ).timeout(const Duration(seconds: 15));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
        final cands = decoded['candidates'] as List<dynamic>? ?? [];
        return cands.map((c) => MisreadingCandidate.fromJson(Map<String, dynamic>.from(c as Map))).toList();
      }
      return [];
    } catch (e) {
      if (kDebugMode) print('[CharacterFixerService] discoverMisreadings error: $e');
      return [];
    }
  }

  /// 문제 문장 정밀 스캔 실행
  static Future<Map<String, dynamic>?> scan(String folderName) async {
    if (_serverUrl.isEmpty) return null;
    try {
      final uri = Uri.parse('$_serverUrl/api/db_editor/scan');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({'folderName': folderName}),
      ).timeout(const Duration(seconds: 30));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
        final rawItems = decoded['items'] as List<dynamic>? ?? [];
        final items = rawItems.map((e) => CharacterFixItem.fromJson(Map<String, dynamic>.from(e as Map))).toList();
        final tagCounts = (decoded['tag_counts'] as Map<String, dynamic>?)?.map(
              (k, v) => MapEntry(k, v as int),
            ) ??
            {};
        return {
          'items': items,
          'total_matched': decoded['total_matched'] as int? ?? items.length,
          'tag_counts': tagCounts,
        };
      }
      return null;
    } catch (e) {
      if (kDebugMode) print('[CharacterFixerService] scan error: $e');
      return null;
    }
  }

  /// 단일 항목 교정 승인 및 DB 반영
  static Future<Map<String, dynamic>> approveSingle({
    required int id,
    required String translated,
    required bool backup,
  }) async {
    if (_serverUrl.isEmpty) return {'success': false, 'message': '서버 주소가 설정되지 않았습니다.'};
    try {
      final uri = Uri.parse('$_serverUrl/api/db_editor/approve_single');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({
          'id': id,
          'translated': translated,
          'backup': backup,
        }),
      ).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
        return {
          'success': decoded['status'] == 'success',
          'backup_created': decoded['backup_created'] as bool? ?? false,
          'backup_file': decoded['backup_file'] as String?,
          'message': decoded['detail'] as String? ?? '승인 완료',
        };
      }
      return {'success': false, 'message': 'HTTP ${res.statusCode}'};
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }

  /// 다중 항목 일괄 승인
  static Future<Map<String, dynamic>> approveBatch({
    required List<Map<String, dynamic>> items,
    required bool backup,
  }) async {
    if (_serverUrl.isEmpty) return {'success': false, 'message': '서버 주소가 설정되지 않았습니다.'};
    try {
      final uri = Uri.parse('$_serverUrl/api/db_editor/approve_batch');
      final res = await http.post(
        uri,
        headers: _headers({'Content-Type': 'application/json'}),
        body: json.encode({
          'items': items,
          'backup': backup,
        }),
      ).timeout(const Duration(seconds: 30));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes)) as Map<String, dynamic>;
        return {
          'success': decoded['status'] == 'success',
          'count': decoded['count'] as int? ?? 0,
          'backup_file': decoded['backup_file'] as String?,
          'message': decoded['detail'] as String? ?? '일괄 승인 완료',
        };
      }
      return {'success': false, 'message': 'HTTP ${res.statusCode}'};
    } catch (e) {
      return {'success': false, 'message': e.toString()};
    }
  }
}

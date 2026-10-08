import 'dart:convert';
import 'package:flutter/foundation.dart';
import 'package:http/http.dart' as http;
import '../models/ai_review_models.dart';
import 'preferences_service.dart';

class AiReviewService {
  static String get _serverUrl => PreferencesService.serverUrl.trim();

  /// 1차 AI 검수 큐 목록 조회
  static Future<List<AiReviewItem>> fetchQueue() async {
    if (_serverUrl.isEmpty) return [];
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/queue');
      final res = await http.get(uri).timeout(const Duration(seconds: 10));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        final items = (decoded['items'] as List<dynamic>?) ?? [];
        return items
            .map((e) => AiReviewItem.fromJson(Map<String, dynamic>.from(e as Map)))
            .toList();
      }
      return [];
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] fetchQueue error: $e');
      return [];
    }
  }

  /// AI 검수 통계 조회
  static Future<AiReviewStats?> fetchStats() async {
    if (_serverUrl.isEmpty) return null;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/stats');
      final res = await http.get(uri).timeout(const Duration(seconds: 6));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        return AiReviewStats.fromJson(Map<String, dynamic>.from(decoded as Map));
      }
      return null;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] fetchStats error: $e');
      return null;
    }
  }

  /// 번역 승인 (Approve)
  static Future<bool> approve(int queueId, String translatedText) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/approve');
      final res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: json.encode({
              'queue_id': queueId,
              'translated_text': translatedText,
            }),
          )
          .timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] approve error: $e');
      return false;
    }
  }

  /// 번역 거절 (Reject -> 2차 재재번역 큐로 전송)
  static Future<bool> reject(int queueId) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/reject');
      final res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: json.encode({'queue_id': queueId}),
          )
          .timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] reject error: $e');
      return false;
    }
  }

  /// 이전 작업 되돌리기 (Undo)
  static Future<bool> undo(int queueId) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/undo');
      final res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: json.encode({'queue_id': queueId}),
          )
          .timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] undo error: $e');
      return false;
    }
  }

  /// 단일 문장 즉시 재번역 (Reroll with 3.8 Flash)
  static Future<String?> reroll(int queueId) async {
    if (_serverUrl.isEmpty) return null;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/reroll?queue_id=$queueId');
      final res = await http.get(uri).timeout(const Duration(seconds: 15));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        final raw = decoded['translated_text'] as String?;
        return raw != null ? cleanAiTranslation(raw) : null;
      }
      return null;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] reroll error: $e');
      return null;
    }
  }

  /// 문맥 문장 인플레이스 즉시 수정
  static Future<bool> quickEditContext(int translationId, String translatedText) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/context/quick_edit');
      final res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: json.encode({
              'translation_id': translationId,
              'translated_text': translatedText,
            }),
          )
          .timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] quickEditContext error: $e');
      return false;
    }
  }

  /// 2차 재재번역 큐 및 모델별 분배 데이터 조회
  static Future<Map<String, List<ReretranslateBatchItem>>> fetchReretranslateQueue() async {
    if (_serverUrl.isEmpty) return {};
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/reretranslate/queue');
      final res = await http.get(uri).timeout(const Duration(seconds: 8));
      if (res.statusCode == 200) {
        final decoded = json.decode(utf8.decode(res.bodyBytes));
        final modelsMap = (decoded['models'] as Map<String, dynamic>?) ?? {};
        final result = <String, List<ReretranslateBatchItem>>{};
        for (final entry in modelsMap.entries) {
          final list = (entry.value as List<dynamic>?) ?? [];
          result[entry.key] = list
              .map((e) => ReretranslateBatchItem.fromJson(Map<String, dynamic>.from(e as Map)))
              .toList();
        }
        return result;
      }
      return {};
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] fetchReretranslateQueue error: $e');
      return {};
    }
  }

  /// 특정 모델로 재재번역 실행
  static Future<bool> runReretranslate(List<int> queueIds, String model) async {
    if (_serverUrl.isEmpty || queueIds.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/reretranslate/run');
      final res = await http
          .post(
            uri,
            headers: {'Content-Type': 'application/json'},
            body: json.encode({
              'queue_ids': queueIds,
              'model': model,
            }),
          )
          .timeout(const Duration(seconds: 10));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] runReretranslate error: $e');
      return false;
    }
  }

  /// 재재번역 큐에서 항목 삭제
  static Future<bool> deleteReretranslateItem(int queueId) async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/reretranslate/item/$queueId');
      final res = await http.delete(uri).timeout(const Duration(seconds: 8));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] deleteReretranslateItem error: $e');
      return false;
    }
  }

  /// 1차 초벌 번역 트리거
  static Future<bool> triggerInitial() async {
    if (_serverUrl.isEmpty) return false;
    try {
      final uri = Uri.parse('$_serverUrl/api/ai_review/trigger_initial');
      final res = await http.post(uri).timeout(const Duration(seconds: 10));
      return res.statusCode == 200;
    } catch (e) {
      if (kDebugMode) print('[AiReviewService] triggerInitial error: $e');
      return false;
    }
  }
}

import 'dart:convert';

/// AI 번역 결과에서 마크다운 코드블록, JSON 래퍼 태그, Python dict 표기 등을 정제하는 헬퍼 함수
/// (PC Web Admin의 ai_review.html cleanAiTranslation과 동일한 정제 로직)
String cleanAiTranslation(String? text) {
  if (text == null || text.trim().isEmpty) return '';

  String cleaned = text.trim();

  // 0. 마크다운 코드블록 내부에 들어있는 경우 추출
  final codeBlockMatch = RegExp(r'```(?:json)?\s*([\s\S]*?)\s*```', caseSensitive: false).firstMatch(cleaned);
  if (codeBlockMatch != null && codeBlockMatch.group(1) != null) {
    cleaned = codeBlockMatch.group(1)!.trim();
  } else {
    if (cleaned.startsWith('```json')) {
      cleaned = cleaned.substring(7).trim();
    } else if (cleaned.startsWith('```')) {
      cleaned = cleaned.substring(3).trim();
    }
    if (cleaned.endsWith('```')) {
      cleaned = cleaned.substring(0, cleaned.length - 3).trim();
    }
  }

  // 1. JSON 문자열 또는 Python dict 문자열에서 translated/translation/text 키 추출
  // 작은따옴표와 큰따옴표 모두 지원
  final match = RegExp(
    r"""(?:"|')(?:translated|translation|text)(?:"|')\s*:\s*(?:"|')((?:\\.|[^"'\\])*)(?:"|')""",
    caseSensitive: false,
  ).firstMatch(cleaned);

  if (match != null && match.group(1) != null) {
    final rawVal = match.group(1)!;
    try {
      return (json.decode('"$rawVal"') as String).trim();
    } catch (_) {
      return rawVal
          .replaceAll(r'\n', '\n')
          .replaceAll(r'\"', '"')
          .replaceAll(r"\'", "'")
          .replaceAll(r'\\', r'\')
          .trim();
    }
  }

  // 2. 전체가 JSON 배열 [...] 또는 객체 {...} 인 경우 파싱 시도
  if ((cleaned.startsWith('[') && cleaned.endsWith(']')) ||
      (cleaned.startsWith('{') && cleaned.endsWith('}'))) {
    try {
      final parsed = json.decode(cleaned);
      if (parsed is List && parsed.isNotEmpty) {
        final first = parsed[0];
        if (first is String) return first.trim();
        if (first is Map) {
          final val = first['translated'] ?? first['translation'] ?? first['text'];
          if (val is String) return val.trim();
        }
      } else if (parsed is Map) {
        final val = parsed['translated'] ?? parsed['translation'] ?? parsed['text'];
        if (val is String) return val.trim();
      }
    } catch (_) {}
  }

  // 3. Fallback: 코드블록이나 줄바꿈 등이 남아있는 경우 한번 더 트리밍
  if (cleaned.startsWith('```json')) cleaned = cleaned.substring(7).trim();
  if (cleaned.startsWith('```')) cleaned = cleaned.substring(3).trim();
  if (cleaned.endsWith('```')) cleaned = cleaned.substring(0, cleaned.length - 3).trim();

  return cleaned;
}

class AiReviewItem {
  final int queueId;
  final int translationId;
  final String originalText;
  final String? oldTranslatedText;
  String aiTranslatedText;
  final String modelUsed;
  final bool isReretranslated;
  final String? folderName;
  final String? url;
  final List<ContextSentence> contextBefore;
  final List<ContextSentence> contextAfter;

  AiReviewItem({
    required this.queueId,
    required this.translationId,
    required this.originalText,
    this.oldTranslatedText,
    required this.aiTranslatedText,
    required this.modelUsed,
    required this.isReretranslated,
    this.folderName,
    this.url,
    required this.contextBefore,
    required this.contextAfter,
  });

  factory AiReviewItem.fromJson(Map<String, dynamic> json) {
    return AiReviewItem(
      queueId: json['queue_id'] as int? ?? 0,
      translationId: json['translation_id'] as int? ?? 0,
      originalText: json['original_text'] as String? ?? '',
      oldTranslatedText: json['old_translated_text'] != null
          ? cleanAiTranslation(json['old_translated_text'] as String)
          : null,
      aiTranslatedText: cleanAiTranslation(json['ai_translated_text'] as String? ?? ''),
      modelUsed: json['model_used'] as String? ?? 'gemini-3.1-flash-lite',
      isReretranslated: json['is_reretranslated'] as bool? ?? false,
      folderName: json['folderName'] as String?,
      url: json['url'] as String?,
      contextBefore: (json['context_before'] as List<dynamic>?)
              ?.map((e) => ContextSentence.fromJson(Map<String, dynamic>.from(e as Map)))
              .toList() ??
          [],
      contextAfter: (json['context_after'] as List<dynamic>?)
              ?.map((e) => ContextSentence.fromJson(Map<String, dynamic>.from(e as Map)))
              .toList() ??
          [],
    );
  }
}

class ContextSentence {
  final int? id;
  final String original;
  String translated;
  final String? url;
  final dynamic pid;
  final String? folderName;
  final String? title;

  ContextSentence({
    this.id,
    required this.original,
    required this.translated,
    this.url,
    this.pid,
    this.folderName,
    this.title,
  });

  factory ContextSentence.fromJson(Map<String, dynamic> json) {
    return ContextSentence(
      id: json['id'] as int?,
      original: json['original'] as String? ?? '',
      translated: cleanAiTranslation(json['translated'] as String? ?? ''),
      url: json['url'] as String?,
      pid: json['pid'],
      folderName: json['folderName'] as String?,
      title: json['title'] as String?,
    );
  }
}

class AiReviewStats {
  final int total;
  final double avg;
  final int rejectedCount;
  final Map<String, dynamic> percentiles;

  AiReviewStats({
    required this.total,
    required this.avg,
    required this.rejectedCount,
    required this.percentiles,
  });

  factory AiReviewStats.fromJson(Map<String, dynamic> json) {
    return AiReviewStats(
      total: json['total'] as int? ?? 0,
      avg: (json['avg'] as num?)?.toDouble() ?? 0.0,
      rejectedCount: json['rejected_count'] as int? ?? 0,
      percentiles: Map<String, dynamic>.from((json['percentiles'] as Map?) ?? {}),
    );
  }
}

class ReretranslateBatchItem {
  final int queueId;
  final String originalText;
  final String? oldTranslatedText;
  final String? aiTranslatedText;
  final int length;
  final String? folderName;

  ReretranslateBatchItem({
    required this.queueId,
    required this.originalText,
    this.oldTranslatedText,
    this.aiTranslatedText,
    required this.length,
    this.folderName,
  });

  factory ReretranslateBatchItem.fromJson(Map<String, dynamic> json) {
    return ReretranslateBatchItem(
      queueId: json['queue_id'] as int? ?? 0,
      originalText: json['original_text'] as String? ?? '',
      oldTranslatedText: json['old_translated_text'] != null
          ? cleanAiTranslation(json['old_translated_text'] as String)
          : null,
      aiTranslatedText: json['ai_translated_text'] != null
          ? cleanAiTranslation(json['ai_translated_text'] as String)
          : null,
      length: json['length'] as int? ?? 0,
      folderName: json['folderName'] as String?,
    );
  }
}

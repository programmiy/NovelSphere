import 'dart:convert';

/// 업로드 대기 중인 로컬 변경사항 카테고리
enum PendingUploadCategory {
  translationEdit,
  glossaryRule,
  activity,
  pin,
  highlight,
}

/// 사용자에게 보여줄 단일 업로드 대기 항목 (중복 큐 병합 후 표시)
class PendingUploadItem {
  final PendingUploadCategory category;
  final String changeType;
  final String title;
  final String subtitle;
  final String? bookName;
  final String? chapterTitle;
  final String? pid;
  final String? beforeText;
  final String? afterText;
  final int timestamp;
  final int mergedCount;
  final Map<String, dynamic> rawPayload;

  const PendingUploadItem({
    required this.category,
    required this.changeType,
    required this.title,
    required this.subtitle,
    this.bookName,
    this.chapterTitle,
    this.pid,
    this.beforeText,
    this.afterText,
    this.timestamp = 0,
    this.mergedCount = 1,
    this.rawPayload = const {},
  });

  PendingUploadItem copyWith({
    PendingUploadCategory? category,
    String? changeType,
    String? title,
    String? subtitle,
    String? bookName,
    String? chapterTitle,
    String? pid,
    String? beforeText,
    String? afterText,
    int? timestamp,
    int? mergedCount,
    Map<String, dynamic>? rawPayload,
  }) {
    return PendingUploadItem(
      category: category ?? this.category,
      changeType: changeType ?? this.changeType,
      title: title ?? this.title,
      subtitle: subtitle ?? this.subtitle,
      bookName: bookName ?? this.bookName,
      chapterTitle: chapterTitle ?? this.chapterTitle,
      pid: pid ?? this.pid,
      beforeText: beforeText ?? this.beforeText,
      afterText: afterText ?? this.afterText,
      timestamp: timestamp ?? this.timestamp,
      mergedCount: mergedCount ?? this.mergedCount,
      rawPayload: rawPayload ?? this.rawPayload,
    );
  }
}

/// 업로드 대기 큐 전체 요약 및 분류 결과
class PendingUploadSummary {
  final int rawQueueCount;
  final int readingLogsCount;
  final List<PendingUploadItem> items;

  const PendingUploadSummary({
    required this.rawQueueCount,
    this.readingLogsCount = 0,
    required this.items,
  });

  const PendingUploadSummary.empty({this.readingLogsCount = 0})
      : rawQueueCount = 0,
        items = const [];

  int get logicalCount => items.length;
  bool get isEmpty => items.isEmpty;
  bool get isNotEmpty => items.isNotEmpty;

  int countByCategory(PendingUploadCategory category) {
    return items.where((item) => item.category == category).length;
  }

  int get translationEditCount => countByCategory(PendingUploadCategory.translationEdit);
  int get glossaryRuleCount => countByCategory(PendingUploadCategory.glossaryRule);
  int get activityCount => countByCategory(PendingUploadCategory.activity);
  int get pinCount => countByCategory(PendingUploadCategory.pin);
  int get highlightCount => countByCategory(PendingUploadCategory.highlight);

  /// 카테고리별 한 줄 요약 (예: "문장 수정 2건 · 독서 진도·상태 1건")
  String get briefSummaryText {
    if (isEmpty) return '대기 중인 변경사항이 없습니다.';
    final parts = <String>[];
    if (translationEditCount > 0) parts.add('문장 수정 $translationEditCount건');
    if (glossaryRuleCount > 0) parts.add('찾아바꾸기 $glossaryRuleCount건');
    if (activityCount > 0) parts.add('독서 진도·상태 $activityCount건');
    if (pinCount > 0) parts.add('상단 고정 $pinCount건');
    if (highlightCount > 0) parts.add('수정 대기 마킹 $highlightCount건');
    return parts.join(' · ');
  }

  /// SQLite `offline_change_queue` 원시 행 목록을 파싱하고 동일 대상 중복 항목을 통합 요약합니다.
  factory PendingUploadSummary.fromQueueRows(
    List<Map<String, dynamic>> rows, {
    int readingLogsCount = 0,
  }) {
    if (rows.isEmpty) {
      return PendingUploadSummary.empty(readingLogsCount: readingLogsCount);
    }

    // 순서 보장을 위해 key -> merged slot 리스트를 유지 (glossary_rule은 고유 키로 병합 안 함)
    final Map<String, _MergedRowSlot> mergedByKey = <String, _MergedRowSlot>{};
    final List<String> orderedKeys = <String>[];
    int glossarySeq = 0;

    for (final row in rows) {
      final type = (row['change_type'] as String? ?? '').trim();
      final targetId = row['target_id'] as String?;
      final createdAt = (row['created_at'] as num?)?.toInt() ?? 0;
      final payload = _decodePayload(row['payload_json']);

      String slotKey;
      if (type == 'glossary_rule') {
        slotKey = 'glossary_rule:${glossarySeq++}';
      } else if (type == 'highlight_add' || type == 'highlight_delete') {
        final url = (payload['url'] as String? ?? '').trim();
        final pid = (payload['pid'] as String? ?? '').trim();
        final canonical = (url.isNotEmpty || pid.isNotEmpty) ? '$url#$pid' : (targetId ?? '${row['id'] ?? glossarySeq++}');
        slotKey = 'highlight:$canonical';
      } else if (type == 'translation_edit') {
        final url = (payload['url'] as String? ?? '').trim();
        final pid = (payload['pid'] as String? ?? '').trim();
        final sentId = payload['id']?.toString() ?? '';
        final canonical = url.isNotEmpty
            ? '$url#${pid.isNotEmpty ? pid : sentId}'
            : (targetId != null && targetId.isNotEmpty ? targetId : '${row['id'] ?? glossarySeq++}');
        slotKey = 'translation_edit:$canonical';
      } else if (type == 'activity') {
        final folder = (payload['folderName'] as String? ?? targetId ?? '').trim();
        slotKey = 'activity:${folder.isNotEmpty ? folder : (row['id'] ?? glossarySeq++)}';
      } else if (type == 'pin') {
        final folder = (payload['folder_name'] as String? ?? payload['folderName'] as String? ?? targetId ?? '').trim();
        slotKey = 'pin:${folder.isNotEmpty ? folder : (row['id'] ?? glossarySeq++)}';
      } else {
        slotKey = 'other:$type:${targetId ?? row['id'] ?? glossarySeq++}';
      }

      if (!mergedByKey.containsKey(slotKey)) {
        final initialReasons = _extractReasons(type, payload);
        final initialBefore = _nonEmptyString(payload['before_translated']);
        mergedByKey[slotKey] = _MergedRowSlot(
          changeType: type,
          targetId: targetId,
          createdAt: createdAt,
          payload: Map<String, dynamic>.from(payload),
          earliestBeforeTranslated: initialBefore,
          reasons: initialReasons,
          mergedCount: 1,
        );
        orderedKeys.add(slotKey);
      } else {
        final existing = mergedByKey[slotKey]!;
        existing.changeType = type;
        if (targetId != null && targetId.isNotEmpty) {
          existing.targetId = targetId;
        }
        if (createdAt > existing.createdAt) {
          existing.createdAt = createdAt;
        }
        existing.mergedCount += 1;

        // 최초 수정 전 번역문은 보존하고, 나머지 최신 값만 덮어씀
        final incomingBefore = _nonEmptyString(payload['before_translated']);
        if (existing.earliestBeforeTranslated == null && incomingBefore != null) {
          existing.earliestBeforeTranslated = incomingBefore;
        }
        existing.reasons.addAll(_extractReasons(type, payload));

        final mergedPayload = Map<String, dynamic>.from(existing.payload);
        mergedPayload.addAll(payload);
        if (existing.earliestBeforeTranslated != null) {
          mergedPayload['before_translated'] = existing.earliestBeforeTranslated;
        }
        existing.payload = mergedPayload;
      }
    }

    final List<PendingUploadItem> items = [];
    for (final key in orderedKeys) {
      final slot = mergedByKey[key]!;
      items.add(_buildItemFromSlot(slot));
    }

    // 최신 변경 항목이 먼저 보이도록 정렬 (동일 시각이면 기존 순서 유지)
    items.sort((a, b) => b.timestamp.compareTo(a.timestamp));

    return PendingUploadSummary(
      rawQueueCount: rows.length,
      readingLogsCount: readingLogsCount,
      items: items,
    );
  }

  static PendingUploadItem _buildItemFromSlot(_MergedRowSlot slot) {
    final p = slot.payload;
    final ts = _readTimestamp(p, slot.createdAt);

    switch (slot.changeType) {
      case 'translation_edit':
        final folder = _nonEmptyString(p['folderName']) ?? _nonEmptyString(p['book_name']);
        final chap = _nonEmptyString(p['title']) ?? _nonEmptyString(p['chapter_title']);
        final pid = _nonEmptyString(p['pid']);
        final orig = _nonEmptyString(p['original']);
        final after = p['translated'] as String? ?? '';
        final before = slot.earliestBeforeTranslated ?? _nonEmptyString(p['before_translated']) ?? orig;

        final subParts = <String>[];
        if (chap != null) subParts.add(chap);
        if (pid != null) subParts.add(pid);
        if (subParts.isEmpty && p['id'] != null) subParts.add('문장 #${p['id']}');

        return PendingUploadItem(
          category: PendingUploadCategory.translationEdit,
          changeType: slot.changeType,
          title: folder ?? '문장 직접 수정',
          subtitle: subParts.isNotEmpty ? subParts.join(' · ') : '직접 수정한 번역 문장',
          bookName: folder,
          chapterTitle: chap,
          pid: pid,
          beforeText: before,
          afterText: after,
          timestamp: ts,
          mergedCount: slot.mergedCount,
          rawPayload: p,
        );

      case 'glossary_rule':
        final findText = p['find_text'] as String? ?? p['findText'] as String? ?? '';
        final replaceText = p['replace_text'] as String? ?? p['replaceText'] as String? ?? '';
        final scope = _nonEmptyString(p['folder_scope']) ?? _nonEmptyString(p['folderScope']) ?? '__all__';
        final cond = _nonEmptyString(p['condition_text']) ?? _nonEmptyString(p['conditionText']);
        final replaced = (p['replaced_count'] as num?)?.toInt() ?? (p['replacedCount'] as num?)?.toInt() ?? 0;
        final useRegex = (p['use_regex'] == 1) || (p['use_regex'] == true) || (p['useRegex'] == true);

        final scopeLabel = scope == '__all__' ? '전체 작품' : scope;
        final subParts = <String>[scopeLabel];
        if (replaced > 0) subParts.add('$replaced개 문장 적용');
        if (useRegex) subParts.add('정규식');
        if (cond != null) subParts.add('원문 조건: $cond');

        return PendingUploadItem(
          category: PendingUploadCategory.glossaryRule,
          changeType: slot.changeType,
          title: '$findText ➔ $replaceText',
          subtitle: subParts.join(' · '),
          bookName: scope == '__all__' ? null : scope,
          beforeText: findText,
          afterText: replaceText,
          timestamp: ts,
          mergedCount: slot.mergedCount,
          rawPayload: p,
        );

      case 'activity':
        final folder = _nonEmptyString(p['folderName']) ?? _nonEmptyString(slot.targetId) ?? '소설';
        final chap = _nonEmptyString(p['last_read_chapter_title']);
        final pid = _nonEmptyString(p['last_read_pid']);
        final isCompleted = (p['is_completed'] == 1) || (p['is_completed'] == true);
        final isBookmarked = (p['is_bookmarked'] == 1) || (p['is_bookmarked'] == true);
        final hasVisible = p.containsKey('is_visible');
        final isVisible = (p['is_visible'] == 1) || (p['is_visible'] == true);

        final detailParts = <String>[];
        final reasons = slot.reasons;

        if (reasons.isNotEmpty) {
          if (reasons.contains('reading_progress')) {
            if (chap != null) {
              detailParts.add('진도: $chap${pid != null ? ' ($pid)' : ''}');
            } else {
              detailParts.add('독서 진도 갱신');
            }
          }
          if (reasons.contains('bookmark')) {
            detailParts.add(isBookmarked ? '즐겨찾기 등록' : '즐겨찾기 해제');
          }
          if (reasons.contains('complete')) {
            detailParts.add(isCompleted ? '완독 처리' : '완독 해제');
          }
          if (reasons.contains('visibility')) {
            detailParts.add(isVisible ? '서재 숨김 해제' : '서재에서 숨김');
          }
        }

        // 구버전 큐 행 등 change_reasons가 없는 경우 payload 필드로 추론
        if (detailParts.isEmpty) {
          if (chap != null) {
            detailParts.add('진도: $chap${pid != null ? ' ($pid)' : ''}');
          }
          if (isBookmarked) detailParts.add('즐겨찾기');
          if (isCompleted) detailParts.add('완독');
          if (hasVisible && !isVisible) detailParts.add('서재 숨김');
          if (detailParts.isEmpty) detailParts.add('작품 상태 동기화');
        }

        return PendingUploadItem(
          category: PendingUploadCategory.activity,
          changeType: slot.changeType,
          title: folder,
          subtitle: detailParts.join(' · '),
          bookName: folder,
          chapterTitle: chap,
          pid: pid,
          timestamp: ts,
          mergedCount: slot.mergedCount,
          rawPayload: p,
        );

      case 'pin':
        final folder = _nonEmptyString(p['folder_name']) ??
            _nonEmptyString(p['folderName']) ??
            _nonEmptyString(slot.targetId) ??
            '소설';
        final isPinned = (p['is_pinned'] == 1) || (p['is_pinned'] == true);
        return PendingUploadItem(
          category: PendingUploadCategory.pin,
          changeType: slot.changeType,
          title: folder,
          subtitle: isPinned ? '서재 최상단 고정 ON' : '서재 최상단 고정 해제',
          bookName: folder,
          timestamp: ts,
          mergedCount: slot.mergedCount,
          rawPayload: p,
        );

      case 'highlight_add':
        final folder = _nonEmptyString(p['book_name']) ?? _nonEmptyString(p['bookName']);
        final chap = _nonEmptyString(p['chapter_title']) ?? _nonEmptyString(p['chapterTitle']);
        final pid = _nonEmptyString(p['pid']);
        final trans = _nonEmptyString(p['translated']);
        final subParts = <String>['수정 대기 마킹 추가'];
        if (chap != null) subParts.add(chap);
        if (pid != null) subParts.add(pid);
        return PendingUploadItem(
          category: PendingUploadCategory.highlight,
          changeType: slot.changeType,
          title: folder ?? '수정 대기 마킹',
          subtitle: subParts.join(' · '),
          bookName: folder,
          chapterTitle: chap,
          pid: pid,
          afterText: trans,
          timestamp: ts,
          mergedCount: slot.mergedCount,
          rawPayload: p,
        );

      case 'highlight_delete':
        final folder = _nonEmptyString(p['book_name']) ?? _nonEmptyString(p['bookName']);
        final chap = _nonEmptyString(p['chapter_title']) ?? _nonEmptyString(p['chapterTitle']);
        final pid = _nonEmptyString(p['pid']);
        final subParts = <String>['수정 대기 마킹 해제'];
        if (chap != null) subParts.add(chap);
        if (pid != null) subParts.add(pid);
        return PendingUploadItem(
          category: PendingUploadCategory.highlight,
          changeType: slot.changeType,
          title: folder ?? '마킹 해제',
          subtitle: subParts.join(' · '),
          bookName: folder,
          chapterTitle: chap,
          pid: pid,
          timestamp: ts,
          mergedCount: slot.mergedCount,
          rawPayload: p,
        );

      default:
        return PendingUploadItem(
          category: PendingUploadCategory.activity,
          changeType: slot.changeType,
          title: slot.targetId ?? slot.changeType,
          subtitle: '변경사항 동기화',
          timestamp: ts,
          mergedCount: slot.mergedCount,
          rawPayload: p,
        );
    }
  }

  static Map<String, dynamic> _decodePayload(dynamic raw) {
    if (raw is Map<String, dynamic>) return raw;
    if (raw is Map) return Map<String, dynamic>.from(raw);
    if (raw is String && raw.isNotEmpty) {
      try {
        final decoded = jsonDecode(raw);
        if (decoded is Map<String, dynamic>) return decoded;
        if (decoded is Map) return Map<String, dynamic>.from(decoded);
      } catch (_) {}
    }
    return <String, dynamic>{};
  }

  static Set<String> _extractReasons(String changeType, Map<String, dynamic> payload) {
    final reasons = <String>{};
    final rawReasons = payload['change_reasons'];
    if (rawReasons is List) {
      for (final r in rawReasons) {
        final s = r?.toString().trim() ?? '';
        if (s.isNotEmpty) reasons.add(s);
      }
    }
    return reasons;
  }

  static String? _nonEmptyString(dynamic value) {
    if (value == null) return null;
    final s = value.toString().trim();
    return s.isEmpty ? null : s;
  }

  static int _readTimestamp(Map<String, dynamic> p, int fallback) {
    final candidates = [
      p['timestamp'],
      p['last_read_timestamp'],
      p['applied_at'],
      p['appliedAt'],
      p['updated_at'],
      p['created_at'],
    ];
    for (final c in candidates) {
      if (c is num && c.toInt() > 0) return c.toInt();
    }
    return fallback;
  }
}

class _MergedRowSlot {
  String changeType;
  String? targetId;
  int createdAt;
  Map<String, dynamic> payload;
  String? earliestBeforeTranslated;
  final Set<String> reasons;
  int mergedCount;

  _MergedRowSlot({
    required this.changeType,
    this.targetId,
    required this.createdAt,
    required this.payload,
    this.earliestBeforeTranslated,
    required this.reasons,
    required this.mergedCount,
  });
}

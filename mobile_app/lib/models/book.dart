import 'dart:convert';

class Book {
  final String folderName;
  final int totalChapters;
  final String? lastReadChapterTitle;
  final String? lastReadPid;
  final int? lastReadTimestamp;
  final bool isCompleted;
  final bool isVisible;
  final bool isBookmarked;
  final bool isPinned;
  final String? notes;
  final String? summary;
  final List<String> tags;

  Book({
    required this.folderName,
    this.totalChapters = 0,
    this.lastReadChapterTitle,
    this.lastReadPid,
    this.lastReadTimestamp,
    this.isCompleted = false,
    this.isVisible = true,
    this.isBookmarked = false,
    this.isPinned = false,
    this.notes,
    this.summary,
    this.tags = const [],
  });

  /// 독서 진도율 (0.0 ~ 1.0)
  double get estimatedProgress {
    if (isCompleted) return 1.0;
    if (totalChapters <= 0) return 0.0;
    if (lastReadChapterTitle != null && lastReadChapterTitle!.isNotEmpty) {
      final match = RegExp(r'(\d+)\s*(?:화|편|장|회|Episode)', caseSensitive: false).firstMatch(lastReadChapterTitle!);
      if (match != null) {
        final cur = int.tryParse(match.group(1)!) ?? 0;
        if (cur > 0) {
          final p = cur / totalChapters;
          return p.clamp(0.0, 1.0);
        }
      }
    }
    return lastReadTimestamp != null ? 0.05 : 0.0;
  }

  factory Book.fromMap(Map<String, dynamic> map) {
    List<String> parsedTags = [];
    if (map['tags'] != null) {
      try {
        final decoded = jsonDecode(map['tags']);
        if (decoded is List) {
          parsedTags = decoded.map((e) => e.toString()).toList();
        }
      } catch (_) {}
    }

    bool parseBool(dynamic val, bool defaultVal) {
      if (val == null) return defaultVal;
      if (val is bool) return val;
      if (val is num) return val != 0;
      if (val is String) {
        final s = val.trim().toLowerCase();
        return s == '1' || s == 'true';
      }
      return defaultVal;
    }

    int parseInt(dynamic val, int defaultVal) {
      if (val == null) return defaultVal;
      if (val is num) return val.toInt();
      if (val is String) return int.tryParse(val) ?? defaultVal;
      return defaultVal;
    }

    return Book(
      folderName: (map['folder_name'] ?? '').toString(),
      totalChapters: parseInt(map['total_chapters'], 0),
      lastReadChapterTitle: map['last_read_chapter_title']?.toString(),
      lastReadPid: map['last_read_pid']?.toString(),
      lastReadTimestamp: map['last_read_timestamp'] != null ? parseInt(map['last_read_timestamp'], 0) : null,
      isCompleted: parseBool(map['is_completed'], false),
      isVisible: parseBool(map['is_visible'], true),
      isBookmarked: parseBool(map['is_bookmarked'], false),
      isPinned: parseBool(map['is_pinned'], false),
      notes: map['notes']?.toString(),
      summary: map['summary']?.toString(),
      tags: parsedTags,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      'folder_name': folderName,
      'total_chapters': totalChapters,
      'last_read_chapter_title': lastReadChapterTitle,
      'last_read_pid': lastReadPid,
      'last_read_timestamp': lastReadTimestamp,
      'is_completed': isCompleted ? 1 : 0,
      'is_visible': isVisible ? 1 : 0,
      'is_bookmarked': isBookmarked ? 1 : 0,
      'is_pinned': isPinned ? 1 : 0,
      'notes': notes,
      'summary': summary,
      'tags': jsonEncode(tags),
    };
  }

  Book copyWith({
    String? folderName,
    int? totalChapters,
    String? lastReadChapterTitle,
    String? lastReadPid,
    int? lastReadTimestamp,
    bool? isCompleted,
    bool? isVisible,
    bool? isBookmarked,
    bool? isPinned,
    String? notes,
    String? summary,
    List<String>? tags,
  }) {
    return Book(
      folderName: folderName ?? this.folderName,
      totalChapters: totalChapters ?? this.totalChapters,
      lastReadChapterTitle: lastReadChapterTitle ?? this.lastReadChapterTitle,
      lastReadPid: lastReadPid ?? this.lastReadPid,
      lastReadTimestamp: lastReadTimestamp ?? this.lastReadTimestamp,
      isCompleted: isCompleted ?? this.isCompleted,
      isVisible: isVisible ?? this.isVisible,
      isBookmarked: isBookmarked ?? this.isBookmarked,
      isPinned: isPinned ?? this.isPinned,
      notes: notes ?? this.notes,
      summary: summary ?? this.summary,
      tags: tags ?? this.tags,
    );
  }
}

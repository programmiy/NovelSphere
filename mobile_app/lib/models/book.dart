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

    return Book(
      folderName: map['folder_name'] ?? '',
      totalChapters: map['total_chapters'] ?? 0,
      lastReadChapterTitle: map['last_read_chapter_title'],
      lastReadPid: map['last_read_pid'],
      lastReadTimestamp: map['last_read_timestamp'],
      isCompleted: (map['is_completed'] ?? 0) == 1,
      isVisible: (map['is_visible'] ?? 1) == 1,
      isBookmarked: (map['is_bookmarked'] ?? 0) == 1,
      isPinned: (map['is_pinned'] ?? 0) == 1,
      notes: map['notes'],
      summary: map['summary'],
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

/// 특별 적재(Special Batch Queue) 데이터 모델 정의

class SpecialBatchNovel {
  final String? folderName;
  final int totalCount;
  final int stagedCount;
  final int approvedCount;
  final int skippedCount;

  const SpecialBatchNovel({
    this.folderName,
    required this.totalCount,
    required this.stagedCount,
    required this.approvedCount,
    required this.skippedCount,
  });

  String get displayName => (folderName == null || folderName!.isEmpty) ? '미분류 보관함' : folderName!;

  factory SpecialBatchNovel.fromJson(Map<String, dynamic> json) {
    return SpecialBatchNovel(
      folderName: json['folder_name'] as String?,
      totalCount: (json['total_count'] as num?)?.toInt() ?? 0,
      stagedCount: (json['staged_count'] as num?)?.toInt() ?? 0,
      approvedCount: (json['approved_count'] as num?)?.toInt() ?? 0,
      skippedCount: (json['skipped_count'] as num?)?.toInt() ?? 0,
    );
  }
}

class SpecialBatchChapter {
  final String url;
  final String chapterTitle;
  final int chapterIndex;
  final int totalCount;
  final int stagedCount;
  final int approvedCount;

  const SpecialBatchChapter({
    required this.url,
    required this.chapterTitle,
    required this.chapterIndex,
    required this.totalCount,
    required this.stagedCount,
    required this.approvedCount,
  });

  factory SpecialBatchChapter.fromJson(Map<String, dynamic> json) {
    return SpecialBatchChapter(
      url: json['url'] as String? ?? '',
      chapterTitle: json['chapter_title'] as String? ?? '',
      chapterIndex: (json['chapter_index'] as num?)?.toInt() ?? 0,
      totalCount: (json['total_count'] as num?)?.toInt() ?? 0,
      stagedCount: (json['staged_count'] as num?)?.toInt() ?? 0,
      approvedCount: (json['approved_count'] as num?)?.toInt() ?? 0,
    );
  }
}

class SpecialBatchItem {
  final int id;
  final String batchId;
  final String url;
  final String? folderName;
  final String chapterTitle;
  final int chapterIndex;
  final String pid;
  final String originalText;
  String translatedText;
  String status; // 'staged', 'approved', 'skipped'
  final int createdAt;
  final int? promotedAt;

  SpecialBatchItem({
    required this.id,
    required this.batchId,
    required this.url,
    this.folderName,
    required this.chapterTitle,
    required this.chapterIndex,
    required this.pid,
    required this.originalText,
    required this.translatedText,
    required this.status,
    required this.createdAt,
    this.promotedAt,
  });

  factory SpecialBatchItem.fromJson(Map<String, dynamic> json) {
    return SpecialBatchItem(
      id: (json['id'] as num).toInt(),
      batchId: json['batch_id'] as String? ?? '',
      url: json['url'] as String? ?? '',
      folderName: json['folder_name'] as String?,
      chapterTitle: json['chapter_title'] as String? ?? '',
      chapterIndex: (json['chapter_index'] as num?)?.toInt() ?? 0,
      pid: json['pid'] as String? ?? '',
      originalText: json['original_text'] as String? ?? '',
      translatedText: json['translated_text'] as String? ?? '',
      status: json['status'] as String? ?? 'staged',
      createdAt: (json['created_at'] as num?)?.toInt() ?? 0,
      promotedAt: (json['promoted_at'] as num?)?.toInt(),
    );
  }
}

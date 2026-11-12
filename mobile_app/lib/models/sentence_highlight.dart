class SentenceHighlight {
  final int? id;
  final String bookName;
  final String chapterTitle;
  final String url;
  final String pid;
  final String original;
  final String translated;
  final String? note;
  final int createdAt;
  final int? updatedAt;
  final int isResolved; // 0: 대기중, 1: 수정완료

  SentenceHighlight({
    this.id,
    required this.bookName,
    required this.chapterTitle,
    required this.url,
    required this.pid,
    required this.original,
    required this.translated,
    this.note,
    required this.createdAt,
    this.updatedAt,
    this.isResolved = 0,
  });

  bool get resolved => isResolved == 1;

  factory SentenceHighlight.fromJson(Map<String, dynamic> json) {
    return SentenceHighlight(
      id: json['id'] as int?,
      bookName: json['book_name'] ?? json['bookName'] ?? '',
      chapterTitle: json['chapter_title'] ?? json['chapterTitle'] ?? '',
      url: json['url'] ?? '',
      pid: json['pid'] ?? '',
      original: json['original'] ?? '',
      translated: json['translated'] ?? '',
      note: json['note'] as String?,
      createdAt: json['created_at'] ?? json['createdAt'] ?? (DateTime.now().millisecondsSinceEpoch ~/ 1000),
      updatedAt: json['updated_at'] ?? json['updatedAt'] as int?,
      isResolved: json['is_resolved'] ?? json['isResolved'] ?? 0,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (id != null) 'id': id,
      'book_name': bookName,
      'chapter_title': chapterTitle,
      'url': url,
      'pid': pid,
      'original': original,
      'translated': translated,
      if (note != null) 'note': note,
      'created_at': createdAt,
      if (updatedAt != null) 'updated_at': updatedAt,
      'is_resolved': isResolved,
    };
  }
}

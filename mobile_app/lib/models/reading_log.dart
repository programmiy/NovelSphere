class ReadingLog {
  final int? id;
  final String date; // YYYY-MM-DD
  final int readSeconds;
  final int pagesCount;
  final String? bookTitle;
  final String? chapterTitle;
  final int createdAt;

  ReadingLog({
    this.id,
    required this.date,
    required this.readSeconds,
    required this.pagesCount,
    this.bookTitle,
    this.chapterTitle,
    required this.createdAt,
  });

  factory ReadingLog.fromMap(Map<String, dynamic> map) {
    return ReadingLog(
      id: map['id'],
      date: map['date'] ?? '',
      readSeconds: map['read_seconds'] ?? 0,
      pagesCount: map['pages_count'] ?? 0,
      bookTitle: map['book_title'],
      chapterTitle: map['chapter_title'],
      createdAt: map['created_at'] ?? 0,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'date': date,
      'read_seconds': readSeconds,
      'pages_count': pagesCount,
      'book_title': bookTitle,
      'chapter_title': chapterTitle,
      'created_at': createdAt,
    };
  }
}

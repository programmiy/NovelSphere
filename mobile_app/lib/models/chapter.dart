import 'dart:typed_data';

class Chapter {
  final int? id;
  final String bookName;
  final String title;
  final String url;
  final int sortOrder;
  final int sentenceCount;
  final Uint8List? compressedContent;

  Chapter({
    this.id,
    required this.bookName,
    required this.title,
    required this.url,
    this.sortOrder = 0,
    this.sentenceCount = 0,
    this.compressedContent,
  });

  factory Chapter.fromMap(Map<String, dynamic> map, {bool includeBlob = false}) {
    return Chapter(
      id: map['id'],
      bookName: map['book_name'] ?? '',
      title: map['title'] ?? '',
      url: map['url'] ?? '',
      sortOrder: map['sort_order'] ?? 0,
      sentenceCount: map['sentence_count'] ?? 0,
      compressedContent: includeBlob ? map['compressed_content'] as Uint8List? : null,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'book_name': bookName,
      'title': title,
      'url': url,
      'sort_order': sortOrder,
      'sentence_count': sentenceCount,
      if (compressedContent != null) 'compressed_content': compressedContent,
    };
  }
}

class Sentence {
  final int? id;
  final String? pid;
  final String original;
  String translated;
  final int timestamp;
  bool isModified;

  Sentence({
    this.id,
    this.pid,
    required this.original,
    required this.translated,
    required this.timestamp,
    this.isModified = false,
  });

  factory Sentence.fromJson(Map<String, dynamic> json) {
    return Sentence(
      id: json['id'],
      pid: json['pid'],
      original: json['original'] ?? '',
      translated: json['translated'] ?? '',
      timestamp: json['timestamp'] ?? 0,
      isModified: false,
    );
  }

  Map<String, dynamic> toJson() {
    return {
      if (id != null) 'id': id,
      if (pid != null) 'pid': pid,
      'original': original,
      'translated': translated,
      'timestamp': timestamp,
    };
  }
}

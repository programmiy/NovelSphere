class CharacterFixItem {
  final int id;
  final String folderName;
  final int chapterId;
  final String title;
  final String original;
  final String translated;
  final String suggested;
  final List<String> reasons;
  final List<String> tags;

  CharacterFixItem({
    required this.id,
    required this.folderName,
    required this.chapterId,
    required this.title,
    required this.original,
    required this.translated,
    required this.suggested,
    required this.reasons,
    required this.tags,
  });

  factory CharacterFixItem.fromJson(Map<String, dynamic> json) {
    return CharacterFixItem(
      id: json['id'] as int? ?? 0,
      folderName: json['folderName'] as String? ?? '',
      chapterId: json['chapter_id'] as int? ?? 0,
      title: json['title'] as String? ?? '회차 제목 없음',
      original: json['original'] as String? ?? '',
      translated: json['translated'] as String? ?? '',
      suggested: json['suggested'] as String? ?? '',
      reasons: (json['reasons'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      tags: (json['tags'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'folderName': folderName,
      'chapter_id': chapterId,
      'title': title,
      'original': original,
      'translated': translated,
      'suggested': suggested,
      'reasons': reasons,
      'tags': tags,
    };
  }
}

class CharacterRule {
  String id;
  String source;
  String target;
  bool enabled;
  String description;
  List<String> misreadings;
  List<String> exceptions;

  CharacterRule({
    required this.id,
    required this.source,
    required this.target,
    this.enabled = true,
    this.description = '',
    this.misreadings = const [],
    this.exceptions = const [],
  });

  factory CharacterRule.fromJson(Map<String, dynamic> json) {
    return CharacterRule(
      id: json['id'] as String? ?? 'rule-${DateTime.now().millisecondsSinceEpoch}',
      source: json['source'] as String? ?? '',
      target: json['target'] as String? ?? '',
      enabled: json['enabled'] as bool? ?? true,
      description: json['description'] as String? ?? '',
      misreadings: (json['misreadings'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
      exceptions: (json['exceptions'] as List<dynamic>?)?.map((e) => e.toString()).toList() ?? [],
    );
  }

  Map<String, dynamic> toJson() {
    return {
      'id': id,
      'source': source,
      'target': target,
      'enabled': enabled,
      'description': description,
      'misreadings': misreadings,
      'exceptions': exceptions,
    };
  }
}

class MisreadingCandidate {
  final String word;
  final int count;
  final double ratio;

  MisreadingCandidate({
    required this.word,
    required this.count,
    required this.ratio,
  });

  factory MisreadingCandidate.fromJson(Map<String, dynamic> json) {
    return MisreadingCandidate(
      word: json['word'] as String? ?? '',
      count: json['count'] as int? ?? 0,
      ratio: (json['ratio'] as num?)?.toDouble() ?? 0.0,
    );
  }
}

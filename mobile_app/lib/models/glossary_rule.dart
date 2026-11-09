class GlossaryRule {
  final int? id;
  final String folderScope; // '__all__' or specific book folderName
  final String findText;
  final String replaceText;
  final String? conditionText; // 원문 포함 조건 필터
  final bool useRegex;
  final bool caseSensitive;
  final int appliedAt;
  final int replacedCount; // 적용 당시 치환된 문단 수
  final bool isFavorite; // 단어장 즐겨찾기/고정

  GlossaryRule({
    this.id,
    this.folderScope = '__all__',
    required this.findText,
    required this.replaceText,
    this.conditionText,
    this.useRegex = false,
    this.caseSensitive = false,
    required this.appliedAt,
    this.replacedCount = 0,
    this.isFavorite = false,
  });

  factory GlossaryRule.fromMap(Map<String, dynamic> map) {
    return GlossaryRule(
      id: map['id'] as int?,
      folderScope: map['folder_scope'] as String? ?? '__all__',
      findText: map['find_text'] as String? ?? '',
      replaceText: map['replace_text'] as String? ?? '',
      conditionText: map['condition_text'] as String?,
      useRegex: (map['use_regex'] ?? 0) == 1,
      caseSensitive: (map['case_sensitive'] ?? 0) == 1,
      appliedAt: map['applied_at'] as int? ?? 0,
      replacedCount: map['replaced_count'] as int? ?? 0,
      isFavorite: (map['is_favorite'] ?? 0) == 1,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'folder_scope': folderScope,
      'find_text': findText,
      'replace_text': replaceText,
      if (conditionText != null) 'condition_text': conditionText,
      'use_regex': useRegex ? 1 : 0,
      'case_sensitive': caseSensitive ? 1 : 0,
      'applied_at': appliedAt,
      'replaced_count': replacedCount,
      'is_favorite': isFavorite ? 1 : 0,
    };
  }
}

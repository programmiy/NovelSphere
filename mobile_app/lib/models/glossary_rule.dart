class GlossaryRule {
  final int? id;
  final String folderScope; // '__all__' or specific book folderName
  final String findText;
  final String replaceText;
  final bool useRegex;
  final bool caseSensitive;
  final int appliedAt;

  GlossaryRule({
    this.id,
    this.folderScope = '__all__',
    required this.findText,
    required this.replaceText,
    this.useRegex = false,
    this.caseSensitive = false,
    required this.appliedAt,
  });

  factory GlossaryRule.fromMap(Map<String, dynamic> map) {
    return GlossaryRule(
      id: map['id'],
      folderScope: map['folder_scope'] ?? '__all__',
      findText: map['find_text'] ?? '',
      replaceText: map['replace_text'] ?? '',
      useRegex: (map['use_regex'] ?? 0) == 1,
      caseSensitive: (map['case_sensitive'] ?? 0) == 1,
      appliedAt: map['applied_at'] ?? 0,
    );
  }

  Map<String, dynamic> toMap() {
    return {
      if (id != null) 'id': id,
      'folder_scope': folderScope,
      'find_text': findText,
      'replace_text': replaceText,
      'use_regex': useRegex ? 1 : 0,
      'case_sensitive': caseSensitive ? 1 : 0,
      'applied_at': appliedAt,
    };
  }
}

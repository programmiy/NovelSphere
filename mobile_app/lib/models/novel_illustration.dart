import 'sentence.dart';

class NovelIllustration {
  final int id;
  final String bookName;
  final String chapterUrl;
  final String chapterTitle;
  final String afterPid;
  final int sortOrder;
  final String caption;
  final String fileRelPath;
  final String mimeType;
  final int? width;
  final int? height;
  final int fileSize;
  final int createdAt;
  final int updatedAt;

  const NovelIllustration({
    required this.id,
    required this.bookName,
    required this.chapterUrl,
    required this.chapterTitle,
    required this.afterPid,
    this.sortOrder = 0,
    this.caption = '',
    required this.fileRelPath,
    this.mimeType = 'image/png',
    this.width,
    this.height,
    this.fileSize = 0,
    this.createdAt = 0,
    this.updatedAt = 0,
  });

  static String normalizeAfterPid(String? raw) {
    final trimmed = (raw ?? 'END').trim();
    if (trimmed.isEmpty) return 'END';
    final upper = trimmed.toUpperCase();
    if (upper == 'TOP' || upper == 'END') return upper;
    return trimmed;
  }

  String get normalizedAfterPid => normalizeAfterPid(afterPid);

  String get fileExtension {
    final lowerMime = mimeType.toLowerCase();
    if (lowerMime.contains('jpeg') || lowerMime.contains('jpg')) return 'jpg';
    if (lowerMime.contains('webp')) return 'webp';
    if (lowerMime.contains('png')) return 'png';
    final dotIdx = fileRelPath.lastIndexOf('.');
    if (dotIdx != -1 && dotIdx + 1 < fileRelPath.length) {
      final ext = fileRelPath.substring(dotIdx + 1).toLowerCase();
      if (ext == 'png' || ext == 'jpg' || ext == 'jpeg' || ext == 'webp') {
        return ext == 'jpeg' ? 'jpg' : ext;
      }
    }
    return 'png';
  }

  String get cacheFileName => 'illu_${id}_$updatedAt.$fileExtension';

  double get aspectRatio {
    if (width != null && height != null && width! > 0 && height! > 0) {
      return width! / height!;
    }
    return 0.78;
  }

  factory NovelIllustration.fromMap(Map<String, dynamic> map) {
    return NovelIllustration(
      id: (map['id'] as num?)?.toInt() ?? 0,
      bookName: map['book_name'] as String? ?? '',
      chapterUrl: map['chapter_url'] as String? ?? '',
      chapterTitle: map['chapter_title'] as String? ?? '',
      afterPid: normalizeAfterPid(map['after_pid'] as String?),
      sortOrder: (map['sort_order'] as num?)?.toInt() ?? 0,
      caption: map['caption'] as String? ?? '',
      fileRelPath: map['file_rel_path'] as String? ?? '',
      mimeType: map['mime_type'] as String? ?? 'image/png',
      width: (map['width'] as num?)?.toInt(),
      height: (map['height'] as num?)?.toInt(),
      fileSize: (map['file_size'] as num?)?.toInt() ?? 0,
      createdAt: (map['created_at'] as num?)?.toInt() ?? 0,
      updatedAt: (map['updated_at'] as num?)?.toInt() ?? 0,
    );
  }

  Map<String, dynamic> toDbMap() {
    return {
      'id': id,
      'book_name': bookName,
      'chapter_url': chapterUrl,
      'chapter_title': chapterTitle,
      'after_pid': normalizedAfterPid,
      'sort_order': sortOrder,
      'caption': caption,
      'file_rel_path': fileRelPath,
      'mime_type': mimeType,
      'width': width,
      'height': height,
      'file_size': fileSize,
      'created_at': createdAt,
      'updated_at': updatedAt,
    };
  }
}

enum ReaderFlowItemType { sentence, illustration }

class ReaderFlowItem {
  final ReaderFlowItemType type;
  final Sentence? sentence;
  final NovelIllustration? illustration;

  const ReaderFlowItem.sentence(this.sentence)
      : type = ReaderFlowItemType.sentence,
        illustration = null;

  const ReaderFlowItem.illustration(this.illustration)
      : type = ReaderFlowItemType.illustration,
        sentence = null;

  bool get isSentence => type == ReaderFlowItemType.sentence;
  bool get isIllustration => type == ReaderFlowItemType.illustration;
}

/// 챕터 문장 리스트와 삽화 리스트를 PID 기준으로 인터리빙합니다.
/// - `TOP`: 본문 최상단
/// - `<pid>`: 대소문자 무시 일치하는 문장 바로 뒤 (`L10` == `l10`)
/// - `END` 또는 미일치 PID: 본문 최하단
List<ReaderFlowItem> buildReaderFlowItems(
  List<Sentence> sentences,
  List<NovelIllustration> illustrations,
) {
  if (illustrations.isEmpty) {
    return sentences.map((s) => ReaderFlowItem.sentence(s)).toList();
  }

  final sorted = List<NovelIllustration>.from(illustrations)
    ..sort((a, b) {
      final orderCmp = a.sortOrder.compareTo(b.sortOrder);
      return orderCmp != 0 ? orderCmp : a.id.compareTo(b.id);
    });

  final validPidsUpper = <String>{};
  for (final s in sentences) {
    final pid = s.pid?.trim().toUpperCase();
    if (pid != null && pid.isNotEmpty) {
      validPidsUpper.add(pid);
    }
  }

  final topList = <NovelIllustration>[];
  final endList = <NovelIllustration>[];
  final byPidUpper = <String, List<NovelIllustration>>{};

  for (final illu in sorted) {
    final norm = illu.normalizedAfterPid;
    final upper = norm.toUpperCase();
    if (upper == 'TOP') {
      topList.add(illu);
    } else if (upper == 'END') {
      endList.add(illu);
    } else if (validPidsUpper.contains(upper)) {
      byPidUpper.putIfAbsent(upper, () => <NovelIllustration>[]).add(illu);
    } else {
      // 일치 PID가 없는 경우 유실되지 않도록 끝으로 배치
      endList.add(illu);
    }
  }

  final result = <ReaderFlowItem>[];
  for (final illu in topList) {
    result.add(ReaderFlowItem.illustration(illu));
  }

  for (final s in sentences) {
    result.add(ReaderFlowItem.sentence(s));
    final pidKey = s.pid?.trim().toUpperCase();
    if (pidKey != null && pidKey.isNotEmpty) {
      final matched = byPidUpper.remove(pidKey);
      if (matched != null) {
        for (final illu in matched) {
          result.add(ReaderFlowItem.illustration(illu));
        }
      }
    }
  }

  for (final illu in endList) {
    result.add(ReaderFlowItem.illustration(illu));
  }

  return result;
}

/// 페이지 모드에서 문장(가중치 1)과 삽화(가중치 2~3)를 균형 있게 페이지별로 슬라이싱합니다.
List<List<ReaderFlowItem>> paginateReaderFlowItems(
  List<ReaderFlowItem> flowItems,
  int sentencesPerPage,
) {
  if (flowItems.isEmpty) return const [];
  final maxWeight = sentencesPerPage.clamp(1, 50);
  final illuWeight = maxWeight >= 5 ? 3 : (maxWeight >= 3 ? 2 : 1);

  final pages = <List<ReaderFlowItem>>[];
  var current = <ReaderFlowItem>[];
  var currentWeight = 0;

  for (final item in flowItems) {
    final w = item.isIllustration ? illuWeight : 1;
    if (current.isNotEmpty && currentWeight + w > maxWeight) {
      pages.add(current);
      current = <ReaderFlowItem>[];
      currentWeight = 0;
    }
    current.add(item);
    currentWeight += w;
    if (currentWeight >= maxWeight) {
      pages.add(current);
      current = <ReaderFlowItem>[];
      currentWeight = 0;
    }
  }

  if (current.isNotEmpty) {
    pages.add(current);
  }
  return pages;
}

int findFlowPageForPid(List<List<ReaderFlowItem>> pages, String targetPid) {
  final targetUpper = targetPid.trim().toUpperCase();
  if (targetUpper.isEmpty || pages.isEmpty) return 0;
  for (var p = 0; p < pages.length; p++) {
    for (final item in pages[p]) {
      final pid = item.sentence?.pid?.trim().toUpperCase();
      if (pid == targetUpper) {
        return p;
      }
    }
  }
  return 0;
}

String? firstPidInFlowPage(
  List<ReaderFlowItem> page, [
  List<Sentence> fallbackSentences = const [],
]) {
  for (final item in page) {
    final pid = item.sentence?.pid;
    if (pid != null && pid.isNotEmpty) return pid;
  }
  if (fallbackSentences.isNotEmpty) {
    return fallbackSentences.first.pid;
  }
  return null;
}

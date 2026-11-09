import '../services/text_diff_helper.dart';

/// 찾아바꾸기 실시간 미리보기 및 선택적 치환용 문단 단위 데이터 모델
class FindReplaceItem {
  final int chapterId;
  final String bookName;
  final String chapterTitle;
  final int sentenceId;
  final String pid;
  final String original;
  final String beforeText;
  final String afterText;
  final DiffResult diff;

  const FindReplaceItem({
    required this.chapterId,
    required this.bookName,
    required this.chapterTitle,
    required this.sentenceId,
    required this.pid,
    required this.original,
    required this.beforeText,
    required this.afterText,
    required this.diff,
  });

  /// 고유 식별 키 (챕터ID + 문단PID)
  String get uniqueKey => '${chapterId}_$pid';
}

import 'dart:math' as math;
import 'package:flutter/material.dart';

enum DiffType { equal, delete, insert }

class DiffOp {
  final DiffType type;
  final String text;

  const DiffOp({required this.type, required this.text});
}

class DiffChange {
  final String from;
  final String to;

  const DiffChange({required this.from, required this.to});
}

class DiffResult {
  final List<DiffOp> ops;
  final List<DiffChange> changes;

  const DiffResult({required this.ops, required this.changes});

  bool get hasChanges => changes.isNotEmpty;
}

class TextDiffHelper {
  static List<String> tokenize(String text) {
    if (text.isEmpty) return [];
    final regExp = RegExp(r'\s+|[^\s]+');
    return regExp.allMatches(text).map((m) => m.group(0)!).toList();
  }

  static DiffResult computeDiff(String beforeText, String afterText) {
    if (beforeText.isEmpty && afterText.isEmpty) {
      return const DiffResult(ops: [], changes: []);
    }
    if (beforeText.isEmpty) {
      return DiffResult(
        ops: [DiffOp(type: DiffType.insert, text: afterText)],
        changes: [DiffChange(from: '', to: afterText)],
      );
    }
    if (afterText.isEmpty) {
      return DiffResult(
        ops: [DiffOp(type: DiffType.delete, text: beforeText)],
        changes: [DiffChange(from: beforeText, to: '')],
      );
    }
    if (beforeText == afterText) {
      return DiffResult(
        ops: [DiffOp(type: DiffType.equal, text: beforeText)],
        changes: const [],
      );
    }

    final tokensA = tokenize(beforeText);
    final tokensB = tokenize(afterText);
    final n = tokensA.length;
    final m = tokensB.length;

    // 1. Fast path: Trim identical prefix tokens
    int prefixLen = 0;
    while (prefixLen < n && prefixLen < m && tokensA[prefixLen] == tokensB[prefixLen]) {
      prefixLen++;
    }

    // 2. Fast path: Trim identical suffix tokens
    int suffixLen = 0;
    while (suffixLen < (n - prefixLen) &&
        suffixLen < (m - prefixLen) &&
        tokensA[n - 1 - suffixLen] == tokensB[m - 1 - suffixLen]) {
      suffixLen++;
    }

    final subA = tokensA.sublist(prefixLen, n - suffixLen);
    final subB = tokensB.sublist(prefixLen, m - suffixLen);
    final subN = subA.length;
    final subM = subB.length;

    final middleOps = <DiffOp>[];
    if (subN > 0 && subM > 0) {
      final dp = List.generate(subN + 1, (_) => List<int>.filled(subM + 1, 0));
      for (int i = 0; i < subN; i++) {
        for (int j = 0; j < subM; j++) {
          if (subA[i] == subB[j]) {
            dp[i + 1][j + 1] = dp[i][j] + 1;
          } else {
            dp[i + 1][j + 1] = math.max(dp[i + 1][j], dp[i][j + 1]);
          }
        }
      }

      int i = subN, j = subM;
      while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && subA[i - 1] == subB[j - 1]) {
          middleOps.add(DiffOp(type: DiffType.equal, text: subA[i - 1]));
          i--;
          j--;
        } else if (j > 0 && (i == 0 || dp[i][j - 1] >= dp[i - 1][j])) {
          middleOps.add(DiffOp(type: DiffType.insert, text: subB[j - 1]));
          j--;
        } else {
          middleOps.add(DiffOp(type: DiffType.delete, text: subA[i - 1]));
          i--;
        }
      }
    } else if (subN > 0) {
      for (int i = subN - 1; i >= 0; i--) {
        middleOps.add(DiffOp(type: DiffType.delete, text: subA[i]));
      }
    } else if (subM > 0) {
      for (int j = subM - 1; j >= 0; j--) {
        middleOps.add(DiffOp(type: DiffType.insert, text: subB[j]));
      }
    }

    final rawOps = <DiffOp>[];
    // Prepend common prefix
    for (int p = 0; p < prefixLen; p++) {
      rawOps.add(DiffOp(type: DiffType.equal, text: tokensA[p]));
    }
    // Append reversed middle ops
    rawOps.addAll(middleOps.reversed);
    // Append common suffix
    for (int s = n - suffixLen; s < n; s++) {
      rawOps.add(DiffOp(type: DiffType.equal, text: tokensA[s]));
    }
    final reversed = rawOps;

    final refined = <DiffOp>[];
    final changes = <DiffChange>[];

    final isWordChar = RegExp(r'[가-힣a-zA-Z0-9]');

    for (int k = 0; k < reversed.length; k++) {
      final curr = reversed[k];
      final next = (k + 1 < reversed.length) ? reversed[k + 1] : null;

      if (curr.type == DiffType.delete && next != null && next.type == DiffType.insert) {
        String del = curr.text;
        String ins = next.text;

        // Strip common leading punctuation
        int pLen = 0;
        while (pLen < del.length &&
            pLen < ins.length &&
            del[pLen] == ins[pLen] &&
            !isWordChar.hasMatch(del[pLen])) {
          pLen++;
        }
        if (pLen > 0) {
          refined.add(DiffOp(type: DiffType.equal, text: del.substring(0, pLen)));
          del = del.substring(pLen);
          ins = ins.substring(pLen);
        }

        // Strip common trailing suffix (particles or punctuation)
        int sLen = 0;
        while (sLen < del.length &&
            sLen < ins.length &&
            del[del.length - 1 - sLen] == ins[ins.length - 1 - sLen]) {
          sLen++;
        }
        String suffix = '';
        if (sLen > 0) {
          suffix = del.substring(del.length - sLen);
          del = del.substring(0, del.length - sLen);
          ins = ins.substring(0, ins.length - sLen);
        }

        if (del.isNotEmpty) refined.add(DiffOp(type: DiffType.delete, text: del));
        if (ins.isNotEmpty) refined.add(DiffOp(type: DiffType.insert, text: ins));
        if (del.isNotEmpty || ins.isNotEmpty) {
          changes.add(DiffChange(from: del, to: ins));
        }
        if (suffix.isNotEmpty) refined.add(DiffOp(type: DiffType.equal, text: suffix));

        k++; // skip next
      } else if (curr.type == DiffType.delete) {
        refined.add(curr);
        changes.add(DiffChange(from: curr.text, to: ''));
      } else if (curr.type == DiffType.insert) {
        refined.add(curr);
        changes.add(DiffChange(from: '', to: curr.text));
      } else {
        refined.add(curr);
      }
    }

    return DiffResult(ops: refined, changes: changes);
  }

  /// Builds TextSpan tree for live Diff Preview
  static List<InlineSpan> buildDiffSpans({
    required List<DiffOp> ops,
    required Color defaultTextColor,
    required bool isDarkMode,
  }) {
    final delBg = isDarkMode ? const Color(0x40EF4444) : const Color(0xFFFEE2E2);
    final delText = isDarkMode ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C);

    final insBg = isDarkMode ? const Color(0x4010B981) : const Color(0xFFD1FAE5);
    final insText = isDarkMode ? const Color(0xFF6EE7B7) : const Color(0xFF047857);

    return ops.map<InlineSpan>((op) {
      if (op.type == DiffType.delete) {
        return WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            margin: const EdgeInsets.symmetric(horizontal: 1),
            decoration: BoxDecoration(
              color: delBg,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              op.text,
              style: TextStyle(
                color: delText,
                fontWeight: FontWeight.w600,
                decoration: TextDecoration.lineThrough,
                decorationColor: const Color(0xFFEF4444),
                decorationThickness: 2.0,
                fontSize: 14,
              ),
            ),
          ),
        );
      } else if (op.type == DiffType.insert) {
        return WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            margin: const EdgeInsets.symmetric(horizontal: 1),
            decoration: BoxDecoration(
              color: insBg,
              borderRadius: BorderRadius.circular(4),
              border: Border(bottom: BorderSide(color: insText, width: 2.0)),
            ),
            child: Text(
              op.text,
              style: TextStyle(
                color: insText,
                fontWeight: FontWeight.bold,
                fontSize: 14,
              ),
            ),
          ),
        );
      } else {
        return TextSpan(
          text: op.text,
          style: TextStyle(color: defaultTextColor, fontSize: 14, height: 1.6),
        );
      }
    }).toList();
  }

  /// Builds TextSpan tree for Before text showing deleted words with red strikethrough
  static List<InlineSpan> buildBeforeSpans({
    required List<DiffOp> ops,
    required Color defaultTextColor,
    required bool isDarkMode,
  }) {
    final delBg = isDarkMode ? const Color(0x40EF4444) : const Color(0xFFFEE2E2);
    final delText = isDarkMode ? const Color(0xFFFCA5A5) : const Color(0xFFB91C1C);

    return ops.where((op) => op.type != DiffType.insert).map<InlineSpan>((op) {
      if (op.type == DiffType.delete) {
        return WidgetSpan(
          alignment: PlaceholderAlignment.middle,
          child: Container(
            padding: const EdgeInsets.symmetric(horizontal: 4, vertical: 1),
            margin: const EdgeInsets.symmetric(horizontal: 1),
            decoration: BoxDecoration(
              color: delBg,
              borderRadius: BorderRadius.circular(4),
            ),
            child: Text(
              op.text,
              style: TextStyle(
                color: delText,
                fontWeight: FontWeight.w700,
                decoration: TextDecoration.lineThrough,
                decorationColor: const Color(0xFFEF4444),
                decorationThickness: 2.0,
                fontSize: 14,
              ),
            ),
          ),
        );
      } else {
        return TextSpan(
          text: op.text,
          style: TextStyle(color: defaultTextColor, fontSize: 14, height: 1.6),
        );
      }
    }).toList();
  }
}

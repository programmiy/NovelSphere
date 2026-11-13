import 'dart:convert';

import 'package:flutter/material.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:lanovel_reader/models/pending_upload.dart';
import 'package:lanovel_reader/services/device_utils.dart';
import 'package:lanovel_reader/ui/sync/pending_changes_sheet.dart';
import 'package:lanovel_reader/ui/themes/reader_themes.dart';

void main() {
  group('DeviceUtils phone vs tablet detection', () {
    test('treats shortestSide >= 600 as tablet and < 600 as bar-type phone', () {
      expect(DeviceUtils.isTabletWidth(360.0), isFalse);
      expect(DeviceUtils.isTabletWidth(412.0), isFalse);
      expect(DeviceUtils.isTabletWidth(599.9), isFalse);
      expect(DeviceUtils.isTabletWidth(600.0), isTrue);
      expect(DeviceUtils.isTabletWidth(800.0), isTrue);
    });

    testWidgets('uses MediaQuery shortestSide across portrait and landscape', (tester) async {
      bool? detected;

      Future<void> pumpSize(Size size) async {
        await tester.pumpWidget(
          MaterialApp(
            home: MediaQuery(
              data: MediaQueryData(size: size),
              child: Builder(
                builder: (context) {
                  detected = DeviceUtils.isTablet(context);
                  return const SizedBox.shrink();
                },
              ),
            ),
          ),
        );
      }

      // Bar-type phone portrait (Galaxy S24 Ultra)
      await pumpSize(const Size(412, 915));
      expect(detected, isFalse);

      // Bar-type phone landscape: longest side > 600, shortestSide still < 600
      await pumpSize(const Size(915, 412));
      expect(detected, isFalse);

      // Tablet portrait (Galaxy Tab S8)
      await pumpSize(const Size(800, 1280));
      expect(detected, isTrue);
    });
  });

  group('PendingUploadSummary parsing and coalescing', () {
    test('handles empty queue', () {
      final summary = PendingUploadSummary.fromQueueRows(const [], readingLogsCount: 3);
      expect(summary.isEmpty, isTrue);
      expect(summary.logicalCount, 0);
      expect(summary.readingLogsCount, 3);
      expect(summary.briefSummaryText, contains('없습니다'));
    });

    test('collapses duplicate activities, preserves earliest before_translated, and keeps glossary rules ordered', () {
      final rows = <Map<String, dynamic>>[
        // Repeated reading ticks for same book should merge into 1 item with combined reasons
        {
          'id': 1,
          'change_type': 'activity',
          'target_id': '이세계소설',
          'created_at': 1000,
          'payload_json': jsonEncode({
            'folderName': '이세계소설',
            'last_read_chapter_title': '10화',
            'last_read_pid': 'p5',
            'last_read_timestamp': 1000,
            'is_completed': 0,
            'is_bookmarked': 0,
            'is_visible': 1,
            'change_reasons': ['reading_progress'],
          }),
        },
        {
          'id': 2,
          'change_type': 'activity',
          'target_id': '이세계소설',
          'created_at': 1010,
          'payload_json': jsonEncode({
            'folderName': '이세계소설',
            'last_read_chapter_title': '10화',
            'last_read_pid': 'p18',
            'last_read_timestamp': 1010,
            'is_completed': 0,
            'is_bookmarked': 1,
            'is_visible': 1,
            'change_reasons': ['bookmark'],
          }),
        },
        // Repeated sentence edit for same chapter/pid keeps earliest before_translated & latest translated
        {
          'id': 3,
          'change_type': 'translation_edit',
          'target_id': 'https://ex.com/ch10#p12',
          'created_at': 1020,
          'payload_json': jsonEncode({
            'id': 501,
            'pid': 'p12',
            'folderName': '이세계소설',
            'title': '10화',
            'url': 'https://ex.com/ch10',
            'original': '原文テスト',
            'before_translated': '최초 번역문',
            'translated': '중간 수정본',
            'timestamp': 1020,
          }),
        },
        {
          'id': 4,
          'change_type': 'translation_edit',
          'target_id': 'https://ex.com/ch10#p12',
          'created_at': 1030,
          'payload_json': jsonEncode({
            'id': 501,
            'pid': 'p12',
            'folderName': '이세계소설',
            'title': '10화',
            'url': 'https://ex.com/ch10',
            'original': '原文テスト',
            'before_translated': '중간 수정본',
            'translated': '최종 수정본',
            'timestamp': 1030,
          }),
        },
        // Two sequential glossary rules must NOT collapse
        {
          'id': 5,
          'change_type': 'glossary_rule',
          'target_id': '카일->칼',
          'created_at': 1040,
          'payload_json': jsonEncode({
            'folder_scope': '이세계소설',
            'find_text': '카일',
            'replace_text': '칼',
            'use_regex': 0,
            'replaced_count': 12,
            'applied_at': 1040,
          }),
        },
        {
          'id': 6,
          'change_type': 'glossary_rule',
          'target_id': '마왕->마황',
          'created_at': 1050,
          'payload_json': jsonEncode({
            'folder_scope': '__all__',
            'find_text': '마왕',
            'replace_text': '마황',
            'use_regex': 1,
            'replaced_count': 5,
            'applied_at': 1050,
          }),
        },
        // Pin toggle collapsed to latest state
        {
          'id': 7,
          'change_type': 'pin',
          'target_id': '이세계소설',
          'created_at': 1060,
          'payload_json': jsonEncode({'folder_name': '이세계소설', 'is_pinned': true}),
        },
        // Highlight add then delete on same target collapses to highlight_delete
        {
          'id': 8,
          'change_type': 'highlight_add',
          'target_id': 'https://ex.com/ch10#p3',
          'created_at': 1070,
          'payload_json': jsonEncode({
            'book_name': '이세계소설',
            'chapter_title': '10화',
            'url': 'https://ex.com/ch10',
            'pid': 'p3',
            'translated': '마킹 대상',
          }),
        },
        {
          'id': 9,
          'change_type': 'highlight_delete',
          'target_id': 'https://ex.com/ch10#p3',
          'created_at': 1080,
          'payload_json': jsonEncode({
            'book_name': '이세계소설',
            'chapter_title': '10화',
            'url': 'https://ex.com/ch10',
            'pid': 'p3',
          }),
        },
      ];

      final summary = PendingUploadSummary.fromQueueRows(rows, readingLogsCount: 4);

      expect(summary.rawQueueCount, 9);
      expect(summary.logicalCount, 6); // 1 activity + 1 edit + 2 glossary + 1 pin + 1 highlight
      expect(summary.activityCount, 1);
      expect(summary.translationEditCount, 1);
      expect(summary.glossaryRuleCount, 2);
      expect(summary.pinCount, 1);
      expect(summary.highlightCount, 1);
      expect(summary.readingLogsCount, 4);

      final actItem = summary.items.firstWhere((i) => i.category == PendingUploadCategory.activity);
      expect(actItem.mergedCount, 2);
      expect(actItem.subtitle, contains('진도: 10화 (p18)'));
      expect(actItem.subtitle, contains('즐겨찾기 등록'));

      final editItem = summary.items.firstWhere((i) => i.category == PendingUploadCategory.translationEdit);
      expect(editItem.mergedCount, 2);
      expect(editItem.beforeText, '최초 번역문');
      expect(editItem.afterText, '최종 수정본');
      expect(editItem.subtitle, '10화 · p12');

      final hlItem = summary.items.firstWhere((i) => i.category == PendingUploadCategory.highlight);
      expect(hlItem.changeType, 'highlight_delete');
      expect(hlItem.subtitle, contains('마킹 해제'));
    });

    test('infers details gracefully for legacy activity rows missing change_reasons', () {
      final summary = PendingUploadSummary.fromQueueRows([
        {
          'id': 1,
          'change_type': 'activity',
          'target_id': '구버전소설',
          'created_at': 1700000000,
          'payload_json': jsonEncode({
            'folderName': '구버전소설',
            'last_read_chapter_title': '3화',
            'last_read_pid': 'p7',
            'is_completed': 1,
            'is_bookmarked': 0,
            'is_visible': 0,
          }),
        },
      ]);

      expect(summary.logicalCount, 1);
      final item = summary.items.single;
      expect(item.subtitle, contains('진도: 3화 (p7)'));
      expect(item.subtitle, contains('완독'));
      expect(item.subtitle, contains('서재 숨김'));
    });
  });

  group('PendingChangesSheet widget UI', () {
    PendingUploadSummary buildSampleSummary() {
      return PendingUploadSummary.fromQueueRows([
        {
          'id': 1,
          'change_type': 'translation_edit',
          'target_id': 'https://ex.com/1#p1',
          'created_at': 1700000100,
          'payload_json': jsonEncode({
            'id': 10,
            'pid': 'p1',
            'folderName': '샘플작품',
            'title': '제1화',
            'url': 'https://ex.com/1',
            'original': '元の文',
            'before_translated': '어색한 초벌 번역',
            'translated': '자연스럽게 다듬은 번역',
            'timestamp': 1700000100,
          }),
        },
        {
          'id': 2,
          'change_type': 'translation_edit',
          'target_id': 'https://ex.com/1#p1',
          'created_at': 1700000200,
          'payload_json': jsonEncode({
            'id': 10,
            'pid': 'p1',
            'folderName': '샘플작품',
            'title': '제1화',
            'url': 'https://ex.com/1',
            'original': '元の文',
            'before_translated': '자연스럽게 다듬은 번역',
            'translated': '최종 교정 완료 문장',
            'timestamp': 1700000200,
          }),
        },
        {
          'id': 3,
          'change_type': 'glossary_rule',
          'target_id': 'A->B',
          'created_at': 1700000300,
          'payload_json': jsonEncode({
            'folder_scope': '샘플작품',
            'find_text': '아리스',
            'replace_text': '앨리스',
            'replaced_count': 4,
            'applied_at': 1700000300,
          }),
        },
      ], readingLogsCount: 2);
    }

    testWidgets('displays before/after diff, merged badge, filter chips, and returns true on confirm', (tester) async {
      final summary = buildSampleSummary();
      final theme = ReaderThemes.allThemes.first;
      bool? confirmResult;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () async {
                  confirmResult = await showPendingChangesSheet(
                    context,
                    summary: summary,
                    theme: theme,
                    confirmUpload: true,
                  );
                },
                child: const Text('열기'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('열기'));
      await tester.pumpAndSettle();

      expect(find.text('업로드 전 변경사항 확인'), findsOneWidget);
      expect(find.text('2회 통합'), findsOneWidget);
      expect(find.text('어색한 초벌 번역'), findsOneWidget);
      expect(find.text('최종 교정 완료 문장'), findsOneWidget);
      expect(find.text('아리스 ➔ 앨리스'), findsOneWidget);

      // Filter to glossary_rule only
      await tester.tap(find.text('찾아바꾸기 1'));
      await tester.pumpAndSettle();
      expect(find.text('아리스 ➔ 앨리스'), findsOneWidget);
      expect(find.text('최종 교정 완료 문장'), findsNothing);

      // Reset to 전체 and confirm upload
      await tester.tap(find.text('전체 2'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('PC로 업로드 (2건)'));
      await tester.pumpAndSettle();

      expect(confirmResult, isTrue);
    });

    testWidgets('returns false when cancelled', (tester) async {
      final summary = buildSampleSummary();
      final theme = ReaderThemes.allThemes.first;
      bool? confirmResult;

      await tester.pumpWidget(
        MaterialApp(
          home: Scaffold(
            body: Builder(
              builder: (context) => ElevatedButton(
                onPressed: () async {
                  confirmResult = await showPendingChangesSheet(
                    context,
                    summary: summary,
                    theme: theme,
                    confirmUpload: true,
                  );
                },
                child: const Text('열기'),
              ),
            ),
          ),
        ),
      );

      await tester.tap(find.text('열기'));
      await tester.pumpAndSettle();
      await tester.tap(find.text('취소'));
      await tester.pumpAndSettle();

      expect(confirmResult, isFalse);
    });
  });
}

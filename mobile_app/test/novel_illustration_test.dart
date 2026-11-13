import 'package:flutter_test/flutter_test.dart';
import 'package:lanovel_reader/models/novel_illustration.dart';
import 'package:lanovel_reader/models/sentence.dart';

void main() {
  group('NovelIllustration model', () {
    test('normalizes TOP/END and preserves regular PIDs', () {
      expect(NovelIllustration.normalizeAfterPid('top'), 'TOP');
      expect(NovelIllustration.normalizeAfterPid(' end '), 'END');
      expect(NovelIllustration.normalizeAfterPid('  '), 'END');
      expect(NovelIllustration.normalizeAfterPid(null), 'END');
      expect(NovelIllustration.normalizeAfterPid('L10'), 'L10');
      expect(NovelIllustration.normalizeAfterPid(' p15 '), 'p15');
    });

    test('resolves fileExtension and cacheFileName from mimeType and updatedAt', () {
      final png = NovelIllustration.fromMap({
        'id': 7,
        'book_name': 'Book',
        'chapter_url': 'https://example.com/1',
        'after_pid': 'L10',
        'file_rel_path': 'b_123/img.bin',
        'mime_type': 'image/png',
        'width': 896,
        'height': 1152,
        'updated_at': 1700000123,
      });
      expect(png.fileExtension, 'png');
      expect(png.cacheFileName, 'illu_7_1700000123.png');
      expect(png.aspectRatio, closeTo(896 / 1152, 0.0001));

      final jpg = NovelIllustration.fromMap({
        'id': 8,
        'book_name': 'Book',
        'chapter_url': 'https://example.com/1',
        'file_rel_path': 'b_123/photo.jpg',
        'mime_type': 'image/jpeg',
        'updated_at': 99,
      });
      expect(jpg.fileExtension, 'jpg');
      expect(jpg.cacheFileName, 'illu_8_99.jpg');
    });
  });

  group('buildReaderFlowItems & paginateReaderFlowItems', () {
    List<Sentence> makeSentences(List<String> pids) {
      return pids
          .map((pid) => Sentence(
                pid: pid,
                original: 'orig $pid',
                translated: 'trans $pid',
                timestamp: 1,
              ))
          .toList();
    }

    NovelIllustration makeIllu(int id, String afterPid, {int sortOrder = 0}) {
      return NovelIllustration(
        id: id,
        bookName: 'Book',
        chapterUrl: 'https://example.com/1',
        chapterTitle: 'Ch1',
        afterPid: afterPid,
        sortOrder: sortOrder,
        fileRelPath: 'b_abc/illu_$id.png',
      );
    }

    test('places TOP, case-insensitive PID, END, and unmatched fallback properly', () {
      final sentences = makeSentences(['L1', 'L5', 'L10', 'L15']);
      final illus = [
        makeIllu(4, 'END'),
        makeIllu(3, 'l10', sortOrder: 2), // lowercase matches L10
        makeIllu(2, 'L10', sortOrder: 1),
        makeIllu(1, 'TOP'),
        makeIllu(5, 'L999'), // unmatched falls back to END
      ];

      final flow = buildReaderFlowItems(sentences, illus);
      final summary = flow.map((it) {
        if (it.isIllustration) return 'IMG:${it.illustration!.id}';
        return 'TXT:${it.sentence!.pid}';
      }).toList();

      expect(summary, [
        'IMG:1',
        'TXT:L1',
        'TXT:L5',
        'TXT:L10',
        'IMG:2',
        'IMG:3',
        'TXT:L15',
        'IMG:4',
        'IMG:5',
      ]);
    });

    test('weights illustrations in pagination and resolves PID page index', () {
      final sentences = makeSentences(['L1', 'L2', 'L3', 'L4', 'L5', 'L6']);
      final illus = [makeIllu(10, 'L2')];
      final flow = buildReaderFlowItems(sentences, illus);

      // maxWeight=5, illuWeight=3
      // Page 0: L1(1), L2(1), IMG10(3) => weight 5 -> full page!
      // Page 1: L3(1), L4(1), L5(1), L6(1) => weight 4
      final pages = paginateReaderFlowItems(flow, 5);
      expect(pages.length, 2);
      expect(pages[0].map((e) => e.isIllustration ? 'IMG' : e.sentence!.pid).toList(), [
        'L1',
        'L2',
        'IMG',
      ]);
      expect(pages[1].map((e) => e.sentence!.pid).toList(), ['L3', 'L4', 'L5', 'L6']);

      expect(findFlowPageForPid(pages, 'l4'), 1);
      expect(findFlowPageForPid(pages, 'L2'), 0);
      expect(firstPidInFlowPage(pages[1]), 'L3');
    });
  });
}

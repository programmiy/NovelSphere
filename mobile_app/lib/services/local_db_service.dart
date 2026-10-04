import 'dart:convert';
import 'dart:io';
import 'package:archive/archive.dart';
import 'package:flutter/foundation.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';
import 'package:sqflite/sqflite.dart';

import '../models/book.dart';
import '../models/chapter.dart';
import '../models/sentence.dart';
import '../models/glossary_rule.dart';
import 'preferences_service.dart';

class LocalDbService {
  static Database? _database;

  static Future<Database> get database async {
    if (_database != null) return _database!;
    _database = await _initDatabase();
    return _database!;
  }

  static Future<String> getDbPath() async {
    final docsDir = await getApplicationDocumentsDirectory();
    return p.join(docsDir.path, 'lanovel_local.db');
  }

  /// 모바일 로컬 DB 완전 초기화 (망가진 DB 파일 삭제 및 새로 구축)
  static Future<void> resetDatabase() async {
    try {
      if (_database != null) {
        await _database!.close();
        _database = null;
      }
      final path = await getDbPath();
      final file = File(path);
      if (await file.exists()) {
        await file.delete();
      }
      final walFile = File('$path-wal');
      if (await walFile.exists()) await walFile.delete();
      final shmFile = File('$path-shm');
      if (await shmFile.exists()) await shmFile.delete();

      // DB 재오픈 및 기본 테이블 재생성
      _database = await _initDatabase();
      await PreferencesService.setLastSyncedTimestamp(0);
      debugPrint('[LocalDbService] 로컬 DB 완전 초기화 완료 (동기화 기준 시점 0으로 초기화)');
    } catch (e) {
      debugPrint('[LocalDbService] DB 초기화 실패: $e');
      rethrow;
    }
  }

  static Future<Database> _initDatabase() async {
    final path = await getDbPath();

    return await openDatabase(
      path,
      version: 1,
      onCreate: (db, version) async {
        await db.execute('''
          CREATE TABLE IF NOT EXISTS books (
            folder_name TEXT PRIMARY KEY,
            total_chapters INTEGER DEFAULT 0,
            last_read_chapter_title TEXT,
            last_read_pid TEXT,
            last_read_timestamp INTEGER,
            is_completed INTEGER DEFAULT 0,
            is_visible INTEGER DEFAULT 1,
            is_bookmarked INTEGER DEFAULT 0,
            is_pinned INTEGER DEFAULT 0,
            notes TEXT,
            summary TEXT,
            tags TEXT
          );
        ''');

        await db.execute('''
          CREATE TABLE IF NOT EXISTS chapters (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            book_name TEXT NOT NULL,
            title TEXT NOT NULL,
            url TEXT NOT NULL,
            sort_order INTEGER DEFAULT 0,
            sentence_count INTEGER DEFAULT 0,
            compressed_content BLOB NOT NULL
          );
        ''');

        await db.execute('CREATE INDEX IF NOT EXISTS ix_m_chap_book ON chapters(book_name);');
        await db.execute('CREATE INDEX IF NOT EXISTS ix_m_chap_book_sort ON chapters(book_name, sort_order);');

        await db.execute('''
          CREATE TABLE IF NOT EXISTS reading_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            date TEXT NOT NULL,
            read_seconds INTEGER DEFAULT 0,
            pages_count INTEGER DEFAULT 0,
            book_title TEXT,
            chapter_title TEXT,
            created_at INTEGER
          );
        ''');
        await db.execute('CREATE INDEX IF NOT EXISTS ix_m_logs_date ON reading_logs(date);');

        await db.execute('''
          CREATE TABLE IF NOT EXISTS local_glossary (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_scope TEXT DEFAULT '__all__',
            find_text TEXT NOT NULL,
            replace_text TEXT NOT NULL,
            use_regex INTEGER DEFAULT 0,
            case_sensitive INTEGER DEFAULT 0,
            applied_at INTEGER
          );
        ''');

        await db.execute('''
          CREATE TABLE IF NOT EXISTS offline_change_queue (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            change_type TEXT NOT NULL,
            target_id TEXT,
            payload_json TEXT NOT NULL,
            created_at INTEGER NOT NULL
          );
        ''');
      },
    );
  }

  // --- 서재 (Books) 무결성 보장 및 자가 치유 ---
  /// [서재 무결성 보장] chapters 테이블에 저장된 실제 소설들을 확인하여,
  /// books 테이블에 누락된 소설이 있다면 즉시 자동 등록하고 챕터 수 및 표시 상태를 동기화
  static Future<void> ensureBooksIntegrity() async {
    final db = await database;

    // 1. chapters 테이블의 고유 책 이름 및 실제 챕터 수 집계
    final chapterBookRows = await db.rawQuery('''
      SELECT book_name, COUNT(*) as cnt
      FROM chapters
      WHERE book_name IS NOT NULL AND book_name != ''
      GROUP BY book_name
    ''');

    if (chapterBookRows.isEmpty) return;

    final batch = db.batch();

    // 2. 누락된 책들을 books 테이블에 자동 삽입하고 챕터 수 및 노출 상태 보정
    for (final row in chapterBookRows) {
      final bookName = (row['book_name'] as String).trim();
      if (bookName.isEmpty) continue;
      final cnt = (row['cnt'] as num?)?.toInt() ?? 0;

      batch.rawInsert('''
        INSERT OR IGNORE INTO books (folder_name, total_chapters, is_visible)
        VALUES (?, ?, 1)
      ''', [bookName, cnt]);

      batch.rawUpdate('''
        UPDATE books 
        SET total_chapters = ?,
            is_visible = CASE WHEN is_visible IS NULL THEN 1 ELSE is_visible END
        WHERE folder_name = ?
      ''', [cnt, bookName]);
    }

    // 3. 혹시 NULL로 남아있는 is_visible 컬럼 일괄 보정
    batch.rawUpdate('UPDATE books SET is_visible = 1 WHERE is_visible IS NULL');

    await batch.commit(noResult: true);
  }

  // --- 서재 (Books) 쿼리 ---
  static Future<List<Book>> getBooks({
    String filter = 'all', // all, pinned, reading, unread, completed, hidden
    String? tag,
    String? query,
    String sort = 'recent', // recent, pinned, name, chapters
    bool syncIntegrity = true,
  }) async {
    final db = await database;

    // 조회 전 chapters 테이블 기반으로 books 테이블 자동 무결성 동기화
    if (syncIntegrity) {
      try {
        await ensureBooksIntegrity();
      } catch (e) {
        debugPrint('[LocalDbService] ensureBooksIntegrity 경고: $e');
      }
    }

    List<String> whereClauses = [];
    List<dynamic> whereArgs = [];

    // 숨김 필터 (COALESCE로 NULL 안전 보장)
    if (filter == 'hidden') {
      whereClauses.add('COALESCE(is_visible, 1) = 0');
    } else {
      whereClauses.add('COALESCE(is_visible, 1) = 1');
      if (filter == 'pinned') {
        whereClauses.add('COALESCE(is_pinned, 0) = 1');
      } else if (filter == 'reading') {
        whereClauses.add('COALESCE(last_read_timestamp, 0) > 0 AND COALESCE(is_completed, 0) = 0');
      } else if (filter == 'unread') {
        whereClauses.add('COALESCE(last_read_timestamp, 0) = 0');
      } else if (filter == 'completed') {
        whereClauses.add('COALESCE(is_completed, 0) = 1');
      }
    }

    if (query != null && query.trim().isNotEmpty) {
      whereClauses.add('folder_name LIKE ?');
      whereArgs.add('%${query.trim()}%');
    }

    String whereSql = whereClauses.isNotEmpty ? 'WHERE ${whereClauses.join(' AND ')}' : '';
    
    String orderSql;
    switch (sort) {
      case 'pinned':
        orderSql = 'ORDER BY COALESCE(is_pinned, 0) DESC, folder_name ASC';
        break;
      case 'name':
        orderSql = 'ORDER BY folder_name ASC';
        break;
      case 'chapters':
        orderSql = 'ORDER BY COALESCE(total_chapters, 0) DESC';
        break;
      case 'recent':
      default:
        orderSql = 'ORDER BY COALESCE(is_pinned, 0) DESC, COALESCE(last_read_timestamp, 0) DESC, folder_name ASC';
        break;
    }

    final rows = await db.rawQuery('SELECT * FROM books $whereSql $orderSql', whereArgs);
    List<Book> books = rows.map((r) => Book.fromMap(r)).toList();

    if (tag != null && tag.isNotEmpty) {
      books = books.where((b) => b.tags.contains(tag)).toList();
    }

    return books;
  }

  static Future<Book?> getBook(String folderName) async {
    final db = await database;
    final rows = await db.query(
      'books',
      where: 'folder_name = ?',
      whereArgs: [folderName],
      limit: 1,
    );
    if (rows.isEmpty) return null;
    return Book.fromMap(rows.first);
  }

  static Future<void> togglePinBook(String folderName, bool currentPin) async {
    final db = await database;
    final newPin = !currentPin;
    await db.update(
      'books',
      {'is_pinned': newPin ? 1 : 0},
      where: 'folder_name = ?',
      whereArgs: [folderName],
    );
    await _enqueueChange('pin', folderName, {'folder_name': folderName, 'is_pinned': newPin});
  }

  static Future<void> toggleBookmarkBook(String folderName, bool currentBookmark) async {
    final db = await database;
    final newBookmark = !currentBookmark;
    await db.update(
      'books',
      {'is_bookmarked': newBookmark ? 1 : 0},
      where: 'folder_name = ?',
      whereArgs: [folderName],
    );
    await _enqueueChange('activity', folderName, {'folderName': folderName, 'is_bookmarked': newBookmark ? 1 : 0});
  }

  // --- 챕터 (Chapters) 쿼리 및 압축 해제 엔진 ---
  /// [자가 치유] 과거 동기화나 제목 파편화로 인해 동일 URL을 공유하면서 분리된 챕터들을 하나로 자동 병합
  static Future<int> healDuplicateChapters([String? specificBookName]) async {
    final db = await database;
    String whereClause = "WHERE url IS NOT NULL AND url != ''";
    List<dynamic> whereArgs = [];
    if (specificBookName != null) {
      whereClause += " AND book_name = ?";
      whereArgs.add(specificBookName);
    }

    final dupGroups = await db.rawQuery('''
      SELECT book_name, url, COUNT(*) as cnt
      FROM chapters
      $whereClause
      GROUP BY book_name, url
      HAVING cnt > 1
    ''', whereArgs);

    if (dupGroups.isEmpty) return 0;

    int healedCount = 0;
    for (var group in dupGroups) {
      final bName = group['book_name'] as String;
      final cUrl = group['url'] as String;

      final rows = await db.query(
        'chapters',
        where: 'book_name = ? AND url = ?',
        whereArgs: [bName, cUrl],
        orderBy: 'id ASC',
      );

      if (rows.length < 2) continue;

      Map<String, Sentence> mergedSentences = {};
      String canonicalTitle = rows.first['title'] as String;
      int sortOrder = rows.first['sort_order'] as int? ?? 0;
      int keeperId = rows.first['id'] as int;

      for (var r in rows) {
        final t = (r['title'] as String? ?? '').trim();
        if (t.isNotEmpty) {
          final isTDirty = t.contains('- カクヨム') || t.contains('- 小説家になろう');
          final isCanonDirty = canonicalTitle.contains('- カクヨム') || canonicalTitle.contains('- 小説家になろう');
          if (!isTDirty && (isCanonDirty || t.length < canonicalTitle.length)) {
            canonicalTitle = t;
            sortOrder = r['sort_order'] as int? ?? sortOrder;
          }
        }

        final blob = r['compressed_content'] as Uint8List?;
        if (blob == null) continue;
        try {
          final decompressed = const ZLibDecoder().decodeBytes(blob);
          final jsonStr = utf8.decode(decompressed);
          final List<dynamic> list = jsonDecode(jsonStr);
          for (var item in list) {
            final s = Sentence.fromJson(item as Map<String, dynamic>);
            final key = s.pid ?? '${s.id}';
            mergedSentences[key] = s;
          }
        } catch (_) {}
      }

      final sortedList = mergedSentences.values.toList();
      sortedList.sort((a, b) {
        final pA = a.pid ?? '';
        final pB = b.pid ?? '';
        final numA = int.tryParse(pA.replaceAll(RegExp(r'[^0-9]'), '')) ?? 999999;
        final numB = int.tryParse(pB.replaceAll(RegExp(r'[^0-9]'), '')) ?? 999999;
        return numA.compareTo(numB);
      });

      final rawJson = jsonEncode(sortedList.map((s) => s.toJson()).toList());
      final reCompressed = const ZLibEncoder().encode(utf8.encode(rawJson));

      await db.update(
        'chapters',
        {
          'title': canonicalTitle,
          'sort_order': sortOrder,
          'sentence_count': sortedList.length,
          'compressed_content': reCompressed,
        },
        where: 'id = ?',
        whereArgs: [keeperId],
      );

      final idsToDelete = rows.map((r) => r['id'] as int).where((id) => id != keeperId).toList();
      if (idsToDelete.isNotEmpty) {
        await db.delete(
          'chapters',
          where: 'id IN (${idsToDelete.map((_) => '?').join(',')})',
          whereArgs: idsToDelete,
        );
      }

      final countRow = await db.rawQuery('SELECT COUNT(*) as cnt FROM chapters WHERE book_name = ?', [bName]);
      final totalChaps = (countRow.first['cnt'] as num?)?.toInt() ?? 0;
      await db.rawInsert('''
        INSERT OR IGNORE INTO books (folder_name, total_chapters, is_visible)
        VALUES (?, ?, 1)
      ''', [bName, totalChaps]);
      await db.update('books', {'total_chapters': totalChaps}, where: 'folder_name = ?', whereArgs: [bName]);

      healedCount++;
    }

    return healedCount;
  }

  static Future<List<Chapter>> getChapters(String bookName) async {
    final db = await database;
    // URL 중복 회차가 있다면 1회 자동 자가 치유 수행
    await healDuplicateChapters(bookName);

    final rows = await db.query(
      'chapters',
      columns: ['id', 'book_name', 'title', 'url', 'sort_order', 'sentence_count'],
      where: 'book_name = ?',
      whereArgs: [bookName],
      orderBy: 'sort_order ASC, id ASC',
    );
    return rows.map((r) => Chapter.fromMap(r, includeBlob: false)).toList();
  }

  /// [핵심] 챕터의 zlib 압축 BLOB을 1ms 만에 메모리에서 압축 해제하여 문장 리스트로 복원
  static Future<List<Sentence>> loadChapterSentences(int chapterId) async {
    final db = await database;
    final rows = await db.query(
      'chapters',
      columns: ['compressed_content'],
      where: 'id = ?',
      whereArgs: [chapterId],
      limit: 1,
    );

    if (rows.isEmpty || rows.first['compressed_content'] == null) {
      return [];
    }

    final compressedBytes = rows.first['compressed_content'] as Uint8List;
    try {
      // 1. Zlib Decompress
      final decompressedBytes = const ZLibDecoder().decodeBytes(compressedBytes);
      // 2. UTF-8 decode & JSON parse
      final jsonString = utf8.decode(decompressedBytes);
      final List<dynamic> parsedList = jsonDecode(jsonString);

      return parsedList.map((item) => Sentence.fromJson(item as Map<String, dynamic>)).toList();
    } catch (e) {
      if (kDebugMode) {
        debugPrint('Error decompressing chapter sentences: $e');
      }
      return [];
    }
  }

  /// [핵심] 뷰어에서 번역문 수정 시 해당 챕터 BLOB을 즉시 재압축 저장하고 오프라인 동기화 큐에 적재
  static Future<void> updateSentence(int chapterId, Sentence updatedSentence, List<Sentence> allChapterSentences) async {
    final db = await database;

    // 1. 메모리 상의 문장 리스트 갱신
    final index = allChapterSentences.indexWhere((s) => (s.id != null && s.id == updatedSentence.id) || (s.pid != null && s.pid == updatedSentence.pid));
    if (index != -1) {
      allChapterSentences[index] = updatedSentence;
    }

    // 2. JSON 직렬화 & Zlib Re-compress
    final rawJson = jsonEncode(allChapterSentences.map((s) => s.toJson()).toList());
    final rawBytes = utf8.encode(rawJson);
    final compressedBytes = const ZLibEncoder().encode(rawBytes);

    // 3. 로컬 SQLite DB 업데이트
    await db.update(
      'chapters',
      {'compressed_content': compressedBytes},
      where: 'id = ?',
      whereArgs: [chapterId],
    );

    // 4. 오프라인 동기화 큐에 등록 (PC 연결 시 자동 업로드)
    await _enqueueChange('translation_edit', '${updatedSentence.id ?? updatedSentence.pid}', {
      'id': updatedSentence.id,
      'pid': updatedSentence.pid,
      'original': updatedSentence.original,
      'translated': updatedSentence.translated,
      'timestamp': DateTime.now().millisecondsSinceEpoch ~/ 1000,
    });
  }

  /// [유사 번역 연동] 임의의 소설 및 챕터 컨텍스트에서 단락 번역문을 찾아 수정하고 로컬 DB 및 동기화 큐에 반영
  static Future<bool> updateSentenceByContext({
    required String bookName,
    required String chapterTitle,
    required String original,
    required String newTranslated,
    String? pid,
    int? sentenceId,
  }) async {
    final db = await database;

    // 1. 해당 챕터 레코드 조회
    final rows = await db.query(
      'chapters',
      where: 'book_name = ? AND title = ?',
      whereArgs: [bookName, chapterTitle],
      limit: 1,
    );

    if (rows.isEmpty) return false;

    final chapRow = rows.first;
    final chapId = chapRow['id'] as int;
    final blob = chapRow['compressed_content'] as Uint8List?;
    if (blob == null) return false;

    try {
      final decompressed = const ZLibDecoder().decodeBytes(blob);
      final jsonStr = utf8.decode(decompressed);
      final List<dynamic> list = jsonDecode(jsonStr);
      final sentences = list.map((item) => Sentence.fromJson(item as Map<String, dynamic>)).toList();

      final index = sentences.indexWhere((s) {
        if (sentenceId != null && s.id == sentenceId) return true;
        if (pid != null && pid.isNotEmpty && s.pid == pid) return true;
        return s.original == original;
      });

      if (index == -1) return false;

      final target = sentences[index];
      target.translated = newTranslated;

      await updateSentence(chapId, target, sentences);
      return true;
    } catch (_) {
      return false;
    }
  }

  /// 독서 진도 저장
  static Future<void> updateReadingProgress({
    required String bookName,
    required String chapterTitle,
    String? pid,
    bool isCompleted = false,
  }) async {
    final db = await database;
    final nowTs = DateTime.now().millisecondsSinceEpoch ~/ 1000;

    await db.update(
      'books',
      {
        'last_read_chapter_title': chapterTitle,
        'last_read_pid': pid,
        'last_read_timestamp': nowTs,
        'is_completed': isCompleted ? 1 : 0,
      },
      where: 'folder_name = ?',
      whereArgs: [bookName],
    );

    await _enqueueChange('activity', bookName, {
      'folderName': bookName,
      'last_read_chapter_title': chapterTitle,
      'last_read_pid': pid,
      'last_read_timestamp': nowTs,
      'is_completed': isCompleted ? 1 : 0,
    });
  }

  // --- 독서 기록 & 히트맵 (잔디 심기) ---
  static Future<void> recordReadingTime({
    required String date, // YYYY-MM-DD
    required int additionalSeconds,
    required int additionalPages,
    String? bookTitle,
    String? chapterTitle,
  }) async {
    final db = await database;
    final nowTs = DateTime.now().millisecondsSinceEpoch ~/ 1000;

    final existing = await db.query(
      'reading_logs',
      where: 'date = ? AND book_title = ?',
      whereArgs: [date, bookTitle ?? ''],
      limit: 1,
    );

    if (existing.isNotEmpty) {
      final currentSec = existing.first['read_seconds'] as int? ?? 0;
      final currentPages = existing.first['pages_count'] as int? ?? 0;
      await db.update(
        'reading_logs',
        {
          'read_seconds': currentSec + additionalSeconds,
          'pages_count': currentPages + additionalPages,
          'chapter_title': chapterTitle,
        },
        where: 'id = ?',
        whereArgs: [existing.first['id']],
      );
    } else {
      await db.insert('reading_logs', {
        'date': date,
        'read_seconds': additionalSeconds,
        'pages_count': additionalPages,
        'book_title': bookTitle,
        'chapter_title': chapterTitle,
        'created_at': nowTs,
      });
    }
  }

  static Future<Map<String, int>> getReadingHeatmap({int days = 90}) async {
    final db = await database;
    final rows = await db.rawQuery('''
      SELECT date, SUM(pages_count) as total_pages, SUM(read_seconds) as total_sec
      FROM reading_logs
      GROUP BY date
      ORDER BY date DESC
      LIMIT ?
    ''', [days]);

    Map<String, int> heatmap = {};
    for (var r in rows) {
      final d = r['date'] as String;
      final p = (r['total_pages'] as num?)?.toInt() ?? 0;
      heatmap[d] = p;
    }
    return heatmap;
  }

  // --- PC 관리자 페이지와 동일한 오프라인 '전체 찾아바꾸기' 엔진 ---
  static Future<int> applyGlossaryRule(GlossaryRule rule) async {
    final db = await database;
    int totalReplacedCount = 0;

    List<Map<String, dynamic>> targetChapters;
    if (rule.folderScope == '__all__') {
      targetChapters = await db.query('chapters', columns: ['id', 'compressed_content']);
    } else {
      targetChapters = await db.query(
        'chapters',
        columns: ['id', 'compressed_content'],
        where: 'book_name = ?',
        whereArgs: [rule.folderScope],
      );
    }

    RegExp? regExp;
    if (rule.useRegex) {
      regExp = RegExp(rule.findText, caseSensitive: rule.caseSensitive);
    }

    for (var chap in targetChapters) {
      final chapId = chap['id'] as int;
      final compressedBytes = chap['compressed_content'] as Uint8List?;
      if (compressedBytes == null) continue;

      try {
        final decompressed = const ZLibDecoder().decodeBytes(compressedBytes);
        final jsonStr = utf8.decode(decompressed);
        final List<dynamic> list = jsonDecode(jsonStr);

        bool chapterModified = false;
        for (var item in list) {
          final translated = item['translated'] as String? ?? '';
          String replaced;
          if (rule.useRegex) {
            replaced = translated.replaceAll(regExp!, rule.replaceText);
          } else {
            if (rule.caseSensitive) {
              replaced = translated.replaceAll(rule.findText, rule.replaceText);
            } else {
              replaced = translated.replaceAll(RegExp(RegExp.escape(rule.findText), caseSensitive: false), rule.replaceText);
            }
          }

          if (replaced != translated) {
            item['translated'] = replaced;
            chapterModified = true;
            totalReplacedCount++;
          }
        }

        if (chapterModified) {
          final reEncoded = const ZLibEncoder().encode(utf8.encode(jsonEncode(list)));
          await db.update(
            'chapters',
            {'compressed_content': reEncoded},
            where: 'id = ?',
            whereArgs: [chapId],
          );
        }
      } catch (e) {
        if (kDebugMode) {
          debugPrint('Error applying rule on chapter $chapId: $e');
        }
      }
    }

    // 룰 저장 & 동기화 큐 등록
    await db.insert('local_glossary', rule.toMap());
    await _enqueueChange('glossary_rule', '${rule.findText}->${rule.replaceText}', rule.toMap());

    return totalReplacedCount;
  }

  // --- 동기화 큐 관리 ---
  static Future<void> _enqueueChange(String changeType, String? targetId, Map<String, dynamic> payload) async {
    final db = await database;
    await db.insert('offline_change_queue', {
      'change_type': changeType,
      'target_id': targetId,
      'payload_json': jsonEncode(payload),
      'created_at': DateTime.now().millisecondsSinceEpoch ~/ 1000,
    });
  }

  static Future<List<Map<String, dynamic>>> getPendingChanges() async {
    final db = await database;
    return await db.query('offline_change_queue', orderBy: 'id ASC');
  }

  static Future<void> clearPendingChanges(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await database;
    await db.delete(
      'offline_change_queue',
      where: 'id IN (${ids.map((_) => '?').join(',')})',
      whereArgs: ids,
    );
  }

  // --- 유사 번역 용례 검색 (Similar Translations Explorer) ---
  /// 키워드를 기반으로 로컬 DB 챕터들의 압축 문장을 역색인/순회하여 유사 번역 사례들을 고속 반환
  static Future<List<Map<String, dynamic>>> searchSimilarTranslations({
    required String keyword,
    String? currentBookName,
    int limit = 10,
  }) async {
    final kw = keyword.trim();
    if (kw.isEmpty) return [];

    final db = await database;
    List<Map<String, dynamic>> results = [];
    Set<String> seenTexts = {};

    // 1. 현재 소설의 챕터들을 우선 조회 (최신 순)
    List<Map<String, dynamic>> targetChapters = [];
    if (currentBookName != null && currentBookName.isNotEmpty) {
      targetChapters = await db.query(
        'chapters',
        columns: ['id', 'book_name', 'title', 'compressed_content'],
        where: 'book_name = ?',
        whereArgs: [currentBookName],
        orderBy: 'sort_order DESC',
        limit: 50,
      );
    }

    // 2. 다른 소설의 챕터들도 후보로 확보
    final otherChapters = await db.query(
      'chapters',
      columns: ['id', 'book_name', 'title', 'compressed_content'],
      where: currentBookName != null && currentBookName.isNotEmpty ? 'book_name != ?' : null,
      whereArgs: currentBookName != null && currentBookName.isNotEmpty ? [currentBookName] : null,
      orderBy: 'id DESC',
      limit: 30,
    );

    final allChapters = [...targetChapters, ...otherChapters];

    for (final row in allChapters) {
      if (results.length >= limit) break;

      final blob = row['compressed_content'] as Uint8List?;
      if (blob == null) continue;

      try {
        final decompressed = const ZLibDecoder().decodeBytes(blob);
        final jsonStr = utf8.decode(decompressed);
        final List<dynamic> list = jsonDecode(jsonStr);

        for (final item in list) {
          final s = Sentence.fromJson(item as Map<String, dynamic>);
          final orig = s.original;
          final trans = s.translated;

          if (trans.trim().isEmpty) continue;

          // 원문 또는 번역문에 키워드가 포함되어 있는지 확인
          if (orig.contains(kw) || trans.contains(kw)) {
            final dedupeKey = '$orig||$trans';
            if (seenTexts.contains(dedupeKey)) continue;
            seenTexts.add(dedupeKey);

            results.add({
              'id': s.id,
              'pid': s.pid,
              'original': orig,
              'translated': trans,
              'book_name': row['book_name'] as String? ?? '',
              'title': row['title'] as String? ?? '',
            });

            if (results.length >= limit) break;
          }
        }
      } catch (_) {}
    }

    return results;
  }
}


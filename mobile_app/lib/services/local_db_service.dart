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
import '../models/sentence_highlight.dart';
import '../models/novel_illustration.dart';
import '../models/glossary_rule.dart';
import '../models/find_replace_item.dart';
import 'text_diff_helper.dart';
import 'preferences_service.dart';

class LocalDbService {
  static Database? _database;
  static final ValueNotifier<int> pendingCountNotifier = ValueNotifier<int>(0);

  static Future<Database> get database async {
    if (_database != null && _database!.isOpen) return _database!;
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
      await _refreshPendingCountNotifier(_database!);
      debugPrint('[LocalDbService] 로컬 DB 완전 초기화 완료 (동기화 기준 시점 0으로 초기화)');
    } catch (e) {
      debugPrint('[LocalDbService] DB 초기화 실패: $e');
      rethrow;
    }
  }

  /// [P0 안전 시드 DB 원자적 교체 엔진]
  /// 1) 기존 로컬 DB에서 미전송 큐, 독서 잔디(reading_logs), 용어집(local_glossary), 상단고정(is_pinned) 메모리 백업
  /// 2) DB 정상 close 및 _database = null 초기화
  /// 3) .db, -wal, -shm 안전 일괄 정리 후 tempSeed 파일 원자적 rename
  /// 4) 새 DB 오픈 및 백업 데이터 무결성 복원
  /// 5) 중복 챕터 자가 치유(healDuplicateChapters) 실행
  static Future<void> replaceSeedDatabase(File tempSeedFile) async {
    List<Map<String, dynamic>> backupQueue = [];
    List<Map<String, dynamic>> backupLogs = [];
    List<Map<String, dynamic>> backupGlossary = [];
    List<Map<String, dynamic>> backupHighlights = [];
    List<String> backupPinned = [];

    try {
      if (_database != null && _database!.isOpen) {
        try {
          backupQueue = await _database!.query('offline_change_queue');
        } catch (_) {}
        try {
          backupLogs = await _database!.query('reading_logs');
        } catch (_) {}
        try {
          backupGlossary = await _database!.query('local_glossary');
        } catch (_) {}
        try {
          backupHighlights = await _database!.query('sentence_highlights');
        } catch (_) {}
        try {
          final pinnedRows = await _database!.query('books', columns: ['folder_name'], where: 'is_pinned = 1');
          backupPinned = pinnedRows.map((r) => r['folder_name'] as String).toList();
        } catch (_) {}

        await _database!.close();
      }
    } catch (e) {
      debugPrint('[LocalDbService] 시드 교체 전 백업 경고: $e');
    } finally {
      _database = null;
    }

    final path = await getDbPath();
    final dbFile = File(path);
    final walFile = File('$path-wal');
    final shmFile = File('$path-shm');

    if (await walFile.exists()) await walFile.delete();
    if (await shmFile.exists()) await shmFile.delete();
    if (await dbFile.exists()) await dbFile.delete();

    await tempSeedFile.rename(path);

    // 새 DB 오픈
    final newDb = await _initDatabase();
    _database = newDb;

    // 백업 데이터 복원
    final batch = newDb.batch();
    for (var q in backupQueue) {
      final map = Map<String, dynamic>.from(q)..remove('id');
      batch.insert('offline_change_queue', map);
    }
    for (var l in backupLogs) {
      final map = Map<String, dynamic>.from(l)..remove('id');
      batch.insert('reading_logs', map);
    }
    for (var g in backupGlossary) {
      final map = Map<String, dynamic>.from(g)..remove('id');
      batch.insert('local_glossary', map);
    }
    for (var h in backupHighlights) {
      final map = Map<String, dynamic>.from(h)..remove('id');
      batch.insert('sentence_highlights', map, conflictAlgorithm: ConflictAlgorithm.replace);
    }
    for (var pFolder in backupPinned) {
      batch.update('books', {'is_pinned': 1}, where: 'folder_name = ?', whereArgs: [pFolder]);
    }
    await batch.commit(noResult: true);

    await healDuplicateChapters();
    await _refreshPendingCountNotifier(_database!);
    debugPrint('[LocalDbService] replaceSeedDatabase 성공: 무결성 유지 완료');
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

        await db.execute('''
          CREATE TABLE IF NOT EXISTS novel_illustrations (
            id INTEGER PRIMARY KEY,
            book_name TEXT NOT NULL,
            chapter_url TEXT NOT NULL,
            chapter_title TEXT NOT NULL DEFAULT '',
            after_pid TEXT NOT NULL DEFAULT 'END',
            sort_order INTEGER NOT NULL DEFAULT 0,
            caption TEXT NOT NULL DEFAULT '',
            file_rel_path TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'image/png',
            width INTEGER,
            height INTEGER,
            file_size INTEGER NOT NULL DEFAULT 0,
            created_at INTEGER NOT NULL DEFAULT 0,
            updated_at INTEGER NOT NULL DEFAULT 0
          );
        ''');
        await db.execute('CREATE INDEX IF NOT EXISTS ix_m_illu_book_url ON novel_illustrations(book_name, chapter_url);');
      },
      onOpen: (db) async {
        try {
          await db.execute('ALTER TABLE local_glossary ADD COLUMN condition_text TEXT;');
        } catch (_) {}
        try {
          await db.execute('ALTER TABLE local_glossary ADD COLUMN replaced_count INTEGER DEFAULT 0;');
        } catch (_) {}
        try {
          await db.execute('ALTER TABLE local_glossary ADD COLUMN is_favorite INTEGER DEFAULT 0;');
        } catch (_) {}
        try {
          await db.execute('''
            CREATE TABLE IF NOT EXISTS sentence_highlights (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              book_name TEXT NOT NULL,
              chapter_title TEXT NOT NULL,
              url TEXT NOT NULL,
              pid TEXT NOT NULL,
              original TEXT NOT NULL,
              translated TEXT NOT NULL,
              note TEXT,
              created_at INTEGER NOT NULL,
              updated_at INTEGER,
              is_resolved INTEGER NOT NULL DEFAULT 0,
              UNIQUE(url, pid)
            );
          ''');
          await db.execute('CREATE INDEX IF NOT EXISTS ix_sh_book_res ON sentence_highlights(book_name, is_resolved);');
          await db.execute('CREATE INDEX IF NOT EXISTS ix_sh_url_pid ON sentence_highlights(url, pid);');
        } catch (_) {}
        try {
          await db.execute('''
            CREATE TABLE IF NOT EXISTS novel_illustrations (
              id INTEGER PRIMARY KEY,
              book_name TEXT NOT NULL,
              chapter_url TEXT NOT NULL,
              chapter_title TEXT NOT NULL DEFAULT '',
              after_pid TEXT NOT NULL DEFAULT 'END',
              sort_order INTEGER NOT NULL DEFAULT 0,
              caption TEXT NOT NULL DEFAULT '',
              file_rel_path TEXT NOT NULL,
              mime_type TEXT NOT NULL DEFAULT 'image/png',
              width INTEGER,
              height INTEGER,
              file_size INTEGER NOT NULL DEFAULT 0,
              created_at INTEGER NOT NULL DEFAULT 0,
              updated_at INTEGER NOT NULL DEFAULT 0
            );
          ''');
          await db.execute('CREATE INDEX IF NOT EXISTS ix_m_illu_book_url ON novel_illustrations(book_name, chapter_url);');
        } catch (_) {}
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
    final book = await getBook(folderName);
    await _enqueueChange('activity', folderName, {
      'folderName': folderName,
      'is_bookmarked': newBookmark ? 1 : 0,
      'is_completed': (book?.isCompleted ?? false) ? 1 : 0,
      'is_visible': (book?.isVisible ?? true) ? 1 : 0,
      'last_read_timestamp': book?.lastReadTimestamp,
      'last_read_pid': book?.lastReadPid,
      'last_read_chapter_title': book?.lastReadChapterTitle,
      'change_reasons': ['bookmark'],
    });
  }

  static Future<void> toggleCompleteBook(String folderName, bool currentComplete) async {
    final db = await database;
    final newComplete = !currentComplete;
    await db.update(
      'books',
      {'is_completed': newComplete ? 1 : 0},
      where: 'folder_name = ?',
      whereArgs: [folderName],
    );
    final book = await getBook(folderName);
    await _enqueueChange('activity', folderName, {
      'folderName': folderName,
      'is_completed': newComplete ? 1 : 0,
      'is_bookmarked': (book?.isBookmarked ?? false) ? 1 : 0,
      'is_visible': (book?.isVisible ?? true) ? 1 : 0,
      'last_read_timestamp': book?.lastReadTimestamp,
      'last_read_pid': book?.lastReadPid,
      'last_read_chapter_title': book?.lastReadChapterTitle,
      'change_reasons': ['complete'],
    });
  }

  static Future<void> toggleVisibilityBook(String folderName, bool currentVisible) async {
    final db = await database;
    final newVisible = !currentVisible;
    await db.update(
      'books',
      {'is_visible': newVisible ? 1 : 0},
      where: 'folder_name = ?',
      whereArgs: [folderName],
    );
    final book = await getBook(folderName);
    await _enqueueChange('activity', folderName, {
      'folderName': folderName,
      'is_visible': newVisible ? 1 : 0,
      'is_completed': (book?.isCompleted ?? false) ? 1 : 0,
      'is_bookmarked': (book?.isBookmarked ?? false) ? 1 : 0,
      'last_read_timestamp': book?.lastReadTimestamp,
      'last_read_pid': book?.lastReadPid,
      'last_read_chapter_title': book?.lastReadChapterTitle,
      'change_reasons': ['visibility'],
    });
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

  /// [데이터 무결성 방어용] 모바일 로컬 DB에 적재된 총 번역 문단(문장) 수 집계
  static Future<int> getTotalSentenceCount() async {
    final db = await database;
    final rows = await db.rawQuery('SELECT COALESCE(SUM(sentence_count), 0) as total FROM chapters');
    if (rows.isEmpty) return 0;
    return (rows.first['total'] as num?)?.toInt() ?? 0;
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

    // 0. 기존 DB에서 변경 전 번역문(before_translated) 및 챕터 메타데이터 선조회
    String chapBookName = '';
    String chapTitle = '';
    String chapUrl = '';
    String? beforeTranslated;
    try {
      final chapRows = await db.query(
        'chapters',
        columns: ['book_name', 'title', 'url', 'compressed_content'],
        where: 'id = ?',
        whereArgs: [chapterId],
        limit: 1,
      );
      if (chapRows.isNotEmpty) {
        chapBookName = (chapRows.first['book_name'] as String? ?? '').trim();
        chapTitle = (chapRows.first['title'] as String? ?? '').trim();
        chapUrl = (chapRows.first['url'] as String? ?? '').trim();
        final blob = chapRows.first['compressed_content'] as Uint8List?;
        if (blob != null) {
          final prevJson = utf8.decode(const ZLibDecoder().decodeBytes(blob));
          final prevList = jsonDecode(prevJson) as List<dynamic>;
          for (final raw in prevList) {
            if (raw is Map) {
              final matchId = updatedSentence.id != null && raw['id'] == updatedSentence.id;
              final matchPid = updatedSentence.pid != null &&
                  updatedSentence.pid!.isNotEmpty &&
                  raw['pid'] == updatedSentence.pid;
              if (matchId || matchPid) {
                beforeTranslated = raw['translated']?.toString();
                break;
              }
            }
          }
        }
      }
    } catch (_) {}

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
    final sentenceKey = '${updatedSentence.pid ?? updatedSentence.id}';
    final targetId = chapUrl.isNotEmpty ? '$chapUrl#$sentenceKey' : sentenceKey;
    await _enqueueChange('translation_edit', targetId, {
      'id': updatedSentence.id,
      'pid': updatedSentence.pid,
      'original': updatedSentence.original,
      'translated': updatedSentence.translated,
      if (beforeTranslated != null) 'before_translated': beforeTranslated,
      if (chapBookName.isNotEmpty) 'folderName': chapBookName,
      if (chapTitle.isNotEmpty) 'title': chapTitle,
      if (chapUrl.isNotEmpty) 'url': chapUrl,
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

    final currentBook = await getBook(bookName);
    await _enqueueChange('activity', bookName, {
      'folderName': bookName,
      'last_read_chapter_title': chapterTitle,
      'last_read_pid': pid,
      'last_read_timestamp': nowTs,
      'is_completed': isCompleted ? 1 : 0,
      'is_bookmarked': (currentBook?.isBookmarked ?? false) ? 1 : 0,
      'is_visible': (currentBook?.isVisible ?? true) ? 1 : 0,
      'change_reasons': ['reading_progress'],
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
      try {
        regExp = RegExp(rule.findText, caseSensitive: rule.caseSensitive);
      } catch (e) {
        debugPrint('[LocalDbService] Invalid regex pattern: ${rule.findText} - $e');
        rethrow;
      }
    } else {
      regExp = RegExp(RegExp.escape(rule.findText), caseSensitive: rule.caseSensitive);
    }

    final cond = rule.conditionText?.trim();
    final hasCondition = cond != null && cond.isNotEmpty;

    final batch = db.batch();
    bool hasBatchUpdates = false;

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
          if (translated.isEmpty) continue;

          // 원문 조건 필터 검증
          if (hasCondition) {
            final original = item['original'] as String? ?? '';
            if (rule.caseSensitive) {
              if (!original.contains(cond)) continue;
            } else {
              if (!original.toLowerCase().contains(cond.toLowerCase())) continue;
            }
          }

          final replaced = translated.replaceAll(regExp, rule.replaceText);
          if (replaced != translated) {
            item['translated'] = replaced;
            chapterModified = true;
            totalReplacedCount++;
          }
        }

        if (chapterModified) {
          final reEncoded = const ZLibEncoder().encode(utf8.encode(jsonEncode(list)));
          batch.update(
            'chapters',
            {'compressed_content': reEncoded},
            where: 'id = ?',
            whereArgs: [chapId],
          );
          hasBatchUpdates = true;
        }
      } catch (e) {
        if (kDebugMode) {
          debugPrint('Error applying rule on chapter $chapId: $e');
        }
      }
    }

    if (hasBatchUpdates) {
      await batch.commit(noResult: true);
    }

    // 룰 저장 & 동기화 큐 등록
    final savedRule = GlossaryRule(
      folderScope: rule.folderScope,
      findText: rule.findText,
      replaceText: rule.replaceText,
      conditionText: rule.conditionText,
      useRegex: rule.useRegex,
      caseSensitive: rule.caseSensitive,
      appliedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      replacedCount: totalReplacedCount,
    );
    await db.insert('local_glossary', savedRule.toMap());
    await _enqueueChange('glossary_rule', '${rule.findText}->${rule.replaceText}', savedRule.toMap());

    return totalReplacedCount;
  }

  // --- 찾아바꾸기 실시간 미리보기 (Live Preview & Diff Inspector) ---
  /// DB를 수정하지 않고, 검색 조건에 매칭되는 문단들과 치환 후 Diff 결과를 고속 추출
  static Future<List<FindReplaceItem>> previewFindReplace({
    required String findText,
    required String replaceText,
    String folderScope = '__all__',
    String? conditionText,
    bool useRegex = false,
    bool caseSensitive = false,
    int limit = 200,
  }) async {
    final find = findText;
    if (find.isEmpty) return [];

    final db = await database;
    RegExp regExp;
    if (useRegex) {
      try {
        regExp = RegExp(find, caseSensitive: caseSensitive);
      } catch (e) {
        debugPrint('[previewFindReplace] Invalid regex pattern: $find - $e');
        rethrow;
      }
    } else {
      regExp = RegExp(RegExp.escape(find), caseSensitive: caseSensitive);
    }

    List<Map<String, dynamic>> targetChapters;
    if (folderScope == '__all__') {
      targetChapters = await db.query(
        'chapters',
        columns: ['id', 'book_name', 'title', 'compressed_content'],
        orderBy: 'id DESC',
      );
    } else {
      targetChapters = await db.query(
        'chapters',
        columns: ['id', 'book_name', 'title', 'compressed_content'],
        where: 'book_name = ?',
        whereArgs: [folderScope],
        orderBy: 'sort_order ASC, id ASC',
      );
    }

    final cond = conditionText?.trim();
    final hasCondition = cond != null && cond.isNotEmpty;
    final results = <FindReplaceItem>[];

    for (final chap in targetChapters) {
      if (results.length >= limit) break;

      final chapId = chap['id'] as int;
      final bookName = chap['book_name'] as String? ?? '';
      final chapTitle = chap['title'] as String? ?? '';
      final compressedBytes = chap['compressed_content'] as Uint8List?;
      if (compressedBytes == null) continue;

      try {
        final decompressed = const ZLibDecoder().decodeBytes(compressedBytes);
        final jsonStr = utf8.decode(decompressed);
        final List<dynamic> list = jsonDecode(jsonStr);

        for (final item in list) {
          if (results.length >= limit) break;

          final translated = item['translated'] as String? ?? '';
          if (translated.isEmpty) continue;

          // 원문 조건 필터링
          final original = item['original'] as String? ?? '';
          if (hasCondition) {
            if (caseSensitive) {
              if (!original.contains(cond)) continue;
            } else {
              if (!original.toLowerCase().contains(cond.toLowerCase())) continue;
            }
          }

          // 번역문 매칭 검사
          if (!regExp.hasMatch(translated)) continue;

          final after = translated.replaceAll(regExp, replaceText);
          if (after == translated) continue;

          final diff = TextDiffHelper.computeDiff(translated, after);
          results.add(FindReplaceItem(
            chapterId: chapId,
            bookName: bookName,
            chapterTitle: chapTitle,
            sentenceId: item['id'] as int? ?? 0,
            pid: item['pid'] as String? ?? '',
            original: original,
            beforeText: translated,
            afterText: after,
            diff: diff,
          ));
        }
      } catch (_) {}
    }

    return results;
  }

  // --- 선택된 특정 문단들만 정밀 치환 (Selective Replacement) ---
  static Future<int> applyFindReplaceItems({
    required List<FindReplaceItem> targetItems,
    required GlossaryRule rule,
  }) async {
    if (targetItems.isEmpty) return 0;

    final db = await database;
    int totalReplacedCount = 0;

    // chapterId별로 그룹핑
    final grouped = <int, List<FindReplaceItem>>{};
    for (final item in targetItems) {
      grouped.putIfAbsent(item.chapterId, () => []).add(item);
    }

    final batch = db.batch();
    bool hasBatchUpdates = false;

    for (final entry in grouped.entries) {
      final chapId = entry.key;
      final itemsToReplace = entry.value;
      final targetPidMap = {for (var it in itemsToReplace) it.pid: it.afterText};

      final chapRows = await db.query(
        'chapters',
        columns: ['compressed_content'],
        where: 'id = ?',
        whereArgs: [chapId],
        limit: 1,
      );
      if (chapRows.isEmpty) continue;

      final compressedBytes = chapRows.first['compressed_content'] as Uint8List?;
      if (compressedBytes == null) continue;

      try {
        final decompressed = const ZLibDecoder().decodeBytes(compressedBytes);
        final jsonStr = utf8.decode(decompressed);
        final List<dynamic> list = jsonDecode(jsonStr);

        bool modified = false;
        for (final item in list) {
          final pid = item['pid'] as String? ?? '';
          if (targetPidMap.containsKey(pid)) {
            item['translated'] = targetPidMap[pid];
            modified = true;
            totalReplacedCount++;
          }
        }

        if (modified) {
          final reEncoded = const ZLibEncoder().encode(utf8.encode(jsonEncode(list)));
          batch.update(
            'chapters',
            {'compressed_content': reEncoded},
            where: 'id = ?',
            whereArgs: [chapId],
          );
          hasBatchUpdates = true;
        }
      } catch (_) {}
    }

    if (hasBatchUpdates) {
      await batch.commit(noResult: true);
    }

    // 룰 저장 & 동기화 큐 등록
    final savedRule = GlossaryRule(
      folderScope: rule.folderScope,
      findText: rule.findText,
      replaceText: rule.replaceText,
      conditionText: rule.conditionText,
      useRegex: rule.useRegex,
      caseSensitive: rule.caseSensitive,
      appliedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
      replacedCount: totalReplacedCount,
    );
    await db.insert('local_glossary', savedRule.toMap());
    await _enqueueChange('glossary_rule', '${rule.findText}->${rule.replaceText}', savedRule.toMap());

    return totalReplacedCount;
  }

  // --- 규칙 되돌리기 (Undo / Rollback Engine) ---
  /// 적용된 규칙의 바꿀 단어 -> 원래 단어로 역치환을 실행하여 롤백
  static Future<int> rollbackGlossaryRule(GlossaryRule rule) async {
    final reverseRule = GlossaryRule(
      folderScope: rule.folderScope,
      findText: rule.replaceText,
      replaceText: rule.findText,
      conditionText: rule.conditionText,
      useRegex: false,
      caseSensitive: rule.caseSensitive,
      appliedAt: DateTime.now().millisecondsSinceEpoch ~/ 1000,
    );

    final count = await applyGlossaryRule(reverseRule);

    if (rule.id != null) {
      final db = await database;
      await db.delete('local_glossary', where: 'id = ?', whereArgs: [rule.id]);
    }

    return count;
  }

  // --- 규칙 삭제 (Delete Glossary Rule) ---
  static Future<void> deleteGlossaryRule(int id) async {
    final db = await database;
    await db.delete('local_glossary', where: 'id = ?', whereArgs: [id]);
  }

  // --- 동기화 큐 관리 ---
  static Future<void> _refreshPendingCountNotifier(Database db) async {
    try {
      final res = await db.rawQuery('SELECT COUNT(*) as cnt FROM offline_change_queue');
      pendingCountNotifier.value = (res.first['cnt'] as num?)?.toInt() ?? 0;
    } catch (_) {
      pendingCountNotifier.value = 0;
    }
  }

  static Future<void> _enqueueChange(String changeType, String? targetId, Map<String, dynamic> payload) async {
    final db = await database;
    final nowTs = DateTime.now().millisecondsSinceEpoch ~/ 1000;
    final cleanTarget = targetId?.trim() ?? '';

    // glossary_rule은 순차 실행이 중요하므로 병합하지 않고 그대로 추가
    final bool canCoalesce = cleanTarget.isNotEmpty &&
        (changeType == 'activity' ||
            changeType == 'pin' ||
            changeType == 'translation_edit' ||
            changeType == 'highlight_add' ||
            changeType == 'highlight_delete');

    if (canCoalesce) {
      final bool isHighlightToggle = changeType == 'highlight_add' || changeType == 'highlight_delete';
      final existingRows = await db.query(
        'offline_change_queue',
        where: isHighlightToggle
            ? "change_type IN ('highlight_add', 'highlight_delete') AND target_id = ?"
            : 'change_type = ? AND target_id = ?',
        whereArgs: isHighlightToggle ? [cleanTarget] : [changeType, cleanTarget],
        orderBy: 'id ASC',
      );

      if (existingRows.isNotEmpty) {
        final mergedPayload = <String, dynamic>{};
        final Set<String> mergedReasons = <String>{};
        String? earliestBefore;

        for (final row in existingRows) {
          try {
            final prev = jsonDecode(row['payload_json'] as String? ?? '{}');
            if (prev is Map) {
              if (earliestBefore == null && prev['before_translated'] != null) {
                final b = prev['before_translated'].toString();
                if (b.isNotEmpty) earliestBefore = b;
              }
              if (prev['change_reasons'] is List) {
                for (final r in (prev['change_reasons'] as List)) {
                  final rs = r?.toString().trim() ?? '';
                  if (rs.isNotEmpty) mergedReasons.add(rs);
                }
              }
              if (isHighlightToggle) {
                if (prev['book_name'] != null && !payload.containsKey('book_name')) {
                  mergedPayload['book_name'] = prev['book_name'];
                }
                if (prev['chapter_title'] != null && !payload.containsKey('chapter_title')) {
                  mergedPayload['chapter_title'] = prev['chapter_title'];
                }
              }
            }
          } catch (_) {}
        }

        if (payload['change_reasons'] is List) {
          for (final r in (payload['change_reasons'] as List)) {
            final rs = r?.toString().trim() ?? '';
            if (rs.isNotEmpty) mergedReasons.add(rs);
          }
        }

        mergedPayload.addAll(payload);
        if (earliestBefore != null) {
          mergedPayload['before_translated'] = earliestBefore;
        }
        if (mergedReasons.isNotEmpty) {
          mergedPayload['change_reasons'] = mergedReasons.toList();
        }

        final keepId = existingRows.last['id'] as int;
        await db.update(
          'offline_change_queue',
          {
            'change_type': changeType,
            'target_id': cleanTarget,
            'payload_json': jsonEncode(mergedPayload),
            'created_at': nowTs,
          },
          where: 'id = ?',
          whereArgs: [keepId],
        );

        if (existingRows.length > 1) {
          final redundantIds = existingRows.take(existingRows.length - 1).map((r) => r['id'] as int).toList();
          await db.delete(
            'offline_change_queue',
            where: 'id IN (${redundantIds.map((_) => '?').join(',')})',
            whereArgs: redundantIds,
          );
        }

        await _refreshPendingCountNotifier(db);
        return;
      }
    }

    await db.insert('offline_change_queue', {
      'change_type': changeType,
      'target_id': targetId,
      'payload_json': jsonEncode(payload),
      'created_at': nowTs,
    });
    await _refreshPendingCountNotifier(db);
  }

  static Future<List<Map<String, dynamic>>> getPendingChanges() async {
    final db = await database;
    return await db.query('offline_change_queue', orderBy: 'id ASC');
  }

  static Future<int> getPendingChangeCount() async {
    try {
      final db = await database;
      final res = await db.rawQuery('SELECT COUNT(*) as cnt FROM offline_change_queue');
      final count = (res.first['cnt'] as num?)?.toInt() ?? 0;
      pendingCountNotifier.value = count;
      return count;
    } catch (_) {
      return 0;
    }
  }

  static Future<void> clearPendingChanges(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await database;
    await db.delete(
      'offline_change_queue',
      where: 'id IN (${ids.map((_) => '?').join(',')})',
      whereArgs: ids,
    );
    await _refreshPendingCountNotifier(db);
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

  // --- 문장 하이라이트 (수정 대기 마킹) 관리 ---
  /// 태블릿/모바일에서 독서 중 어색한 문장 하이라이트 등록
  static Future<void> addSentenceHighlight(SentenceHighlight item) async {
    final db = await database;
    await db.insert('sentence_highlights', item.toJson(), conflictAlgorithm: ConflictAlgorithm.replace);
    await _enqueueChange('highlight_add', '${item.url}#${item.pid}', item.toJson());
  }

  /// 하이라이트 해제(삭제)
  static Future<void> removeSentenceHighlight(String url, String pid, {String? bookName, String? chapterTitle}) async {
    final db = await database;
    String? resolvedBook = bookName;
    String? resolvedChap = chapterTitle;
    if (resolvedBook == null || resolvedChap == null) {
      try {
        final rows = await db.query(
          'sentence_highlights',
          columns: ['book_name', 'chapter_title'],
          where: 'url = ? AND pid = ?',
          whereArgs: [url, pid],
          limit: 1,
        );
        if (rows.isNotEmpty) {
          resolvedBook ??= rows.first['book_name'] as String?;
          resolvedChap ??= rows.first['chapter_title'] as String?;
        }
      } catch (_) {}
    }
    await db.delete('sentence_highlights', where: 'url = ? AND pid = ?', whereArgs: [url, pid]);
    await _enqueueChange('highlight_delete', '$url#$pid', {
      'url': url,
      'pid': pid,
      if (resolvedBook != null && resolvedBook.isNotEmpty) 'book_name': resolvedBook,
      if (resolvedChap != null && resolvedChap.isNotEmpty) 'chapter_title': resolvedChap,
    });
  }

  /// 특정 소설의 하이라이트 목록 조회 (미해결 우선)
  static Future<List<SentenceHighlight>> getHighlightsByBook(String bookName, {bool unresolvedOnly = true}) async {
    final db = await database;
    final where = unresolvedOnly ? 'book_name = ? AND is_resolved = 0' : 'book_name = ?';
    final rows = await db.query(
      'sentence_highlights',
      where: where,
      whereArgs: [bookName],
      orderBy: 'created_at DESC, id DESC',
    );
    return rows.map((r) => SentenceHighlight.fromJson(r)).toList();
  }

  /// 도서별 미해결 하이라이트 수 집계 맵 반환
  static Future<Map<String, int>> getHighlightCountsByBook() async {
    final db = await database;
    try {
      final rows = await db.rawQuery('''
        SELECT book_name, COUNT(*) as cnt
        FROM sentence_highlights
        WHERE is_resolved = 0
        GROUP BY book_name
      ''');
      final Map<String, int> result = {};
      for (var r in rows) {
        final bName = r['book_name'] as String?;
        final cnt = (r['cnt'] as num?)?.toInt() ?? 0;
        if (bName != null && bName.isNotEmpty) {
          result[bName] = cnt;
        }
      }
      return result;
    } catch (_) {
      return {};
    }
  }

  /// 특정 챕터(URL)의 미해결 하이라이트된 pid 집합 반환
  static Future<Set<String>> getHighlightedPids(String url) async {
    final db = await database;
    try {
      final rows = await db.query(
        'sentence_highlights',
        columns: ['pid'],
        where: 'url = ? AND is_resolved = 0',
        whereArgs: [url],
      );
      return rows.map((r) => r['pid'] as String).toSet();
    } catch (_) {
      return {};
    }
  }

  /// PC 동기화 데이터 수신 시 로컬 하이라이트 테이블 반영
  static Future<void> syncHighlightsFromPc(List<dynamic> highlightsList) async {
    if (highlightsList.isEmpty) return;
    final db = await database;
    final batch = db.batch();
    for (var raw in highlightsList) {
      if (raw is Map<String, dynamic>) {
        final map = Map<String, dynamic>.from(raw)..remove('id');
        batch.insert('sentence_highlights', map, conflictAlgorithm: ConflictAlgorithm.replace);
      }
    }
    await batch.commit(noResult: true);
  }

  // --- 본문 삽화 (Novel Illustrations) 로컬 DB 조회/동기화 ---
  static Future<void> upsertIllustrationsFromPc(List<dynamic> items) async {
    if (items.isEmpty) return;
    final db = await database;
    final batch = db.batch();
    for (final raw in items) {
      if (raw is Map<String, dynamic>) {
        final illu = NovelIllustration.fromMap(raw);
        if (illu.id > 0 && illu.bookName.isNotEmpty && illu.chapterUrl.isNotEmpty) {
          batch.insert('novel_illustrations', illu.toDbMap(), conflictAlgorithm: ConflictAlgorithm.replace);
        }
      } else if (raw is Map) {
        final map = Map<String, dynamic>.from(raw);
        final illu = NovelIllustration.fromMap(map);
        if (illu.id > 0 && illu.bookName.isNotEmpty && illu.chapterUrl.isNotEmpty) {
          batch.insert('novel_illustrations', illu.toDbMap(), conflictAlgorithm: ConflictAlgorithm.replace);
        }
      }
    }
    await batch.commit(noResult: true);
  }

  static Future<void> deleteIllustrationsByIds(List<int> ids) async {
    if (ids.isEmpty) return;
    final db = await database;
    const chunkSize = 100;
    for (var i = 0; i < ids.length; i += chunkSize) {
      final chunk = ids.sublist(i, (i + chunkSize).clamp(0, ids.length));
      final placeholders = List.filled(chunk.length, '?').join(',');
      await db.delete('novel_illustrations', where: 'id IN ($placeholders)', whereArgs: chunk);
    }
  }

  static Future<List<NovelIllustration>> getIllustrationsForChapter(
    String bookName,
    String chapterUrl,
  ) async {
    final db = await database;
    try {
      final rows = await db.query(
        'novel_illustrations',
        where: 'book_name = ? AND chapter_url = ?',
        whereArgs: [bookName, chapterUrl],
        orderBy: 'sort_order ASC, id ASC',
      );
      return rows.map((r) => NovelIllustration.fromMap(r)).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<List<NovelIllustration>> getAllIllustrations() async {
    final db = await database;
    try {
      final rows = await db.query(
        'novel_illustrations',
        orderBy: 'id ASC',
      );
      return rows.map((r) => NovelIllustration.fromMap(r)).toList();
    } catch (_) {
      return [];
    }
  }

  static Future<Map<String, int>> getIllustrationCountsByChapter(String bookName) async {
    final db = await database;
    try {
      final rows = await db.rawQuery('''
        SELECT chapter_url, COUNT(*) as cnt
        FROM novel_illustrations
        WHERE book_name = ?
        GROUP BY chapter_url
      ''', [bookName]);
      final result = <String, int>{};
      for (final r in rows) {
        final url = r['chapter_url'] as String?;
        final cnt = (r['cnt'] as num?)?.toInt() ?? 0;
        if (url != null && url.isNotEmpty && cnt > 0) {
          result[url] = cnt;
        }
      }
      return result;
    } catch (_) {
      return {};
    }
  }
}


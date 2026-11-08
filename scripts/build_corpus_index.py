"""
Corpus Index Builder Script (Modernized for 770k+ Scale).
Processes 770k+ sentences from server/translations.db and builds
the pre-indexed, distilled server/corpus_ai.db via staging.

Usage:
    python -m scripts.build_corpus_index [--limit N] [--min-count 3] [--swap]
"""

import os
import sys
import time
import re
import sqlite3
import argparse
from datetime import datetime
from collections import Counter, defaultdict

# Ensure UTF-8 output on Windows
if sys.platform == 'win32':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

from server.database import get_db_path
from server.database_corpus import (
    get_corpus_db_path,
    init_corpus_db,
)
from server.services.dictionary_service import (
    KOREAN_STOPWORDS,
    _get_sudachi_tokenizer,
    _get_kiwi,
    _extract_korean_nouns,
)


# Japanese Token Extraction Regex
# 1. Kanji + Hiragana inflections: e.g. 頷いた, 殺せ, 助けて, 静かに
# 2. Katakana nouns: e.g. エルフ, ギルド, スライム
# 3. Hiragana grammar / adverb chunks: e.g. そして, しかし, だから, とても
JA_TOKEN_RE = re.compile(
    r'[\u4e00-\u9fff]+[\u3040-\u309f]{0,4}|[\u30a0-\u30ffー]{2,}|[\u3040-\u309f]{2,4}'
)

# Korean Word Extraction Regex
KO_WORD_RE = re.compile(r'[가-힣]{2,}')

# Sentence Tone Ending Patterns
JA_END_RE = re.compile(r'([ぁ-んァ-ヶー一-龠]{1,4})[」』！？。…\s]*$')
KO_END_RE = re.compile(r'([가-힣]{1,3})[」』！？\.\…\s]*$')

# Japanese Punctuation / Brackets
CLEAN_JA_RE = re.compile(r'[「」『』\s　]')
CLEAN_KO_RE = re.compile(r'[「」『』\s]')


def build_corpus_index(
    limit: int = 0,
    min_co_count: int = 3,
    target_path: str = None,
    auto_swap: bool = False
):
    start_time = time.time()
    source_db_path = get_db_path()
    official_db_path = get_corpus_db_path()
    
    # 1. Always build into staging DB first to guarantee database safety
    staging_db_path = target_path or os.path.join(
        os.path.dirname(official_db_path), "corpus_ai_staging.db"
    )

    print("=== [Corpus AI Indexer (770k+ Scale)] Starting build ===")
    print(f"Source DB (Read-Only): {source_db_path}")
    print(f"Staging Target DB: {staging_db_path}")
    print(f"Auto-Swap to Official: {auto_swap}")

    # Remove stale staging database if exists
    if os.path.exists(staging_db_path):
        try:
            os.remove(staging_db_path)
            if os.path.exists(f"{staging_db_path}-wal"):
                os.remove(f"{staging_db_path}-wal")
            if os.path.exists(f"{staging_db_path}-shm"):
                os.remove(f"{staging_db_path}-shm")
        except Exception as e:
            print(f"Warning: could not clean old staging DB: {e}")

    # Initialize schema on the staging database
    staging_conn = sqlite3.connect(staging_db_path)
    staging_conn.execute("PRAGMA journal_mode=WAL;")
    staging_conn.execute("PRAGMA synchronous=NORMAL;")
    init_corpus_db(staging_conn)

    # Disable FTS triggers during bulk load for 10x throughput
    staging_cur = staging_conn.cursor()
    staging_cur.execute("DROP TRIGGER IF EXISTS corpus_templates_ai;")
    staging_cur.execute("DROP TRIGGER IF EXISTS corpus_templates_ad;")
    staging_cur.execute("DROP TRIGGER IF EXISTS corpus_templates_au;")
    staging_conn.commit()

    # Read-Only connection to operational database
    source_uri = f"file:{os.path.abspath(source_db_path)}?mode=ro"
    source_conn = sqlite3.connect(source_uri, uri=True)
    source_cur = source_conn.cursor()

    query = (
        "SELECT original, translated, folderName "
        "FROM translations "
        "WHERE translated IS NOT NULL AND length(translated) > 0"
    )
    if limit > 0:
        query += f" LIMIT {limit}"

    source_cur.execute(query)

    print("Scanning and analyzing source translations...")
    total_scanned = 0

    # 1. Tone counters: (folder_name, is_dialogue, ja_ending, ko_ending) -> count
    tone_counts = Counter()
    ja_tone_totals = Counter()

    # 2. Template / Exact Sentence counts: (ja_clean, ko_clean) -> [count, folder, orig, trans, is_dial]
    template_data = {}

    # 3. Phrase Alignment counters
    ja_token_counts = Counter()
    co_occur_counts = Counter()

    batch_size = 50000
    last_log_time = time.time()

    sudachi_tok = _get_sudachi_tokenizer()
    kiwi = _get_kiwi()
    split_mode_c = None
    if sudachi_tok:
        try:
            from sudachipy import tokenizer
            split_mode_c = tokenizer.Tokenizer.SplitMode.C
        except Exception:
            split_mode_c = None

    while True:
        rows = source_cur.fetchmany(batch_size)
        if not rows:
            break

        for orig, trans, folder in rows:
            total_scanned += 1
            folder = folder or "default"

            # --- A. Tone Statistics ---
            is_dial = 1 if orig.startswith(('「', '『')) else 0
            m_ja = JA_END_RE.search(orig)
            m_ko = KO_END_RE.search(trans)
            if m_ja and m_ko:
                ja_e = m_ja.group(1)
                ko_e = m_ko.group(1)
                tone_counts[(folder, is_dial, ja_e, ko_e)] += 1
                ja_tone_totals[(folder, is_dial, ja_e)] += 1

            # --- B. Sentence Templates ---
            ja_c = CLEAN_JA_RE.sub('', orig)
            ko_c = CLEAN_KO_RE.sub('', trans)
            if 2 <= len(ja_c) <= 120 and 2 <= len(ko_c) <= 150:
                key = (ja_c, ko_c)
                if key not in template_data:
                    template_data[key] = [1, folder, orig, trans, is_dial]
                else:
                    template_data[key][0] += 1

            # --- C. Phrase Alignments ---
            ja_tokens = set()
            if sudachi_tok and split_mode_c:
                try:
                    morphemes = sudachi_tok.tokenize(orig, split_mode_c)
                    for mor in morphemes:
                        pos = mor.part_of_speech()[0]
                        if pos in ("名詞", "動詞", "形容詞"):
                            surf = mor.surface()
                            lemma = mor.dictionary_form()
                            if len(surf) >= 2:
                                ja_tokens.add(surf)
                            if len(lemma) >= 2:
                                ja_tokens.add(lemma)
                except Exception:
                    ja_tokens = set(JA_TOKEN_RE.findall(orig))
            else:
                ja_tokens = set(JA_TOKEN_RE.findall(orig))

            if kiwi:
                valid_ko = _extract_korean_nouns(trans, kiwi)
            else:
                ko_words = set(KO_WORD_RE.findall(trans))
                valid_ko = [kw for kw in ko_words if kw not in KOREAN_STOPWORDS]

            for jt in ja_tokens:
                if len(jt) >= 2:
                    ja_token_counts[jt] += 1
                    for kt in valid_ko:
                        co_occur_counts[(jt, kt, folder)] += 1

        if total_scanned % batch_size == 0:
            elapsed = time.time() - last_log_time
            rate = batch_size / elapsed if elapsed > 0 else 0
            print(f"  Processed {total_scanned:,} sentences... ({elapsed:.2f}s, {rate:.0f} sent/s)")
            last_log_time = time.time()

    source_conn.close()
    scan_duration = time.time() - start_time
    print(f"Scanned {total_scanned:,} sentences in {scan_duration:.2f}s.")

    # --- Processing Phrase Alignments ---
    print("Computing phrase alignment probabilities...")
    grouped_phrases = defaultdict(list)
    for (jt, kt, f_name), count in co_occur_counts.items():
        if count >= min_co_count:
            jt_total = ja_token_counts[jt]
            prob = round(count / jt_total, 4) if jt_total > 0 else 0.0
            if prob >= 0.18:  # 770k+ scale precision threshold
                grouped_phrases[(jt, f_name)].append((kt, count, prob))

    alignments_to_insert = []
    for (jt, f_name), cands in grouped_phrases.items():
        cands.sort(key=lambda x: (x[1], x[2]), reverse=True)
        for kt, cnt, prob in cands[:3]:
            alignments_to_insert.append((jt, kt, cnt, prob, f_name))

    print(f"Extracted {len(alignments_to_insert):,} high-confidence phrase alignments.")

    # --- Processing Templates (Smart Distillation for 770k+) ---
    print("Selecting sentence templates (Smart Distillation)...")
    templates_to_insert = []
    for (ja_c, ko_c), (freq, f_name, orig, trans, is_dial) in template_data.items():
        # High quality criteria:
        # 1. Frequently recurring sentences (freq >= 2)
        # 2. Short, natural dialogue expressions (is_dial and 3 <= len <= 35)
        # 3. High-quality concise prose idioms (not is_dial and 4 <= len <= 25)
        if freq >= 2:
            templates_to_insert.append((ja_c, ko_c, orig, trans, freq, f_name))
        elif is_dial and (3 <= len(ja_c) <= 35):
            templates_to_insert.append((ja_c, ko_c, orig, trans, freq, f_name))
        elif (not is_dial) and (4 <= len(ja_c) <= 25):
            templates_to_insert.append((ja_c, ko_c, orig, trans, freq, f_name))

    print(f"Extracted {len(templates_to_insert):,} distilled sentence templates.")

    # --- Processing Tone Stats ---
    print("Computing tone conditional probabilities...")
    tones_to_insert = []
    for (f_name, is_dial, ja_e, ko_e), count in tone_counts.items():
        total_ja = ja_tone_totals[(f_name, is_dial, ja_e)]
        prob = round(count / total_ja, 4) if total_ja > 0 else 0.0
        if count >= 2 and prob >= 0.1:
            tones_to_insert.append((f_name, is_dial, ja_e, ko_e, count, prob))

    print(f"Extracted {len(tones_to_insert):,} tone ending statistics.")

    # --- Writing to Staging DB ---
    print(f"Writing to staging database: {staging_db_path}...")

    staging_cur.executemany(
        """
        INSERT INTO corpus_templates (ja_clean, ko_clean, original, translated, frequency, folder_name)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        templates_to_insert
    )

    staging_cur.executemany(
        """
        INSERT INTO corpus_phrase_alignments (ja_phrase, ko_phrase, co_occurrence_count, probability, folder_name)
        VALUES (?, ?, ?, ?, ?);
        """,
        alignments_to_insert
    )

    staging_cur.executemany(
        """
        INSERT INTO corpus_tone_stats (folder_name, is_dialogue, ja_ending, ko_ending, count, probability)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        tones_to_insert
    )

    # Rebuild FTS5 Trigram in single optimized pass
    print("Rebuilding FTS5 Trigram index on staging DB...")
    staging_cur.execute("INSERT INTO corpus_templates_fts(corpus_templates_fts) VALUES('rebuild');")

    # Re-attach FTS5 synchronization triggers for future incremental updates
    staging_cur.execute("""
        CREATE TRIGGER IF NOT EXISTS corpus_templates_ai AFTER INSERT ON corpus_templates BEGIN
            INSERT INTO corpus_templates_fts(rowid, ja_clean, translated) VALUES (new.id, new.ja_clean, new.translated);
        END;
    """)
    staging_cur.execute("""
        CREATE TRIGGER IF NOT EXISTS corpus_templates_ad AFTER DELETE ON corpus_templates BEGIN
            INSERT INTO corpus_templates_fts(corpus_templates_fts, rowid, ja_clean, translated) VALUES('delete', old.id, old.ja_clean, old.translated);
        END;
    """)
    staging_cur.execute("""
        CREATE TRIGGER IF NOT EXISTS corpus_templates_au AFTER UPDATE ON corpus_templates BEGIN
            INSERT INTO corpus_templates_fts(corpus_templates_fts, rowid, ja_clean, translated) VALUES('delete', old.id, old.ja_clean, old.translated);
            INSERT INTO corpus_templates_fts(rowid, ja_clean, translated) VALUES (new.id, new.ja_clean, new.translated);
        END;
    """)

    # Insert metadata
    meta_records = [
        ("version", "2.0.0"),
        ("last_indexed_at", datetime.now().isoformat()),
        ("source_total_sentences", str(total_scanned)),
        ("total_templates", str(len(templates_to_insert))),
        ("total_phrase_alignments", str(len(alignments_to_insert))),
        ("total_tone_stats", str(len(tones_to_insert))),
    ]
    staging_cur.executemany(
        "INSERT INTO corpus_meta (key, value) VALUES (?, ?);",
        meta_records
    )

    staging_conn.commit()
    staging_cur.execute("PRAGMA optimize;")
    staging_conn.close()

    total_time = time.time() - start_time
    file_size_mb = os.path.getsize(staging_db_path) / (1024 * 1024)

    print(f"=== [Corpus AI Indexer] Finished in {total_time:.2f}s ===")
    print(f"Staging File: {staging_db_path} ({file_size_mb:.2f} MB)")
    print(f"Templates: {len(templates_to_insert):,}")
    print(f"Phrase Alignments: {len(alignments_to_insert):,}")
    print(f"Tone Stats: {len(tones_to_insert):,}")

    # Optional atomic swap to official DB
    if auto_swap:
        backup_official_path = f"{official_db_path}.backup_{int(time.time())}"
        print(f"Backing up current corpus DB to: {backup_official_path}")
        if os.path.exists(official_db_path):
            os.replace(official_db_path, backup_official_path)
            for ext in ("-wal", "-shm"):
                if os.path.exists(f"{official_db_path}{ext}"):
                    try:
                        os.remove(f"{official_db_path}{ext}")
                    except Exception:
                        pass
        print(f"Swapping staging DB to official: {official_db_path}")
        os.replace(staging_db_path, official_db_path)
        print("Swap completed successfully.")

    return {
        "status": "success",
        "duration_seconds": total_time,
        "size_mb": file_size_mb,
        "templates": len(templates_to_insert),
        "phrases": len(alignments_to_insert),
        "tones": len(tones_to_insert),
        "staging_path": staging_db_path
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Build Corpus AI Index (770k+ Scale)")
    parser.add_argument("--limit", type=int, default=0, help="Limit number of source sentences to scan")
    parser.add_argument("--min-count", type=int, default=3, help="Minimum co-occurrence count for phrases")
    parser.add_argument("--swap", action="store_true", help="Automatically swap staging DB to official corpus_ai.db")
    args = parser.parse_args()

    build_corpus_index(limit=args.limit, min_co_count=args.min_count, auto_swap=args.swap)

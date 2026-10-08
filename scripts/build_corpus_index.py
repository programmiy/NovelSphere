"""
Corpus Index Builder Script.
Processes 370k+ sentences from server/translations.db and builds
the pre-indexed, distilled server/corpus_ai.db.

Usage:
    python -m scripts.build_corpus_index
"""

import os
import sys
import time
import re
import sqlite3
from datetime import datetime
from collections import Counter, defaultdict
from typing import Dict, Tuple, List, Set

from server.settings import settings
from server.database import get_db_path
from server.database_corpus import (
    get_corpus_db_path,
    get_corpus_conn,
    init_corpus_db,
)
from server.services.dictionary_service import KOREAN_STOPWORDS


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


def build_corpus_index(limit: int = 0, min_co_count: int = 2):
    start_time = time.time()
    source_db_path = get_db_path()
    target_db_path = get_corpus_db_path()

    print(f"=== [Corpus AI Indexer] Starting build ===")
    print(f"Source DB: {source_db_path}")
    print(f"Target DB: {target_db_path}")

    # Ensure schema exists in corpus_ai.db
    init_corpus_db()

    source_conn = sqlite3.connect(source_db_path)
    source_cur = source_conn.cursor()

    query = "SELECT original, translated, folderName FROM translations WHERE translated IS NOT NULL AND length(translated) > 0"
    if limit > 0:
        query += f" LIMIT {limit}"

    source_cur.execute(query)

    print("Scanning and analyzing source translations...")
    total_scanned = 0

    # 1. Tone counters: (folder_name, is_dialogue, ja_ending, ko_ending) -> count
    tone_counts = Counter()
    ja_tone_totals = Counter()

    # 2. Template / Exact Sentence counts: (ja_clean, ko_clean) -> {count, folder, orig, trans}
    template_data = {}

    # 3. Phrase Alignment counters
    ja_token_counts = Counter()
    co_occur_counts = Counter()

    batch_size = 50000
    last_log_time = time.time()

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
                    template_data[key] = [1, folder, orig, trans]
                else:
                    template_data[key][0] += 1

            # --- C. Phrase Alignments ---
            ja_tokens = set(JA_TOKEN_RE.findall(orig))
            ko_words = set(KO_WORD_RE.findall(trans))

            # Filter stopwords from Korean candidates to maximize precision
            valid_ko = [kw for kw in ko_words if kw not in KOREAN_STOPWORDS]

            for jt in ja_tokens:
                if len(jt) >= 2:
                    ja_token_counts[jt] += 1
                    for kt in valid_ko:
                        co_occur_counts[(jt, kt, folder)] += 1

        if total_scanned % batch_size == 0:
            elapsed = time.time() - last_log_time
            print(f"  Processed {total_scanned:,} sentences... ({elapsed:.2f}s for batch)")
            last_log_time = time.time()

    source_conn.close()
    scan_duration = time.time() - start_time
    print(f"Scanned {total_scanned:,} sentences in {scan_duration:.2f}s.")

    # --- Processing Phrase Alignments ---
    print("Computing phrase alignment probabilities...")
    # Group by (jt, folder) to find best ko candidates
    grouped_phrases = defaultdict(list)
    for (jt, kt, f_name), count in co_occur_counts.items():
        if count >= min_co_count:
            jt_total = ja_token_counts[jt]
            prob = round(count / jt_total, 4) if jt_total > 0 else 0.0
            if prob >= 0.15:  # High precision threshold
                grouped_phrases[(jt, f_name)].append((kt, count, prob))

    alignments_to_insert = []
    for (jt, f_name), cands in grouped_phrases.items():
        # Keep top 3 candidates per Japanese token & folder
        cands.sort(key=lambda x: (x[1], x[2]), reverse=True)
        for kt, cnt, prob in cands[:3]:
            alignments_to_insert.append((jt, kt, cnt, prob, f_name))

    print(f"Extracted {len(alignments_to_insert):,} high-confidence phrase alignments.")

    # --- Processing Templates ---
    print("Selecting sentence templates...")
    # Keep frequent or distinct high-value templates
    templates_to_insert = []
    for (ja_c, ko_c), (freq, f_name, orig, trans) in template_data.items():
        # Include sentences with freq >= 2 OR length between 4 and 40 (standard expressions)
        if freq >= 2 or (4 <= len(ja_c) <= 35):
            templates_to_insert.append((ja_c, ko_c, orig, trans, freq, f_name))

    print(f"Extracted {len(templates_to_insert):,} sentence templates.")

    # --- Processing Tone Stats ---
    print("Computing tone conditional probabilities...")
    tones_to_insert = []
    for (f_name, is_dial, ja_e, ko_e), count in tone_counts.items():
        total_ja = ja_tone_totals[(f_name, is_dial, ja_e)]
        prob = round(count / total_ja, 4) if total_ja > 0 else 0.0
        if count >= 2 and prob >= 0.1:
            tones_to_insert.append((f_name, is_dial, ja_e, ko_e, count, prob))

    print(f"Extracted {len(tones_to_insert):,} tone ending statistics.")

    # --- Writing to corpus_ai.db ---
    print(f"Writing to {target_db_path}...")
    target_conn = get_corpus_conn()
    target_cur = target_conn.cursor()

    # Clear previous cache
    target_cur.execute("DELETE FROM corpus_templates;")
    target_cur.execute("DELETE FROM corpus_phrase_alignments;")
    target_cur.execute("DELETE FROM corpus_tone_stats;")
    target_cur.execute("DELETE FROM corpus_meta;")

    # Bulk insert templates
    target_cur.executemany(
        """
        INSERT INTO corpus_templates (ja_clean, ko_clean, original, translated, frequency, folder_name)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        templates_to_insert
    )

    # Bulk insert phrase alignments
    target_cur.executemany(
        """
        INSERT INTO corpus_phrase_alignments (ja_phrase, ko_phrase, co_occurrence_count, probability, folder_name)
        VALUES (?, ?, ?, ?, ?);
        """,
        alignments_to_insert
    )

    # Bulk insert tone stats
    target_cur.executemany(
        """
        INSERT INTO corpus_tone_stats (folder_name, is_dialogue, ja_ending, ko_ending, count, probability)
        VALUES (?, ?, ?, ?, ?, ?);
        """,
        tones_to_insert
    )

    # Insert metadata
    meta_records = [
        ("version", "1.0.0"),
        ("last_indexed_at", datetime.now().isoformat()),
        ("source_total_sentences", str(total_scanned)),
        ("total_templates", str(len(templates_to_insert))),
        ("total_phrase_alignments", str(len(alignments_to_insert))),
        ("total_tone_stats", str(len(tones_to_insert))),
    ]
    target_cur.executemany(
        "INSERT INTO corpus_meta (key, value) VALUES (?, ?);",
        meta_records
    )

    target_conn.commit()
    target_cur.execute("PRAGMA optimize;")
    target_conn.close()

    total_time = time.time() - start_time
    file_size_mb = os.path.getsize(target_db_path) / (1024 * 1024)

    print(f"=== [Corpus AI Indexer] Finished in {total_time:.2f}s ===")
    print(f"Generated Index File: {target_db_path} ({file_size_mb:.2f} MB)")
    print(f"Templates: {len(templates_to_insert):,}")
    print(f"Phrase Alignments: {len(alignments_to_insert):,}")
    print(f"Tone Stats: {len(tones_to_insert):,}")
    return {
        "status": "success",
        "duration_seconds": total_time,
        "size_mb": file_size_mb,
        "templates": len(templates_to_insert),
        "phrases": len(alignments_to_insert),
        "tones": len(tones_to_insert)
    }


if __name__ == "__main__":
    build_corpus_index()

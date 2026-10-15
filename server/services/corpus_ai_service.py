"""
Corpus AI Service.
Core engine for 340k+ corpus-based offline translation synthesis,
real-time contextual autocomplete, and style/tone consistency checking.
100% deterministic, rule-based & SQLite queries. No external AI APIs.
"""

import re
from rapidfuzz import fuzz
from typing import Optional, Dict, Any

from server.database_corpus import corpus_db_connection
from server.services.dictionary_service import _get_sudachi_tokenizer

# Tokenizer patterns
JA_TOKEN_RE = re.compile(
    r'[\u4e00-\u9fff]+[\u3040-\u309f]{0,4}|[\u30a0-\u30ffー]{2,}|[\u3040-\u309f]{2,4}'
)
KO_WORD_RE = re.compile(r'[가-힣]{2,}')

JA_END_RE = re.compile(r'([ぁ-んァ-ヶー一-龠]{1,4})[」』！？。…\s]*$')
KO_END_RE = re.compile(r'([가-힣]{1,3})[」』！？\.\…\s]*$')

CLEAN_JA_RE = re.compile(r'[「」『』\s　]')
CLEAN_KO_RE = re.compile(r'[「」『』\s]')


def _clean_text(text: str) -> str:
    """Removes outer brackets and spaces for template comparisons."""
    if not text:
        return ""
    return CLEAN_JA_RE.sub('', text)


def synthesize_translation(
    original: str,
    folder_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    2-Tier Cascade EBMT Synthesizer.
    Tier 1: High Similarity Template Matching (>= 75% similarity)
    Tier 2: Phrase Alignment Stitching Fallback with Coverage Score
    """
    raw_orig = (original or "").strip()
    if not raw_orig:
        return {
            "synthesized_text": "",
            "tier_used": "none",
            "coverage_percent": 0.0,
            "confidence": 0.0,
            "source_example": None,
            "matched_phrases": []
        }

    clean_orig = _clean_text(raw_orig)
    is_dialogue = 1 if raw_orig.startswith(('「', '『')) and raw_orig.endswith(('」', '』')) else 0
    orig_len = len(clean_orig)

    with corpus_db_connection(as_dict=True) as conn:
        cursor = conn.cursor()

        # =====================================================================
        # Tier 1: Check Exact & High-Similarity Template Matching
        # =====================================================================
        # 1. Exact match check
        query_exact = "SELECT original, translated, folder_name FROM corpus_templates WHERE ja_clean = ?"
        params_exact = [clean_orig]
        if folder_name:
            query_exact += " ORDER BY (folder_name = ?) DESC, frequency DESC LIMIT 1"
            params_exact.append(folder_name)
        else:
            query_exact += " ORDER BY frequency DESC LIMIT 1"

        cursor.execute(query_exact, params_exact)
        exact_row = cursor.fetchone()
        if exact_row and exact_row.get("translated"):
            trans_res = exact_row["translated"]
            # Restore dialogue brackets if needed
            if is_dialogue and not (trans_res.startswith('「') and trans_res.endswith('」')):
                trans_res = f"「{trans_res}」"
            return {
                "synthesized_text": trans_res,
                "tier_used": "tier1_exact",
                "coverage_percent": 100.0,
                "confidence": 100.0,
                "source_example": {
                    "original": exact_row["original"],
                    "translated": exact_row["translated"],
                    "folder_name": exact_row["folder_name"]
                },
                "matched_phrases": []
            }

        # 2. Fuzzy template candidate retrieval (length within +/- 35%)
        min_l = max(2, int(orig_len * 0.65))
        max_l = int(orig_len * 1.35)
        
        candidates = []
        if folder_name:
            cand_query_folder = """
                SELECT original, translated, ja_clean, folder_name, frequency
                FROM corpus_templates
                WHERE folder_name = ? AND length(ja_clean) BETWEEN ? AND ?
                ORDER BY frequency DESC LIMIT 100
            """
            cursor.execute(cand_query_folder, [folder_name, min_l, max_l])
            candidates = cursor.fetchall()

        if not candidates:
            cand_query = """
                SELECT original, translated, ja_clean, folder_name, frequency
                FROM corpus_templates
                WHERE length(ja_clean) BETWEEN ? AND ?
                ORDER BY length(ja_clean), frequency DESC LIMIT 100
            """
            cursor.execute(cand_query, [min_l, max_l])
            candidates = cursor.fetchall()

        best_cand = None
        best_ratio = 0.0

        for cand in candidates:
            cand_ja = cand["ja_clean"]
            ratio = fuzz.ratio(clean_orig, cand_ja) / 100.0
            if ratio > best_ratio:
                best_ratio = ratio
                best_cand = cand

        # If similarity >= 75%, adopt Tier 1 template substitution
        if best_cand and best_ratio >= 0.75:
            cand_trans = best_cand["translated"]
            if is_dialogue and not (cand_trans.startswith('「') and cand_trans.endswith('」')):
                cand_trans = f"「{cand_trans}」"
            return {
                "synthesized_text": cand_trans,
                "tier_used": "tier1_template",
                "coverage_percent": round(best_ratio * 100, 1),
                "confidence": round(best_ratio * 100, 1),
                "source_example": {
                    "original": best_cand["original"],
                    "translated": best_cand["translated"],
                    "folder_name": best_cand["folder_name"]
                },
                "matched_phrases": []
            }

        # =====================================================================
        # Tier 2: Phrase Alignment Stitching Fallback
        # =====================================================================
        # Extract Japanese tokens (morphological lemma + surface, plus legacy regex tokens)
        tokens = []
        sudachi_tok = _get_sudachi_tokenizer()
        if sudachi_tok:
            try:
                from sudachipy import tokenizer
                mode = tokenizer.Tokenizer.SplitMode.C
                morphemes = sudachi_tok.tokenize(raw_orig, mode)
                for mor in morphemes:
                    pos = mor.part_of_speech()[0]
                    if pos in ("名詞", "動詞", "形容詞"):
                        surf = mor.surface()
                        if len(surf) >= 2 and surf not in tokens:
                            tokens.append(surf)
                        lemma = mor.dictionary_form()
                        if len(lemma) >= 2 and lemma not in tokens:
                            tokens.append(lemma)
            except Exception:
                pass

        # Also add regex tokens for backwards compatibility
        for rt in JA_TOKEN_RE.findall(raw_orig):
            if len(rt) >= 2 and rt not in tokens:
                tokens.append(rt)

        if not tokens:
            return {
                "synthesized_text": "",
                "tier_used": "none",
                "coverage_percent": 0.0,
                "confidence": 0.0,
                "source_example": None,
                "matched_phrases": []
            }

        # Query alignments for tokens
        matched_chunks = []
        covered_char_count = 0
        placeholders = ','.join(['?'] * len(tokens))

        align_query = f"""
            SELECT ja_phrase, ko_phrase, probability, co_occurrence_count, folder_name
            FROM corpus_phrase_alignments
            WHERE ja_phrase IN ({placeholders})
        """
        align_params = list(tokens)
        if folder_name:
            align_query += " ORDER BY (folder_name = ?) DESC, probability DESC, co_occurrence_count DESC"
            align_params.append(folder_name)
        else:
            align_query += " ORDER BY probability DESC, co_occurrence_count DESC"

        cursor.execute(align_query, align_params)
        align_rows = cursor.fetchall()

        token_to_best_ko = {}
        for row in align_rows:
            jt = row["ja_phrase"]
            if jt not in token_to_best_ko:
                token_to_best_ko[jt] = row

        # Stitch phrases in order of appearance in original text
        stitched_parts = []
        seen_ko_words = set()

        for jt in tokens:
            if jt in token_to_best_ko:
                row = token_to_best_ko[jt]
                ko_p = row["ko_phrase"]
                if ko_p not in seen_ko_words:
                    stitched_parts.append(ko_p)
                    seen_ko_words.add(ko_p)
                covered_char_count += len(jt)
                matched_chunks.append({
                    "ja_phrase": jt,
                    "ko_phrase": ko_p,
                    "probability": row["probability"]
                })

        synthesized_str = " ".join(stitched_parts)
        if is_dialogue and synthesized_str:
            synthesized_str = f"「{synthesized_str}」"

        total_ja_chars = max(1, len(clean_orig))
        coverage = min(100.0, round((covered_char_count / total_ja_chars) * 100, 1))
        avg_prob = (
            round(sum(c["probability"] for c in matched_chunks) / len(matched_chunks) * 100, 1)
            if matched_chunks else 0.0
        )

        return {
            "synthesized_text": synthesized_str,
            "tier_used": "tier2_phrase_stitching",
            "coverage_percent": coverage,
            "confidence": avg_prob,
            "source_example": None,
            "matched_phrases": matched_chunks
        }


def suggest_next_phrase(
    original: str,
    prefix: str,
    folder_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Contextual Autocomplete for Ghost Text suggestions.
    Maps typed prefix and Japanese original keywords to high-probability Korean continuation.
    """
    prefix_clean = (prefix or "").strip()

    if not prefix_clean:
        return {"prefix": prefix, "suggestion": "", "confidence": 0.0}

    last_word = prefix_clean.split()[-1]

    with corpus_db_connection(as_dict=True) as conn:
        cursor = conn.cursor()

        # 1. Match from phrase alignments where ko_phrase starts with last_word
        query = """
            SELECT ko_phrase, probability, ja_phrase
            FROM corpus_phrase_alignments
            WHERE ko_phrase >= ? AND ko_phrase < ? AND length(ko_phrase) > length(?)
        """
        params = [last_word, last_word + '\uffff', last_word]
        if folder_name:
            query += " ORDER BY (folder_name = ?) DESC, probability DESC LIMIT 3"
            params.append(folder_name)
        else:
            query += " ORDER BY probability DESC LIMIT 3"

        cursor.execute(query, params)
        row = cursor.fetchone()

        if row:
            full_word = row["ko_phrase"]
            ghost_suffix = full_word[len(last_word):]
            return {
                "prefix": prefix,
                "suggestion": ghost_suffix,
                "confidence": row["probability"],
                "matched_token": row["ja_phrase"]
            }

        # 2. Check templates starting with prefix
        t_query = """
            SELECT translated FROM corpus_templates
            WHERE translated >= ? AND translated < ? AND length(translated) > length(?)
        """
        t_params = [prefix_clean, prefix_clean + '\uffff', prefix_clean]
        if folder_name:
            t_query += " ORDER BY (folder_name = ?) DESC, frequency DESC LIMIT 1"
            t_params.append(folder_name)
        else:
            t_query += " ORDER BY frequency DESC LIMIT 1"

        cursor.execute(t_query, t_params)
        t_row = cursor.fetchone()
        if t_row:
            full_text = t_row["translated"]
            ghost_suffix = full_text[len(prefix_clean):]
            # Take next 1~2 words of ghost text
            words = ghost_suffix.split()
            compact_ghost = " " + " ".join(words[:2]) if words else ghost_suffix
            return {
                "prefix": prefix,
                "suggestion": compact_ghost,
                "confidence": 0.85,
                "matched_token": "template"
            }

    return {"prefix": prefix, "suggestion": "", "confidence": 0.0}


def check_style_consistency(
    original: str,
    translated: str,
    folder_name: Optional[str] = None
) -> Dict[str, Any]:
    """
    Style & Tone Consistency Checker.
    Evaluates Japanese sentence ending vs translated Korean sentence ending
    using pre-indexed conditional probabilities in corpus_tone_stats.
    Returns traffic light badge status (green/yellow/red).
    """
    orig = (original or "").strip()
    trans = (translated or "").strip()

    if not orig or not trans:
        return {
            "status": "neutral",
            "color": "green",
            "score": 1.0,
            "detected_ja_ending": "",
            "current_ko_ending": "",
            "recommended_ko_ending": "",
            "reason": "분석할 텍스트가 부족합니다."
        }

    is_dialogue = 1 if orig.startswith(('「', '『')) else 0
    m_ja = JA_END_RE.search(orig)
    m_ko = KO_END_RE.search(trans)

    if not m_ja or not m_ko:
        return {
            "status": "neutral",
            "color": "green",
            "score": 1.0,
            "detected_ja_ending": "",
            "current_ko_ending": "",
            "recommended_ko_ending": "",
            "reason": "종결 어미 패턴 미감지 (정상)"
        }

    ja_e = m_ja.group(1)
    ko_e = m_ko.group(1)
    folder = folder_name or "default"

    with corpus_db_connection(as_dict=True) as conn:
        cursor = conn.cursor()

        # Query tone stats for this novel or global
        cursor.execute("""
            SELECT ko_ending, count, probability
            FROM corpus_tone_stats
            WHERE (folder_name = ? OR folder_name = 'default')
              AND is_dialogue = ?
              AND ja_ending = ?
            ORDER BY (folder_name = ?) DESC, count DESC LIMIT 5;
        """, (folder, is_dialogue, ja_e, folder))

        stats = cursor.fetchall()

    if not stats:
        return {
            "status": "acceptable",
            "color": "green",
            "score": 0.8,
            "detected_ja_ending": ja_e,
            "current_ko_ending": ko_e,
            "recommended_ko_ending": ko_e,
            "reason": f"어미 '{ja_e}'에 대한 기존 통계가 적어 자유 형식이 허용됩니다."
        }

    # Find probability of current ko_ending
    clean_trans = trans.rstrip('」』！？.… ')
    matched_stat = next((s for s in stats if s["ko_ending"] == ko_e), None)
    if not matched_stat:
        matched_stat = next((s for s in stats if clean_trans.endswith(s["ko_ending"])), None)

    top_stat = stats[0]
    display_ko_e = matched_stat["ko_ending"] if matched_stat else ko_e

    if matched_stat and matched_stat["probability"] >= 0.5:
        return {
            "status": "consistent",
            "color": "green",
            "score": matched_stat["probability"],
            "detected_ja_ending": ja_e,
            "current_ko_ending": display_ko_e,
            "recommended_ko_ending": matched_stat["ko_ending"],
            "reason": f"소설 내 표준 어투와 {int(matched_stat['probability'] * 100)}% 일치합니다."
        }
    elif matched_stat:
        return {
            "status": "acceptable",
            "color": "yellow",
            "score": matched_stat["probability"],
            "detected_ja_ending": ja_e,
            "current_ko_ending": display_ko_e,
            "recommended_ko_ending": top_stat["ko_ending"],
            "reason": f"사용 가능한 어미이나, '{top_stat['ko_ending']}'({int(top_stat['probability'] * 100)}%)가 더 빈번합니다."
        }
    else:
        # Divergent tone
        return {
            "status": "divergent",
            "color": "red",
            "score": 0.2,
            "detected_ja_ending": ja_e,
            "current_ko_ending": display_ko_e,
            "recommended_ko_ending": top_stat["ko_ending"],
            "reason": f"소설 내 어투와 상이합니다. 추천 종결 어미: '~{top_stat['ko_ending']}' ({int(top_stat['probability'] * 100)}%)"
        }


def sync_translation_to_corpus(
    original: str,
    translated: str,
    folder_name: Optional[str] = None
):
    """
    Incremental update helper for FastAPI BackgroundTasks.
    Safely increments tone and phrase statistics in corpus_ai.db.
    """
    orig = (original or "").strip()
    trans = (translated or "").strip()
    if not orig or not trans:
        return

    folder = folder_name or "default"
    is_dialogue = 1 if orig.startswith(('「', '『')) else 0

    try:
        with corpus_db_connection() as conn:
            cursor = conn.cursor()

            # 1. Update tone stats
            m_ja = JA_END_RE.search(orig)
            m_ko = KO_END_RE.search(trans)
            if m_ja and m_ko:
                ja_e = m_ja.group(1)
                ko_e = m_ko.group(1)
                cursor.execute("""
                    INSERT INTO corpus_tone_stats (folder_name, is_dialogue, ja_ending, ko_ending, count, probability)
                    VALUES (?, ?, ?, ?, 1, 1.0)
                    ON CONFLICT(id) DO UPDATE SET count = count + 1;
                """, (folder, is_dialogue, ja_e, ko_e))

            # 2. Update frequent template
            ja_c = _clean_text(orig)
            ko_c = _clean_text(trans)
            if 4 <= len(ja_c) <= 60:
                cursor.execute("""
                    INSERT INTO corpus_templates (ja_clean, ko_clean, original, translated, frequency, folder_name)
                    VALUES (?, ?, ?, ?, 1, ?)
                """, (ja_c, ko_c, orig, trans, folder))

            conn.commit()
    except Exception:
        # Non-critical background task; ignore errors
        pass

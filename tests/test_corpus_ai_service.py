"""
Unit & Performance tests for Corpus AI Service.
"""

import sys
import io
import time
import pytest

from server.services.corpus_ai_service import (
    synthesize_translation,
    suggest_next_phrase,
    check_style_consistency,
    sync_translation_to_corpus,
)


def test_synthesize_translation_tier1():
    t0 = time.time()
    res = synthesize_translation("「くっ……殺せ！」")
    duration_ms = (time.time() - t0) * 1000

    assert res["synthesized_text"] != ""
    assert res["tier_used"] in ("tier1_exact", "tier1_template")
    assert res["confidence"] >= 75.0
    assert duration_ms < 50.0  # Must be faster than 50ms (0.05s)


def test_synthesize_translation_tier2():
    t0 = time.time()
    # Complex or novel combined sentence
    res = synthesize_translation("魔族の命令で勇者が立ち上がった。")
    duration_ms = (time.time() - t0) * 1000

    assert res["tier_used"] in ("tier1_template", "tier2_phrase_stitching")
    assert duration_ms < 50.0


def test_suggest_next_phrase():
    t0 = time.time()
    res = suggest_next_phrase("魔族の軍勢", "마족")
    duration_ms = (time.time() - t0) * 1000

    assert "prefix" in res
    assert duration_ms < 50.0


def test_check_style_consistency():
    t0 = time.time()
    res = check_style_consistency("「そうじゃな、行こうか」", "「그래, 가자」")
    duration_ms = (time.time() - t0) * 1000

    assert res["color"] in ("green", "yellow", "red")
    assert duration_ms < 50.0


def test_sync_translation_to_corpus():
    # Should run cleanly without exceptions
    sync_translation_to_corpus("彼女は微笑んだ。", "그녀는 미소 지었다.", "test_folder")


if __name__ == "__main__":
    test_synthesize_translation_tier1()
    test_synthesize_translation_tier2()
    test_suggest_next_phrase()
    test_check_style_consistency()
    test_sync_translation_to_corpus()
    print("All tests passed successfully!")

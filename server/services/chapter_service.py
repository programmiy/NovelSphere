"""
Chapter title cleaning and normalization service.
Extracts pure episode/chapter titles by stripping novel titles, author names,
and platform suffixes (e.g. Kakuyomu, Syosetu, NovelUp).
"""

import re
from typing import Optional


def clean_chapter_title(title: Optional[str], url: Optional[str] = None) -> Optional[str]:
    """
    웹 소설 사이트의 제목에서 소설 제목, 작가명, 사이트명(- カクヨム 등) 접미사를 정제하여
    순수 회차(에피소드) 제목을 추출합니다.
    """
    if not title:
        return title
    t = title.strip()

    # 1. Kakuyomu patterns
    if (url and 'kakuyomu.jp' in url) or '- カクヨム' in t:
        t = re.sub(r'\s*-\s*カクヨム.*$', '', t, flags=re.IGNORECASE).strip()
        parts = re.split(r'\s*-\s*', t)
        if len(parts) > 1 and parts[0].strip():
            return parts[0].strip()
        return t

    # 2. Syosetu patterns
    if (url and ('syosetu.com' in url or 'novel18.syosetu.com' in url)) or '- 小説家になろう' in t:
        t = re.sub(
            r'\s*-\s*(小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ).*$',
            '',
            t,
            flags=re.IGNORECASE
        ).strip()
        parts = re.split(r'\s*-\s*', t)
        if len(parts) > 1 and parts[-1].strip():
            return parts[-1].strip()
        return t

    # 3. NovelUp patterns
    if (url and 'novelup.plus' in url) or 'ノベルアップ' in t:
        t = re.sub(r'\s*\|\s*小説投稿サイトノベルアップ.*$', '', t, flags=re.IGNORECASE).strip()
        parts = re.split(r'\s*-\s*', t)
        if len(parts) > 1 and parts[-1].strip():
            return parts[-1].strip()
        return t

    # 4. General fallback: strip known site suffixes
    t = re.sub(
        r'\s*-\s*(カクヨム|小説家になろう|ノクターンノベルズ|ムーンライトノベルズ|ミッドナイトノベルズ|ノベルアップ).*$',
        '',
        t,
        flags=re.IGNORECASE
    ).strip()
    return t or title

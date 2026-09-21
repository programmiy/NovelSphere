import re
from urllib.parse import urlparse, urlunparse

def normalize_url(url: str) -> str:
    if not url:
        return ""
    
    url = str(url).strip().split('#')[0]
    parsed = urlparse(url)
    if not parsed.netloc and not parsed.path:
        return url
        
    scheme = parsed.scheme.lower() if parsed.scheme else 'https'
    netloc = parsed.netloc.lower()
    path = parsed.path
    if path and path != '/':
        path = path.rstrip('/')
        
    return urlunparse((scheme, netloc, path, parsed.params, parsed.query, ''))

import unicodedata

def natural_sort_key(s: str):
    """
    자연 정렬(Natural Sort) 키 함수.
    전각 숫자(０１２ 등)를 반각(012)으로 정규화(NFKC)하고,
    숫자 부분을 int로 변환하여 001 -> 002 -> ... -> 010 -> ... -> 100 -> 101 순서로 올바르게 정렬합니다.
    """
    if not s:
        return []
    normalized = unicodedata.normalize('NFKC', str(s))
    return [int(text) if text.isdigit() else text.lower() for text in re.split(r'(\d+)', normalized)]


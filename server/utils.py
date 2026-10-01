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


def get_url_variants(url: str) -> list:
    """
    URL의 http/https, www/non-www, trailing slash 조합 모든 변형을 반환합니다.
    DB 조회 시 URL 정규화 불일치를 방지하기 위해 사용됩니다.
    """
    if not url:
        return []
    url = str(url).strip().split('#')[0]
    no_protocol = re.sub(r'^https?://', '', url).rstrip('/')

    variants = set()
    for scheme in ('http://', 'https://'):
        base = scheme + no_protocol
        variants.add(base)
        variants.add(base + '/')
        if no_protocol.startswith('www.'):
            no_www = no_protocol[4:]
            variants.add(scheme + no_www)
            variants.add(scheme + no_www + '/')
        else:
            www_base = scheme + 'www.' + no_protocol
            variants.add(www_base)
            variants.add(www_base + '/')
    return list(variants)

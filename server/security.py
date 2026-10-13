import hashlib
import hmac
import ipaddress
import secrets
from typing import Optional
from urllib.parse import urlparse


def hash_token(token: str, iterations: int = 100_000, salt: Optional[str] = None) -> str:
    """
    PBKDF2-HMAC-SHA256 기반 단방향 암호화 해시 생성.
    평문 토큰을 서버에 직접 저장하지 않고 10만 회 반복 연산된 솔트 해시로 안전하게 보관합니다.
    """
    if not token:
        raise ValueError("Token cannot be empty")
    
    salt_val = salt or secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        token.encode("utf-8"),
        salt_val.encode("utf-8"),
        iterations,
    ).hex()
    return f"pbkdf2_sha256${iterations}${salt_val}${derived}"


def verify_token(provided_token: Optional[str], stored_hash_or_token: Optional[str]) -> bool:
    """
    제공된 토큰과 저장된 해시(또는 레거시 평문 토큰)를 타이밍 공격(Timing Attack)에 안전한
    상수 시간 비교(hmac.compare_digest)로 검증합니다.
    """
    if not provided_token or not stored_hash_or_token:
        return False

    clean_provided = provided_token.strip()
    clean_stored = stored_hash_or_token.strip()

    # 1. PBKDF2 단방향 암호화 해시 포맷 검증 (권장)
    if clean_stored.startswith("pbkdf2_sha256$"):
        parts = clean_stored.split("$")
        if len(parts) == 4:
            try:
                iterations = int(parts[1])
                salt_val = parts[2]
                expected_hash = parts[3]
                computed = hashlib.pbkdf2_hmac(
                    "sha256",
                    clean_provided.encode("utf-8"),
                    salt_val.encode("utf-8"),
                    iterations,
                ).hex()
                return hmac.compare_digest(computed, expected_hash)
            except Exception:
                return False

    # 2. 레거시 평문 토큰 하위 호환성 (상수 시간 비교)
    return hmac.compare_digest(clean_provided.encode("utf-8"), clean_stored.encode("utf-8"))


def is_safe_external_url(url: str) -> bool:
    """
    SSRF(서버 사이드 요청 위조) 방어:
    http/https 스킴만 허용하고, 루프백/사설망(127.0.0.1, localhost, 192.168.x 등) IP 및
    내부망 특수 도메인(.local, .internal 등) 접근을 차단합니다.
    """
    if not url:
        return False
    try:
        parsed = urlparse(url)
        if parsed.scheme.lower() not in ("http", "https"):
            return False
        hostname = (parsed.hostname or "").strip().lower()
        if not hostname or hostname in ("localhost", "127.0.0.1", "::1", "0.0.0.0"):
            return False
        
        # IP 주소인 경우 사설/루프백/링크로컬 검사
        try:
            ip = ipaddress.ip_address(hostname)
            if ip.is_private or ip.is_loopback or ip.is_link_local or ip.is_reserved or ip.is_unspecified:
                return False
        except ValueError:
            # 도메인 네임 검사
            if hostname.endswith(".local") or hostname.endswith(".internal") or hostname.endswith(".lan"):
                return False
        return True
    except Exception:
        return False

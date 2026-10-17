import sqlite3
import re
import sys
import os
import time

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server', 'translations.db')

def restore_punctuation_only(orig: str, trans: str) -> str:
    """
    글자(의성어, 웃음소리, 감탄사 등)는 일절 추가하거나 추정하지 않고,
    오직 순수 문장부호/기호(말줄임표, 대시 구분선, 다중괄호 찌꺼기, 방점 등)만 안전하게 복원합니다.
    글자 반복이 포함되어 있어 불완전한 건은 '(반복)'을 남겨 두어 후속 필터에서 걸러냅니다.
    """
    res = trans

    # 0. 다중 대시 구분선: ―――――あとがき――――― -> ――――――후기――――――
    if ('―' in orig or '—' in orig or '-' in orig) and '(반복)' in res:
        dash_match = re.search(r'([―—-]{4,})', orig)
        if dash_match:
            dash_sym = '――――――'
            if res.startswith('(반복)') and res.endswith('(반복)'):
                res = dash_sym + res[4:-4] + dash_sym
            res = res.replace('(반복)', dash_sym)

    # 1. 다중 괄호 충돌 찌꺼기: 「「「(반복) 또는 (반복)」」」
    res = re.sub(r'([「『]{2,})\(반복\)', r'\1', res)
    res = re.sub(r'\(반복\)([」』]{2,})', r'\1', res)
    res = re.sub(r'([「『])\(반복\)(……|[…\.]+)', r'\1\2', res)
    res = re.sub(r'(……|[…\.]+)\(반복\)([」』])', r'\1\2', res)

    # 2. 방점 표기 충돌: ((반복)) or （(반복)） -> (……)
    if '((반복))' in res or '（(반복)）' in res:
        res = res.replace('((반복))', '(……)').replace('（(반복)）', '(……)')

    # 3. 원문이 순수 문장부호/기호로만 구성된 경우 (예: 「……………」 -> 「……」)
    if re.fullmatch(r'[「『（\(\[\{]*[……\.!?！？~～―ー\-❤\s]+[」』）\)\]\}]*', orig):
        res = re.sub(r'\(반복\)', '……', res)
        if '!' in orig or '！' in orig:
            res = res.replace('……', '!!!!!!')
        elif '?' in orig or '？' in orig:
            res = res.replace('……', '??????')
        elif '―' in orig or 'ー' in orig or '-' in orig:
            res = res.replace('……', '――――')

    # 4. 말줄임표 ... / …… 관련 기호 위치 복원
    if '……' in orig or '…' in orig or '..' in orig:
        res = re.sub(r'([「『\(（])\(반복\)', r'\1……', res)
        res = re.sub(r'\(반복\)([」』\)）])', r'……\1', res)
        res = re.sub(r'^\(반복\)', r'……', res)
        res = re.sub(r'\(반복\)\s*……', r'……', res)
        res = re.sub(r'……\s*\(반복\)', r'……', res)
        # 단어 사이나 뒤에 말줄임표가 있던 자리 (글자 추가 없이 기호만 삽입)
        res = re.sub(r'([가-힣\w])\(반복\)(\s+[가-힣\w])', r'\1……\2', res)
        res = re.sub(r'([가-힣\w])\(반복\)$', r'\1……', res)

    # 5. 느낌표/물음표/물결표 부호 복원
    if '!' in orig or '！' in orig:
        res = re.sub(r'([!！]+)\(반복\)', r'\1!', res)
        res = re.sub(r'\(반복\)([!！]+)', r'!\1', res)
        res = re.sub(r'([가-힣\w])\(반복\)([!！]+)', r'\1\2', res)
    if '?' in orig or '？' in orig:
        res = re.sub(r'([?？]+)\(반복\)', r'\1?', res)
        res = re.sub(r'\(반복\)([?？]+)', r'?\1', res)
    if '~' in orig or '～' in orig:
        res = re.sub(r'([~～]+)\(반복\)', r'\1~', res)
        res = re.sub(r'\(반복\)([~～]+)', r'~\1', res)

    # 중복 기호 정리
    res = re.sub(r'…{3,}', '……', res)

    return res

def stage_punctuation_fixes_to_special_batch(batch_id: str = "batch_repeat_punct_fix_20261017"):
    """
    실행 시 'translations' 테이블에서 '(반복)'이 포함된 항목을 검색하고,
    글자 변형 없이 '문장부호만 반복되는 것'만 안전하게 복원하여
    'special_batch_queue' 테이블에 'staged' 상태로 적재합니다.
    """
    if not os.path.exists(DB_PATH):
        print(f"Error: DB not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    # special_batch_queue 테이블 존재 여부 확인
    c.execute("SELECT count(*) FROM sqlite_master WHERE type='table' AND name='special_batch_queue'")
    if c.fetchone()[0] == 0:
        print("Error: 'special_batch_queue' table does not exist.")
        conn.close()
        return

    c.execute("""
        SELECT id, url, pid, folderName, title, original, translated
        FROM translations
        WHERE translated LIKE '%(반복)%'
    """)
    rows = c.fetchall()
    print(f"[분석 시작] '(반복)' 포함 문단 총: {len(rows)}건")

    staged_records = []
    skipped_letter_cases = 0

    now_ms = int(time.time() * 1000)

    for r in rows:
        r_id, url, pid, folder_name, title, orig, trans = r
        fixed = restore_punctuation_only(orig, trans)

        # 글자/의성어 개입 없이 문장부호만으로 깔끔하게 해소된 건만 선택
        if '(반복)' not in fixed and fixed != trans:
            staged_records.append((
                batch_id,
                url,
                folder_name or "Unknown",
                title or "",
                0,
                pid,
                orig,
                fixed,
                "staged",
                now_ms,
                None
            ))
        else:
            skipped_letter_cases += 1

    print(f"[필터링 결과]")
    print(f" - 문장부호 순수 복원 대상 (적재 대상): {len(staged_records)}건")
    print(f" - 글자/의성어 포함 건 (사용자 직접 수정을 위해 보존 및 스킵): {skipped_letter_cases}건")

    if not staged_records:
        print("적재할 대상이 없습니다.")
        conn.close()
        return

    # 이미 동일 batch_id로 적재된 데이터가 있는지 확인
    c.execute("SELECT count(*) FROM special_batch_queue WHERE batch_id = ?", (batch_id,))
    existing_in_batch = c.fetchone()[0]
    if existing_in_batch > 0:
        print(f"[알림] batch_id='{batch_id}'에 이미 {existing_in_batch}건이 적재되어 있습니다. 기존 데이터를 갱신합니다.")
        c.execute("DELETE FROM special_batch_queue WHERE batch_id = ?", (batch_id,))

    # 특별적재 큐에 삽입
    c.executemany("""
        INSERT INTO special_batch_queue (
            batch_id, url, folder_name, chapter_title, chapter_index,
            pid, original_text, translated_text, status, created_at, promoted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, staged_records)
    conn.commit()

    c.execute("SELECT count(*) FROM special_batch_queue WHERE batch_id = ?", (batch_id,))
    final_count = c.fetchone()[0]
    print(f"==> [성공] special_batch_queue에 총 {final_count}건이 성공적으로 적재되었습니다! (batch_id: {batch_id})")

    conn.close()

if __name__ == '__main__':
    stage_punctuation_fixes_to_special_batch()

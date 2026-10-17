import sqlite3
import re
import sys
import os
import time

sys.stdout.reconfigure(encoding='utf-8')

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'server', 'translations.db')

LETTER_REGEX = re.compile(r'[a-zA-Z\uac00-\ud7a3\u3040-\u309f\u30a0-\u30fb\u30fd-\u30ff\u4e00-\u9faf]', re.UNICODE)

def extract_original_symbol_repeats(orig: str):
    """
    원문에서 반복된 구간을 추출하되, 글자 반복과 기호 반복을 구분합니다.
    """
    repeats = []
    
    # 1. 말줄임표 ……
    for m in re.finditer(r'……+|…{2,}|\.{3,}', orig):
        repeats.append({'text': m.group(0), 'type': 'symbol', 'start': m.start(), 'end': m.end()})
        
    # 2. 방점 기호 (・・・・ 또는 、、、、)
    for m in re.finditer(r'・{3,}|、{3,}', orig):
        repeats.append({'text': m.group(0), 'type': 'symbol', 'start': m.start(), 'end': m.end()})

    # 3. 대시/구분선 기호 (―――― 또는 ーーーー 등)
    for m in re.finditer(r'[―—-]{3,}', orig):
        repeats.append({'text': m.group(0), 'type': 'symbol', 'start': m.start(), 'end': m.end()})

    # 4. 물결표 (～～～～)
    for m in re.finditer(r'[~～]{3,}', orig):
        repeats.append({'text': m.group(0), 'type': 'symbol', 'start': m.start(), 'end': m.end()})

    # 5. 일반 문자 3회 이상 반복
    for m in re.finditer(r'(.)\1{2,}', orig):
        if any(r['start'] <= m.start() < r['end'] for r in repeats):
            continue
        ch = m.group(1)
        is_letter = bool(LETTER_REGEX.match(ch))
        repeats.append({
            'text': m.group(0),
            'type': 'letter' if is_letter else 'symbol',
            'start': m.start(),
            'end': m.end()
        })

    repeats.sort(key=lambda x: x['start'])
    return repeats

def copy_paste_symbols_only(orig: str, trans: str) -> str:
    """
    룰베이스 치환(임의 기호 대체 등)을 하지 않고,
    원문(original)의 기호 문자열을 그대로 복사하여 번역문의 '(반복)' 자리에 1:1로 복붙합니다.
    글자 반복이거나 의성어/웃음소리 등은 일체 건드리지 않고 원본 그대로 유지합니다.
    """
    res = trans

    # 1. 다중 괄호 충돌 찌꺼기 제거: 「「「(반복) 또는 (반복)」」」
    if re.search(r'[「『]{2,}\(반복\)|\(반복\)[」』]{2,}', res):
        res = re.sub(r'([「『]{2,})\(반복\)', r'\1', res)
        res = re.sub(r'\(반복\)([」』]{2,})', r'\1', res)
        if '(반복)' not in res:
            return res

    # 2. 원문이 100% 순수 문장부호/기호로만 이루어진 문장: 원문 그대로 복붙
    orig_pure_letters = LETTER_REGEX.findall(orig)
    if not orig_pure_letters or orig_pure_letters in (['っ'], ['ッ']):
        if '읏' in res or '윽' in res:
            sym_part = re.sub(r'[「」『』っッ]', '', orig)
            if orig.startswith('「') and orig.endswith('」'):
                return f"「읏{sym_part}」" if orig.startswith('「っ') else f"「{sym_part}읏」"
            return f"읏{sym_part}"
        else:
            return orig

    # 3. 방점 표기: 원문에 （・・・・） 또는 （、、、、）가 있는 경우 원문 방점 기호 그대로 복붙
    if '((반복))' in res and '・・・・' in orig:
        res = res.replace('((반복))', '(・・・・)')
        if '(반복)' not in res:
            return res
    if '((반복))' in res and '、、、、' in orig:
        res = res.replace('((반복))', '(、、、、)')
        if '(반복)' not in res:
            return res

    # 4. 원문에서 반복 구간 추출
    orig_repeats = extract_original_symbol_repeats(orig)
    
    # 원문에 글자 반복이 포함되어 있다면 일체 손대지 않음 (사용자 직접 수정용)
    if any(r['type'] == 'letter' for r in orig_repeats):
        return trans

    # 오직 순수 기호 반복만 있는 경우
    symbol_repeats = [r for r in orig_repeats if r['type'] == 'symbol']
    placeholder_count = res.count('(반복)')

    # 1:1 개수가 일치하는 경우 원문 기호 텍스트를 그대로 복사하여 삽입
    if len(symbol_repeats) == placeholder_count and placeholder_count > 0:
        parts = res.split('(반복)')
        new_parts = []
        for i, part in enumerate(parts):
            new_parts.append(part)
            if i < len(symbol_repeats):
                # 원문 기호를 그대로 복붙!
                new_parts.append(symbol_repeats[i]['text'])
        res = "".join(new_parts)

    return res

def stage_exact_symbol_copypaste(batch_id: str = "batch_repeat_punct_fix_20261017"):
    """
    원문의 순수 기호만 그대로 복붙한 결과만을 special_batch_queue에 적재합니다.
    """
    if not os.path.exists(DB_PATH):
        print(f"Error: DB not found at {DB_PATH}")
        return

    conn = sqlite3.connect(DB_PATH)
    c = conn.cursor()

    c.execute("""
        SELECT id, url, pid, folderName, title, original, translated
        FROM translations
        WHERE translated LIKE '%(반복)%'
    """)
    rows = c.fetchall()
    print(f"[분석 시작] '(반복)' 포함 전체 문단: {len(rows)}건")

    staged_records = []
    skipped_count = 0
    now_ms = int(time.time() * 1000)

    for r in rows:
        r_id, url, pid, folder_name, title, orig, trans = r
        fixed = copy_paste_symbols_only(orig, trans)

        # '(반복)'이 원문 기호로 100% 깔끔하게 대체된 건만 적재
        if fixed != trans and '(반복)' not in fixed:
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
            skipped_count += 1

    print(f"[원문 기호 직접 복붙 결과]")
    print(f" - 순수 원문 기호 복붙 완료 (적재 대상): {len(staged_records)}건")
    print(f" - 글자/의성어 반복 건 (일체 변경 없이 100% 보존): {skipped_count}건")

    if not staged_records:
        print("적재할 대상이 없습니다.")
        conn.close()
        return

    # 기존 배치 큐 초기화 후 신규 적재
    c.execute("DELETE FROM special_batch_queue WHERE batch_id = ?", (batch_id,))
    c.executemany("""
        INSERT INTO special_batch_queue (
            batch_id, url, folder_name, chapter_title, chapter_index,
            pid, original_text, translated_text, status, created_at, promoted_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    """, staged_records)
    conn.commit()

    c.execute("SELECT count(*) FROM special_batch_queue WHERE batch_id = ?", (batch_id,))
    final_count = c.fetchone()[0]
    print(f"==> [성공] special_batch_queue에 순수 원문 기호 복붙 {final_count}건이 적재되었습니다! (batch_id: {batch_id})")

    conn.close()

if __name__ == '__main__':
    stage_exact_symbol_copypaste()

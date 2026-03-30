import sqlite3
import re
import os

def map_and_fix_repeats_with_fallback():
    db_path = os.path.join(os.path.dirname(__file__), 'translations.db')
    conn = sqlite3.connect(db_path, timeout=15)
    conn.row_factory = sqlite3.Row
    cursor = conn.cursor()

    try:
        cursor.execute("SELECT id, original, translated, folderName, title, pid FROM translations WHERE translated LIKE '%(반복)%'")
        records = cursor.fetchall()

        letter_pattern = re.compile(r'[a-zA-Z\uac00-\ud7a3\u3040-\u309f\u30a0-\u30fb\u30fd-\u30ff\u4e00-\u9faf]', re.UNICODE)
        repeat_pattern = re.compile(r'(.)\1{3,}')
        special_patterns = ['……']

        updates_to_make = []
        changed_logs = []
        skipped_logs = []

        for record in records:
            original_text = record['original']
            translated_text = record['translated']
            made_change = False
            new_translated = ""

            # --- Start of repeat detection logic ---
            found_repeats = []
            placeholder_char = '\u0000'
            temp_original = original_text

            for pattern in special_patterns:
                start_index = 0
                while True:
                    start_index = temp_original.find(pattern, start_index)
                    if start_index == -1:
                        break
                    found_repeats.append({'text': pattern, 'type': 'symbol', 'start': start_index})
                    temp_original = temp_original[:start_index] + (placeholder_char * len(pattern)) + temp_original[start_index + len(pattern):]
                    start_index += len(pattern)

            for match in repeat_pattern.finditer(temp_original):
                char = match.group(1)
                is_letter = bool(letter_pattern.match(char))
                found_repeats.append({'text': match.group(0), 'type': 'letter' if is_letter else 'symbol', 'start': match.start()})

            found_repeats.sort(key=lambda x: x['start'])
            original_repeats = found_repeats
            # --- End of repeat detection logic ---

            placeholder_count = translated_text.count('(반복)')

            if len(original_repeats) != placeholder_count:
                # --- Start of Mismatch Fallback Logic ---
                if '……' in original_text and '(반복)' in translated_text:
                    new_translated = translated_text.replace('(반복)', '……')
                    made_change = True
                else:
                    skipped_logs.append(f"ID {record['id']}: 원본 반복 {len(original_repeats)}개, 번역문 (반복) {placeholder_count}개로 개수 불일치")
                # --- End of Mismatch Fallback Logic ---
            elif original_repeats: # Counts match and there are repeats to process
                new_translated_parts = []
                split_parts = translated_text.split('(반복)')
                
                for i, part in enumerate(split_parts):
                    new_translated_parts.append(part)
                    if i < len(original_repeats):
                        repeat_info = original_repeats[i]
                        if repeat_info['type'] == 'symbol':
                            new_translated_parts.append(repeat_info['text'])
                            made_change = True
                        else:
                            new_translated_parts.append('(반복)')
                
                new_translated = "".join(new_translated_parts)

            if made_change:
                updates_to_make.append((new_translated, record['id']))
                changed_logs.append({
                    'id': record['id'],
                    'folderName': record['folderName'],
                    'title': record['title'],
                    'pid': record['pid'],
                    'original': original_text,
                    'old_translated': translated_text,
                    'new_translated': new_translated
                })

        if not updates_to_make:
            print("수정할 항목을 찾지 못했습니다.")
        else:
            cursor.executemany("UPDATE translations SET translated = ? WHERE id = ?", updates_to_make)
            conn.commit()
            print(f"--- 총 {len(updates_to_make)}개의 항목을 수정했습니다. ---\n")
            for log in changed_logs:
                print("--------------------------------------------------")
                print(f"Folder: {log['folderName']} | Title: {log['title']} | PID: {log['pid']} (ID: {log['id']})")
                print(f"Original:   {log['original']}")
                print(f"Before:     {log['old_translated']}")
                print(f"After:      {log['new_translated']}")
            print("--------------------------------------------------\n")

        if skipped_logs:
            print(f"--- {len(skipped_logs)}개의 항목을 건너뛰었습니다 (개수 불일치). ---")
            for log in skipped_logs:
                print(log)

    except Exception as e:
        print(f"오류가 발생했습니다: {e}")
        conn.rollback()
    finally:
        conn.close()

if __name__ == "__main__":
    map_and_fix_repeats_with_fallback()
import sqlite3
import os

def update_translations():
    db_path = os.path.join('server', 'translations.db')
    
    if not os.path.exists(db_path):
        print(f"데이터베이스 파일을 찾을 수 없습니다: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        # 원문이 '海山'인 모든 번역문을 가져옵니다.
        cursor.execute("SELECT id, translated FROM translations WHERE original LIKE ?", ('%海山%',))
        rows = cursor.fetchall()

        updates_to_make = []
        for row in rows:
            row_id, translated_text = row
            if translated_text and ('해산' in translated_text or '우미야마' in translated_text or '카이야마' in translated_text):
                new_translated_text = translated_text.replace('해산', '미야마').replace('우미야마', '미야마').replace('카이야마', '미야마').replace('카이잔', '미야마')
                if new_translated_text != translated_text:
                    updates_to_make.append((new_translated_text, row_id))

        if updates_to_make:
            print(f"{len(updates_to_make)}개의 항목을 업데이트합니다.")
            cursor.executemany("UPDATE translations SET translated = ? WHERE id = ?", updates_to_make)
            conn.commit()
            print("데이터베이스 업데이트가 성공적으로 완료되었습니다.")
        else:
            print("업데이트할 항목을 찾지 못했습니다.")

    except sqlite3.Error as e:
        print(f"데이터베이스 오류: {e}")
    except Exception as e:
        print(f"오류가 발생했습니다: {e}")
    finally:
        if conn:
            conn.close()
            print("데이터베이스 연결이 닫혔습니다.")

def check_original_entries():
    db_path = os.path.join('server', 'translations.db')
    
    if not os.path.exists(db_path):
        print(f"데이터베이스 파일을 찾을 수 없습니다: {db_path}")
        return

    conn = sqlite3.connect(db_path)
    cursor = conn.cursor()

    try:
        print("Checking for entries where 'original' contains '海山' (LIMIT 10):")
        cursor.execute("SELECT id, original, translated FROM translations WHERE original LIKE ? LIMIT 10", ('%海山%',))
        rows = cursor.fetchall()

        if rows:
            for row in rows:
                print(f"ID: {row[0]}, Original: {row[1]}, Translated: {row[2]}")
        else:
            print("No entries found where 'original' contains '海山'.")

    except sqlite3.Error as e:
        print(f"데이터베이스 오류: {e}")
    except Exception as e:
        print(f"오류가 발생했습니다: {e}")
    finally:
        if conn:
            conn.close()
            print("데이터베이스 연결이 닫혔습니다.")

        cursor.execute("SELECT id, translated FROM translations WHERE original LIKE ?", ('%海山%',))

if __name__ == '__main__':
    update_translations() # Run the update
    # check_original_entries() # Commented out after debugging
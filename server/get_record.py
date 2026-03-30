import sqlite3
import os

def get_record_by_id_to_file(record_id):
    db_path = os.path.join(os.path.dirname(__file__), 'translations.db')
    output_filename = os.path.join(os.path.dirname(__file__), f'record_{record_id}.txt')
    conn = None
    try:
        conn = sqlite3.connect(db_path)
        conn.row_factory = sqlite3.Row
        cursor = conn.cursor()

        cursor.execute("SELECT id, original, translated, folderName, title, pid FROM translations WHERE id = ?", (record_id,))
        record = cursor.fetchone()

        with open(output_filename, 'w', encoding='utf-8') as f:
            if not record:
                f.write(f"ID {record_id}에 해당하는 기록을 찾을 수 없습니다.")
                print(f"결과를 {output_filename} 에 저장했습니다.")
                return

            f.write(f"--- ID {record['id']} 상세 정보 ---\n")
            f.write(f"Folder: {record['folderName']}\n")
            f.write(f"Title: {record['title']}\n")
            f.write(f"PID: {record['pid']}\n")
            f.write(f"Original:   {record['original']}\n")
            f.write(f"Translated: {record['translated']}\n")
            f.write("------------------------\n")
        
        print(f"조회 결과를 {output_filename} 에 성공적으로 저장했습니다.")

    except Exception as e:
        print(f"오류가 발생했습니다: {e}")
    finally:
        if conn:
            conn.close()

if __name__ == "__main__":
    target_id = input("조회할 기록의 ID를 입력하세요: ")
    get_record_by_id_to_file(target_id)
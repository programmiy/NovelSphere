import sqlite3

conn = sqlite3.connect('server/translations.db')
c = conn.cursor()
c.execute("""
UPDATE ai_review_queue 
SET ai_translated_text = REPLACE(ai_translated_text, '타카치', '타캇치')
WHERE status = 'pending_review' AND ai_translated_text LIKE '%타카치%'
""")
conn.commit()
print('Updated rows in ai_review_queue:', c.rowcount)
conn.close()

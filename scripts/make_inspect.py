import sys
import json

infile = sys.argv[1]
outfile = sys.argv[2]

with open(infile, 'r', encoding='utf-8') as f:
    data = json.load(f)

with open(outfile, 'w', encoding='utf-8') as f:
    for i, x in enumerate(data):
        f.write(f"[{i+1}] ID:{x['id']} | {x['title']}\nORIG: {x['original']}\nCURR: {x['translated']}\n\n")

print(f"Dumped {len(data)} items to {outfile}")

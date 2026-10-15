import json, re

with open(r'C:\Users\parkp\.gemini\antigravity\brain\a8d3f8a0-8476-4115-99cc-0cbb71773beb\.system_generated\steps\196\content.md', 'r', encoding='utf-8') as f:
    text = f.read()

m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', text)
if m:
    data = json.loads(m.group(1))
    apollo = data.get('props', {}).get('pageProps', {}).get('__APOLLO_STATE__', {})
    w = apollo.get('Work:16818093073317257284', {})
    with open(r'C:\LANOVEL\scripts\maid_summary.txt', 'w', encoding='utf-8') as out:
        out.write(f"Title: {w.get('title')}\n")
        out.write(f"Catchphrase: {w.get('catchphrase')}\n")
        out.write(f"Intro: {w.get('introduction')}\n")
    print("Done writing target maid work")

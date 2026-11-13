# -*- coding: utf-8 -*-
import os
import sys

if sys.platform == "win32":
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

APP_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if APP_ROOT not in sys.path:
    sys.path.insert(0, APP_ROOT)

from scripts.fetch_unreviewed import get_items
from scripts.insert_reviewed_items import insert_reviewed
from server.rule_classifier import classify_translation

# 832968은 원문 하트 배열에 맞춘 깔끔한 복원문 생성
TRANSLATIONS_21 = {
    760147: "「헤에……」",
    823503: "「졸려 보이는 건 알겠지만 말야.」",
    832187: "「현대 축구는 피지컬 지상주의야. 너처럼 가벼운 선수가 이길 수 있을 만큼 만만하지 않다고.」",
    832968: (
        "「" + "♥" * 40 + "파아" + "♥" * 40 + "으응" + "♥" * 40 + "르릇" + "♥" * 40 + "응, 포오오옷" + "♥" * 40 + "」"
    ),
    836256: "초특급 미소녀가 같은 방에 있다는데도, 나의 QOSL(성생활의 질)은 현저히 저하되어 있다. 어째서야.",
    885326: "「……에?」",
    887755: "――나도 데려가 줘 끝――",
    895498: "「이쪽은 제 친구 이오리입니다.」",
    895603: "경솔하게 굴지 마, 성급하게 굴지 마, 섣불리 나서지 마!",
    895623: "「헤이, 콕스 이오리! 만나서 반가워!」",
    897718: "「카펜터즈의 톱 오브 더 월드」",
    898069: "『어째서 마지막 곡을 톱 오브 더 월드로 한 걸까?』",
    904046: "「알아보기 힘드네.」",
    909901: "“괜찮다니, 뭐가?”",
    909903: "“여기에 오는 건 오랜만이네.”",
    910372: "“유두, 기분 좋아……”",
    911608: "“그럼…… 린카 방으로 와.”",
    911916: "“정말 아빠 말대로였어……”",
    963860: "「이이다.」",
    1005661: "「♪자극을 원해, 아훗! ♪유리 다루듯 하지 마 아앗…… ♪좋아한다면 할 수 있잖아 버닝 러브~ 하응!」",
    1028144: "지금의 이요기 씨는 꽤나 편한 복장을 하고 있어서, 나로서는 여러모로 참아야만 하는데…….",
}


def run_step1():
    items, _ = get_items(limit=5000)
    by_id = {x["id"]: x for x in items}
    to_insert = []

    for tid, text in TRANSLATIONS_21.items():
        it = by_id.get(tid)
        if not it:
            print(f"WARNING: ID {tid} not found in unreviewed items (already queued?)")
            continue
        cls_res = classify_translation(it["original"], text)
        if cls_res != "normal":
            raise ValueError(f"ID {tid} failed normal check: {cls_res} -> {text}")
        to_insert.append({"id": tid, "reviewed_translation": text})

    print(f"Verified {len(to_insert)} other_language items as normal.")
    cnt = insert_reviewed(to_insert, model_name="Antigravity-AI")
    print(f"SUCCESS: Inserted {cnt} items!")


if __name__ == "__main__":
    run_step1()

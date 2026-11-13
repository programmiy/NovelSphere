# -*- coding: utf-8 -*-
import os
import re
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
from server.routers.ai_review import clean_ai_translation
from server.rule_classifier import classify_translation

CJK_PATTERN = re.compile(r"[\u3040-\u309f\u30a0-\u30fa\u30fd-\u30ff\u4e00-\u9faf\u3400-\u4dbf]")

# 1) ~っち 호칭 (사이시옷 규칙 준수) - 긴 패턴 우선
TCHI_REPLACEMENTS = [
    ("하즈키っち", "하즈킷치"),
    ("하즈키 っち", "하즈킷치"),
    ("하자키っち", "하즈킷치"),
    ("하자키 っち", "하즈킷치"),
    ("아츠야っち", "아츠얏치"),
    ("아츠야 っち", "아츠얏치"),
    ("미코토っち", "미코톳치"),
    ("히로토っち", "히로톳치"),
    ("미즈키っち", "미즈킷치"),
    ("미즈키 っち", "미즈킷치"),
    ("미나っち", "미낫치"),
    ("사요っち", "사욧치"),
    ("아오っち", "아옷치"),
    ("무라っち", "무랏치"),
    ("유리っち", "유릿치"),
    ("리리っち", "리릿치"),
    ("리리 っち", "리릿치"),
    ("모에っち", "모엣치"),
    ("카오っち", "카옷치"),
]

# 2) 상용구 및 외래어 조각 치환 (반드시 소형 가나/촉음 제거 전에 수행)
PHRASE_REPLACEMENTS = [
    ("그どころか는", "그뿐만 아니라"),
    ("그どころか", "그뿐만이 아니라"),
    ("どころか", "커녕"),
    ("だ、だって", "그, 그야"),
    ("だって", "그야"),
    ("そろそろ", "슬슬"),
    ("確かに", "확실히"),
    ("いわゆる", "이른바"),
    ("いわば", "말하자면"),
    ("유즈키는というと", "유즈키는 어떠냐 하면"),
    ("나는というと", "나는 어떠냐 하면"),
    ("쪽은というと", "쪽은 어떠냐 하면"),
    ("というか", "라기보다"),
    ("というと", "로 말할 것 같으면"),
    ("というわけで", "그리하여"),
    ("그런わけで", "그런 이유로"),
    ("わけで", "셈이어서"),
    ("それを皮切りに", "그것을 시작으로"),
    ("それにしても", "그나저나"),
    ("だからこそ", "그렇기에 더더욱"),
    ("それで", "그래서"),
    ("これで", "이걸로"),
    ("말한ところで", "말해 봤자"),
    ("들은ところで", "들어 봤자"),
    ("ところで", "그런데"),
    ("지금うちに", "지금 이 틈에"),
    ("うちに", "사이에"),
    ("리자레クション", "리저렉션"),
    ("케이オス", "카오스"),
    ("라이티シア", "라이티시아"),
    ("카チューシャ", "카츄샤"),
    ("にんにくカレー", "마늘 카레"),
    ("にんにくカレ", "마늘 카레"),
    ("プロゲーマー", "프로게이머"),
    ("ゲーマー", "게이머"),
    ("ドレス", "드레스"),
    ("ユウキ", "유우키"),
    ("헤え", "헤에"),
    ("모え는", "모에는"),
    ("에えっと", "에엣토"),
    ("어えっと", "어, 음"),
    ("えっと", "음"),
    ("에え", "에에"),
    ("어れ", "어라"),
    ("상관없지만さ", "상관없지만 말야"),
    ("문제니까さぁ", "문제니까 말야"),
    ("하지만さぁ", "하지만 말야"),
    ("저기さ", "저기 말야"),
    ("거니까ね", "거니까 말야"),
    ("거지ん", "거지"),
    ("ちゃんの", "짱의"),
    ("ちゃん이", "짱이"),
    ("ちゃん을", "짱을"),
    ("ちゃん", "짱"),
    ("이じめ", "이지메"),
    ("ぴったり", "딱"),
    ("ぴたり", "딱"),
    ("コロコロ", "데구르르"),
    ("釘付け", "시선 고정"),
    ("厳しい", "엄격한"),
    ("ほこり", "먼지"),
    ("ボク", "나"),
]


def clean_stage1_text(text: str) -> str:
    if not text:
        return text
    s = text

    # 1) ~っち 호칭 및 일본어 상용구/어휘 치환
    for old, new in TCHI_REPLACEMENTS:
        s = s.replace(old, new)
    for old, new in PHRASE_REPLACEMENTS:
        s = s.replace(old, new)

    # 2) 인용부호/문장 시작 직후 단독 촉음 변환
    s = re.sub(r'([「『（(\["\'\s]|^)っ+(?=[!?,.♥♡\s」』…―—]|$)', r"\1읏", s)
    s = re.sub(r'([「『（(\["\'\s]|^)ッ+(?=[!?,.♥♡\s」』…―—]|$)', r"\1윽", s)

    # 3) 잔여 촉음·장음·소형 가나·탁점 정제
    s = re.sub(r"ー{2,}", "……", s)
    s = re.sub(r"ー(?=[!?,.♥♡\s」』'\"~]|$)", "", s)
    s = s.replace("ー", "~")

    # 소형 가나 제거
    s = re.sub(r"[ぁぃぅぇぉゃゅょゎァィゥェォャュョヮ]", "", s)

    # 문장 중간/끝 잔여 촉음 제거
    s = re.sub(r"[っッ]+", "", s)

    # 탁점/반탁점 기호 제거
    s = s.replace("゛", "").replace("゜", "")

    # 한글 뒤 단독 조사성 가나 잔재 정제
    s = re.sub(r"(?<=[가-힣])[んねぞさ](?=[!?,.♥♡\s」』'\"]|$)", "", s)

    # 공백 정리 및 ai_review 공통 클리너 적용
    s = re.sub(r"\s+", " ", s).strip()
    s = clean_ai_translation(s)
    return s


def run_stage1():
    items, total = get_items(limit=5000)
    print(f"Total unreviewed fetched: {len(items)} (DB Total: {total})")

    to_insert = []
    skipped = []

    for it in items:
        if it.get("category") != "partial_untranslated":
            skipped.append(it)
            continue

        orig = it.get("original", "")
        curr = it.get("translated", "")
        cleaned = clean_stage1_text(curr)

        if (
            cleaned
            and cleaned.strip()
            and not CJK_PATTERN.search(cleaned)
            and classify_translation(orig, cleaned) == "normal"
        ):
            to_insert.append({"id": it["id"], "reviewed_translation": cleaned})
        else:
            skipped.append(it)

    print(f"Stage 1 eligible (normal & CJK-free): {len(to_insert)}")
    print(f"Remaining after Stage 1: {len(skipped)}")

    if not to_insert:
        print("No items to insert.")
        return

    cnt = insert_reviewed(to_insert, model_name="Antigravity-RuleEngine")
    print(f"SUCCESS: Inserted {cnt} items into ai_review_queue!")


if __name__ == "__main__":
    run_stage1()

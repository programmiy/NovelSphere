import sqlite3
import pytest
from fastapi.testclient import TestClient

from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker
from server.rule_classifier import restore_brackets, batch_restore_brackets_in_db
from server.server import app
from server.database import get_db
from server.models import Base, Translation, UrlMetadata
from server.routers.data_crud import upsert_translations, TranslationItem


def test_restore_brackets_plain_text():
    orig = "「え？　あぁそっか。全然良いよ」"
    trans = "응? 아, 그렇구나. 전혀 괜찮아"
    assert restore_brackets(orig, trans) == "「응? 아, 그렇구나. 전혀 괜찮아」"


def test_restore_brackets_quotes_conversion():
    orig = "「亜利沙、俺は絶対に君を離さない」"
    # 큰따옴표
    assert restore_brackets(orig, '"아리사, 난 절대로 널 놓지 않을 거야"') == "「아리사, 난 절대로 널 놓지 않을 거야」"
    # 작은따옴표
    assert restore_brackets(orig, "'아리사, 난 절대로 널 놓지 않을 거야'") == "「아리사, 난 절대로 널 놓지 않을 거야」"
    # 유니코드 곡선 큰따옴표
    assert restore_brackets(orig, "“아리사, 난 절대로 널 놓지 않을 거야”") == "「아리사, 난 절대로 널 놓지 않을 거야」"
    # 유니코드 곡선 작은따옴표
    assert restore_brackets(orig, "‘아리사, 난 절대로 널 놓지 않을 거야’") == "「아리사, 난 절대로 널 놓지 않을 거야」"
    # 기요메(Guillemets)
    assert restore_brackets(orig, "«아리사, 난 절대로 널 놓지 않을 거야»") == "「아리사, 난 절대로 널 놓지 않을 거야」"
    # 오타 조합 (「...»)
    assert restore_brackets(orig, "「아리사, 난 절대로 널 놓지 않을 거야»") == "「아리사, 난 절대로 널 놓지 않을 거야」"


def test_restore_brackets_partial_brackets():
    orig = "「……っ！？」"
    # 닫는 괄호 누락
    assert restore_brackets(orig, "「……!?") == "「……!?」"

    orig_open_missing = "「私ィィィィ！？」"
    # 여는 괄호 누락
    assert restore_brackets(orig_open_missing, "나아아아아!？」") == "「나아아아아!？」"

    # 후행 마침표가 있는 경우
    assert restore_brackets(orig, "「……!?」.") == "「……!?」."


def test_restore_brackets_speaker_prefix_and_internal_dialogue():
    # 화자 표기 접두어 (예: 쿄코「...」)
    orig = "「もちろんデビ。でも、絶対って訳じゃないデビよ」"
    trans_speaker = "쿄코「물론 데비. 하지만 절대 그래야만 하는 건 아니 데비」"
    assert restore_brackets(orig, trans_speaker) == trans_speaker

    # 내부 대사 분할 후 서술문이 뒤따르는 경우
    orig2 = "「プレゼントは私たちよ、なんて言って体にリボンを巻き付けて現れたら嬉しい？」"
    trans_narrative = "「선물은 우리들이야,」 라고 말하며 몸에 리본을 감고 나타나면 기쁠까?"
    assert restore_brackets(orig2, trans_narrative) == trans_narrative


def test_restore_brackets_multiple_brackets():
    orig = "「「「おうっ」」」"
    trans = "오오っ"
    assert restore_brackets(orig, trans) == "「「「오오っ」」」"

    # 이미 다중 괄호가 있는 경우
    assert restore_brackets(orig, "「「「오오っ」」」") == "「「「오오っ」」」"


def test_restore_brackets_html_wrapper():
    orig = "「だね。夕にはずっと嘘をついてたわけだから」"
    trans = "<span>그렇지. 유에게 계속 거짓말을 해왔던 거니까</span>"
    assert restore_brackets(orig, trans) == "<span>「그렇지. 유에게 계속 거짓말을 해왔던 거니까」</span>"


def test_restore_brackets_non_matching_sentences():
    # 문장 중간에 괄호가 있는 서술문
    orig_mid = "確かに。この油っこさと野菜の「許され感」、それに肉には出せない甘みが癖になる。"
    trans_mid = '확실히. 이 기름진 맛과 야채라서 "죄책감이 덜한 느낌", 거기에 고기에는 없는 단맛이 중독된다.'
    assert restore_brackets(orig_mid, trans_mid) == trans_mid

    # 괄호가 전혀 없는 문장
    orig_plain = "今日はいい天気ですね。"
    trans_plain = "오늘은 좋은 날씨네요."
    assert restore_brackets(orig_plain, trans_plain) == trans_plain

    # 일본어 전각 괄호 （...） 독백 문장
    orig_paren = "（本当に贅沢な悩みというか、やれやれって感じだな）"
    trans_paren = "(정말이지 사치스러운 고민이랄까, 에휴, 하는 느낌이네)"
    assert restore_brackets(orig_paren, trans_paren) == trans_paren

    # 빈 문자열 또는 None
    assert restore_brackets("", "") == ""
    assert restore_brackets(None, "테스트") == "테스트"
    assert restore_brackets("「테스트」", None) is None


def test_batch_restore_brackets_in_db():
    conn = sqlite3.connect(":memory:")
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE translations (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            original TEXT,
            translated TEXT
        )
    """)
    # 1. 일반 텍스트 누락
    cursor.execute("INSERT INTO translations (original, translated) VALUES ('「涙はもう止まった」', '눈물은 이미 멈췄다')")
    # 2. 큰따옴표 감싸짐
    cursor.execute("INSERT INTO translations (original, translated) VALUES ('「行くぞ」', '\"가자\"')")
    # 3. 이미 정상 괄호
    cursor.execute("INSERT INTO translations (original, translated) VALUES ('「おはよう」', '「안녕」')")
    # 4. 원문이 괄호 문장이 아님
    cursor.execute("INSERT INTO translations (original, translated) VALUES ('普通の一日', '평범한 하루')")
    conn.commit()

    scanned, updated = batch_restore_brackets_in_db(conn)
    assert scanned == 2
    assert updated == 2

    cursor.execute("SELECT translated FROM translations WHERE id = 1")
    assert cursor.fetchone()[0] == "「눈물은 이미 멈췄다」"

    cursor.execute("SELECT translated FROM translations WHERE id = 2")
    assert cursor.fetchone()[0] == "「가자」"

    conn.close()


def test_admin_restore_brackets_endpoint():
    client = TestClient(app)
    response = client.post("/admin/restore_brackets")
    assert response.status_code == 200
    data = response.json()
    assert data["status"] == "success"
    assert "scanned_count" in data
    assert "updated_count" in data


@pytest.fixture
def db_session():
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    Session = sessionmaker(bind=engine)
    session = Session()
    yield session
    session.close()


def test_upsert_translations_restores_brackets(db_session):
    items = [
        TranslationItem(
            url="https://kakuyomu.jp/works/test_bracket_upsert/episodes/1",
            pid="p_bracket_1",
            original="「新しい冒険が始まるのだ！」",
            translated="새로운 모험이 시작되는 것이다!",
            timestamp=123456789,
            folderName="BracketTestNovel",
            title="제1화"
        )
    ]
    res = upsert_translations(items, db=db_session)
    assert res["inserted"] == 1

    row = db_session.query(Translation).filter(Translation.pid == "p_bracket_1").first()
    assert row is not None
    assert row.translated == "「새로운 모험이 시작되는 것이다!」"


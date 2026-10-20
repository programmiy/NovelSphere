import pytest
from sqlalchemy.orm import Session
import server.database as sdb
from server.models import Translation, SpecialBatchQueue, UrlMetadata
from server.routers.special_batch import (
    resolve_clean_folder_name,
    approve_staged_item,
    batch_approve_staged,
    ApproveRequest,
    BatchApproveRequest,
)

@pytest.fixture
def db_session():
    session = sdb.SessionLocal()
    try:
        yield session
    finally:
        session.close()

def test_resolve_clean_folder_name(db_session: Session):
    url = "https://example.com/novel/1"
    
    # 1. 명시적 정상 폴더가 주어지면 그대로 반환
    assert resolve_clean_folder_name(db_session, url, "정상소설") == "정상소설"
    
    # 2. explicit_folder가 'Unknown'이거나 비어있고, DB에 아무것도 없으면 None(미분류) 반환 (절대 임의 폴더 미생성)
    assert resolve_clean_folder_name(db_session, url, "Unknown") is None
    assert resolve_clean_folder_name(db_session, url, "") is None
    assert resolve_clean_folder_name(db_session, url, None) is None
    
    # 3. 동일 URL에 다른 번역이 이미 특정 소설 폴더를 가지고 있다면 상속
    db_session.add(Translation(
        url=url,
        pid="p1",
        original="テスト1",
        translated="테스트1",
        timestamp=1000,
        folderName="귀속대상소설",
        title="제 1화"
    ))
    db_session.commit()
    
    assert resolve_clean_folder_name(db_session, url, "Unknown") == "귀속대상소설"
    assert resolve_clean_folder_name(db_session, url, None) == "귀속대상소설"


def test_approve_staged_item_preserves_or_inherits_folder(db_session: Session):
    url = "https://example.com/novel/2"
    
    # 동일 회차의 문단 1 (이미 폴더명이 '소설A'로 지정되어 있음)
    db_session.add(Translation(
        url=url,
        pid="p1",
        original="文1",
        translated="문장1",
        timestamp=1000,
        folderName="소설A",
        title="제 2화"
    ))
    # 특별 적재 큐에 들어온 문단 2 (folder_name이 비어있거나 'Unknown'으로 오염되었던 건)
    item = SpecialBatchQueue(
        batch_id="batch_test",
        url=url,
        folder_name="Unknown",
        chapter_title="제 2화",
        chapter_index=2,
        pid="p2",
        original_text="文2……",
        translated_text="문장2……",
        status="staged",
        created_at=1000
    )
    db_session.add(item)
    db_session.commit()
    
    # 단일 승인 수행
    res = approve_staged_item(ApproveRequest(id=item.id), db=db_session)
    assert res["ok"] is True
    
    # 본 DB 확인: Unknown이 아니라 동일 URL의 소설 폴더 '소설A'를 정상 상속받았는지 검증
    trans_p2 = db_session.query(Translation).filter(Translation.url == url, Translation.pid == "p2").first()
    assert trans_p2 is not None
    assert trans_p2.folderName == "소설A"


def test_approve_staged_item_remains_unclassified_when_no_folder(db_session: Session):
    url = "https://example.com/novel/unclassified_episode"
    
    # DB에 동일 회차 폴더 정보가 전혀 없는 상태
    item = SpecialBatchQueue(
        batch_id="batch_test",
        url=url,
        folder_name=None,
        chapter_title="미분류 회차",
        chapter_index=1,
        pid="p1",
        original_text="テスト",
        translated_text="테스트",
        status="staged",
        created_at=1000
    )
    db_session.add(item)
    db_session.commit()
    
    approve_staged_item(ApproveRequest(id=item.id), db=db_session)
    
    # 본 DB 확인: 임의 폴더가 생성되지 않고 None(미분류 보관함 규격)으로 안전하게 적재되었는지 검증
    trans = db_session.query(Translation).filter(Translation.url == url, Translation.pid == "p1").first()
    assert trans is not None
    assert trans.folderName is None


def test_batch_approve_staged_inherits_and_preserves_unclassified(db_session: Session):
    url_with_folder = "https://example.com/novel/3"
    url_without_folder = "https://example.com/novel/4"
    
    db_session.add(Translation(
        url=url_with_folder,
        pid="p1",
        original="文A",
        translated="문장A",
        timestamp=1000,
        folderName="기존소설B",
        title="제 3화"
    ))
    
    item1 = SpecialBatchQueue(
        batch_id="batch_test_2",
        url=url_with_folder,
        folder_name="Unknown",
        chapter_title="제 3화",
        chapter_index=3,
        pid="p2",
        original_text="文A2",
        translated_text="문장A2",
        status="staged",
        created_at=1000
    )
    item2 = SpecialBatchQueue(
        batch_id="batch_test_2",
        url=url_without_folder,
        folder_name="",
        chapter_title="제 4화",
        chapter_index=4,
        pid="p1",
        original_text="文B1",
        translated_text="문장B1",
        status="staged",
        created_at=1000
    )
    db_session.add_all([item1, item2])
    db_session.commit()
    
    res = batch_approve_staged(BatchApproveRequest(batch_id="batch_test_2"), db=db_session)
    assert res["ok"] is True
    assert res["approved_count"] == 2
    
    t1 = db_session.query(Translation).filter(Translation.url == url_with_folder, Translation.pid == "p2").first()
    assert t1.folderName == "기존소설B"
    
    t2 = db_session.query(Translation).filter(Translation.url == url_without_folder, Translation.pid == "p1").first()
    assert t2.folderName is None

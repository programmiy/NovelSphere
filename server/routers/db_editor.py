from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.templating import Jinja2Templates
from sqlalchemy.orm import Session
from server.database import get_db
from server.models import Translation, ExcludedSentence, PinnedBook, Tag, BookTag, BookActivity, AppliedUrl, UrlMetadata
from typing import List, Optional, Union
import json
from server.settings import settings

router = APIRouter()
templates = Jinja2Templates(directory=settings.templates_dir)

@router.get(
    "/db_editor",
    response_class=HTMLResponse,
    tags=["DB Editor"],
    summary="DB 편집기 페이지 조회",
    description="데이터베이스의 내용을 웹 인터페이스를 통해 조회하고 편집할 수 있는 페이지를 제공합니다."
)
async def db_editor_page(request: Request, db: Session = Depends(get_db), table_name: Optional[str] = None, jump_to_id: Optional[int] = None):
    tables = {}
    all_table_names = ["Translation", "ExcludedSentence", "PinnedBook", "Tag", "BookTag", "BookActivity", "AppliedUrl", "UrlMetadata"]

    for name in all_table_names:
        model = TABLE_MODELS.get(name)
        if not model:
            continue

        query = db.query(model)

        # Handle jump_to_id logic only for the specified table
        if name == table_name and jump_to_id is not None and hasattr(model, 'id'):
            try:
                # Get the rank of the jump_to_id
                rank_query = db.query(model).filter(model.id < jump_to_id).order_by(model.id).count()
                
                # Calculate offset to center the result
                offset = max(0, rank_query - 50) # Show 50 items before
                query = query.order_by(model.id).offset(offset).limit(100)
            except Exception as e:
                # Fallback to simple limit if something goes wrong
                print(f"Error during jump_to_id: {e}")
                query = query.order_by(model.id).limit(100)
        else:
            # Default behavior
            if hasattr(model, 'id'):
                query = query.order_by(model.id.desc()).limit(100)
            else:
                 query = query.limit(100)

        results = query.all()
        processed_results = []
        for record in results:
            d = record.__dict__.copy()
            d.pop('_sa_instance_state', None)
            
            # Ensure all values are serializable before creating JSON
            serializable_d = {k: str(v) if not isinstance(v, (str, int, float, bool, type(None))) else v for k, v in d.items()}
            
            json_str = json.dumps(serializable_d)
            processed_results.append({'data': d, 'json': json_str})
        tables[name] = processed_results

    return templates.TemplateResponse("db_editor.html", {"request": request, "tables": tables, "jumped_to_id": jump_to_id})

# TODO: Add API endpoints for CRUD operations (create, update, delete) for each table

# Helper to get model from table name
TABLE_MODELS = {
    "Translation": Translation,
    "ExcludedSentence": ExcludedSentence,
    "PinnedBook": PinnedBook,
    "Tag": Tag,
    "BookTag": BookTag,
    "BookActivity": BookActivity,
    "AppliedUrl": AppliedUrl,
    "UrlMetadata": UrlMetadata,
}

@router.post(
    "/api/db_editor/{table_name}",
    tags=["DB Editor"],
    summary="DB 레코드 생성",
    description="지정된 테이블에 새로운 레코드를 생성합니다."
)
async def create_record(table_name: str, record_data: dict, db: Session = Depends(get_db)):
    model = TABLE_MODELS.get(table_name)
    if not model:
        raise HTTPException(status_code=404, detail="Table not found")
    
    try:
        new_record = model(**record_data)
        db.add(new_record)
        db.commit()
        db.refresh(new_record)
        return {"message": f"{table_name} record created successfully", "id": getattr(new_record, 'id', getattr(new_record, 'url', None))}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.put(
    "/api/db_editor/{table_name}/{record_id}",
    tags=["DB Editor"],
    summary="DB 레코드 업데이트",
    description="지정된 테이블의 특정 레코드를 업데이트합니다."
)
async def update_record(table_name: str, record_id: Union[int, str], record_data: dict, db: Session = Depends(get_db)):
    model = TABLE_MODELS.get(table_name)
    if not model:
        raise HTTPException(status_code=404, detail="Table not found")

    # Determine primary key field dynamically
    pk_field = None
    if hasattr(model, 'id'):
        pk_field = 'id'
    elif hasattr(model, 'url'): # For tables like AppliedUrl, UrlMetadata
        pk_field = 'url'
    elif hasattr(model, 'folderName'): # For tables like PinnedBook, BookActivity
        pk_field = 'folderName'
    
    if not pk_field:
        raise HTTPException(status_code=500, detail=f"Primary key not found for table {table_name}")

    existing_record = db.query(model).filter(getattr(model, pk_field) == record_id).first()
    if not existing_record:
        raise HTTPException(status_code=404, detail=f"{table_name} record with ID/URL/folderName {record_id} not found")
    
    try:
        for key, value in record_data.items():
            if hasattr(existing_record, key):
                setattr(existing_record, key, value)
        db.commit()
        db.refresh(existing_record)
        return {"message": f"{table_name} record updated successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))

@router.delete(
    "/api/db_editor/{table_name}/{record_id}",
    tags=["DB Editor"],
    summary="DB 레코드 삭제",
    description="지정된 테이블의 특정 레코드를 삭제합니다."
)
async def delete_record(table_name: str, record_id: Union[int, str], db: Session = Depends(get_db)):
    model = TABLE_MODELS.get(table_name)
    if not model:
        raise HTTPException(status_code=404, detail="Table not found")

    # Determine primary key field dynamically
    pk_field = None
    if hasattr(model, 'id'):
        pk_field = 'id'
    elif hasattr(model, 'url'): # For tables like AppliedUrl, UrlMetadata
        pk_field = 'url'
    elif hasattr(model, 'folderName'): # For tables like PinnedBook, BookActivity
        pk_field = 'folderName'
    
    if not pk_field:
        raise HTTPException(status_code=500, detail=f"Primary key not found for table {table_name}")

    existing_record = db.query(model).filter(getattr(model, pk_field) == record_id).first()
    if not existing_record:
        raise HTTPException(status_code=404, detail=f"{table_name} record with ID/URL/folderName {record_id} not found")
    
    try:
        db.delete(existing_record)
        db.commit()
        return {"message": f"{table_name} record deleted successfully"}
    except Exception as e:
        db.rollback()
        raise HTTPException(status_code=400, detail=str(e))
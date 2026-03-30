import re
from sqlalchemy import create_engine, event
from sqlalchemy.orm import sessionmaker
from server.settings import settings

engine = create_engine(
    settings.database_url, connect_args={"check_same_thread": False}
)

@event.listens_for(engine, "connect")
def _db_connect(dbapi_connection, _connection_record):
    """
    Registers a custom REGEXP function for SQLite connections to enable regex searches in SQL.
    """
    def regexp(expr, item):
        if item is None:
            return False
        reg = re.compile(expr)
        return reg.search(item) is not None

    dbapi_connection.create_function("REGEXP", 2, regexp)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

def get_db():
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()

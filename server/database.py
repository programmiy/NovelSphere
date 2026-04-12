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
    Registers custom functions and optimizes SQLite performance.
    """
    # SQLite optimization pragmas
    cursor = dbapi_connection.cursor()
    cursor.execute("PRAGMA journal_mode=WAL")
    cursor.execute("PRAGMA synchronous=NORMAL")
    cursor.execute("PRAGMA cache_size=10000")
    cursor.execute("PRAGMA busy_timeout=5000")
    cursor.close()

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

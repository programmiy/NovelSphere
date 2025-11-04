from fastapi.testclient import TestClient
from server.server import app

client = TestClient(app)

def test_health_check():
    """/health 엔드포인트가 200 OK와 함께 {"status": "ok"}를 반환하는지 테스트합니다."""
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}

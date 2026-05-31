import json
from pathlib import Path

import pytest

from app import app


def test_index_loads():
    client = app.test_client()
    response = client.get('/')
    assert response.status_code == 200
    assert b'Fork Algorithm' in response.data


def test_subscribe_invalid_email():
    client = app.test_client()
    response = client.post('/subscribe', json={'email': 'invalid-email'})
    assert response.status_code == 400
    assert b'Please enter a valid email address.' in response.data


def test_subscribe_duplicate(tmp_path, monkeypatch):
    temp_file = tmp_path / 'subscribers.json'
    monkeypatch.setattr('app.SUBSCRIBERS_FILE', str(temp_file))

    client = app.test_client()
    first = client.post('/subscribe', json={'email': 'tester@example.com'})
    assert first.status_code == 201
    first_data = json.loads(first.data)
    assert 'subscribed' in first_data['message'].lower()

    second = client.post('/subscribe', json={'email': 'tester@example.com'})
    assert second.status_code == 200
    second_data = json.loads(second.data)
    assert 'already subscribed' in second_data['message'].lower()

    assert Path(temp_file).exists()
    saved = json.loads(Path(temp_file).read_text())
    assert saved[0]['email'] == 'tester@example.com'

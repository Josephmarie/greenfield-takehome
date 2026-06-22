"""Offline unit tests for the auth helpers (no API key, no DB)."""

import time

import pytest

from greenfield_ocr.auth import (
    TokenError,
    decode_token,
    hash_password,
    make_token,
    verify_password,
)

SECRET = "test-secret"


def test_password_round_trip():
    h = hash_password("correct horse battery staple")
    assert h.startswith("pbkdf2_sha256$")
    assert verify_password("correct horse battery staple", h)


def test_password_rejects_wrong():
    h = hash_password("hunter2hunter2")
    assert not verify_password("wrong-password", h)


def test_password_salted_unique():
    # Same password hashes differently each time (random salt).
    assert hash_password("samepass123") != hash_password("samepass123")


def test_verify_handles_garbage():
    assert not verify_password("anything", "not-a-valid-hash")


def test_token_round_trip():
    tok = make_token("user-123", "a@b.com", SECRET, ttl_seconds=3600)
    claims = decode_token(tok, SECRET)
    assert claims["sub"] == "user-123"
    assert claims["email"] == "a@b.com"


def test_token_bad_signature_rejected():
    tok = make_token("user-123", "a@b.com", SECRET, ttl_seconds=3600)
    with pytest.raises(TokenError):
        decode_token(tok, "different-secret")


def test_token_expiry_rejected():
    past = int(time.time()) - 10_000
    tok = make_token("u", "a@b.com", SECRET, ttl_seconds=3600, now=past)
    with pytest.raises(TokenError):
        decode_token(tok, SECRET)


def test_token_malformed_rejected():
    with pytest.raises(TokenError):
        decode_token("not.a.jwt", SECRET)

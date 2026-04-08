

import os
import base64
import logging
import threading
from datetime import datetime, timedelta
from typing import Optional, Dict, Any

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

logger = logging.getLogger(__name__)


def _get_or_generate_encryption_key() -> bytes:
    """Get encryption key from env or derive one for development."""
    key = os.environ.get("OUTLOOK_TOKEN_ENCRYPTION_KEY", "")
    if key:
        logger.info("Using OUTLOOK_TOKEN_ENCRYPTION_KEY from environment")
        return key.encode()

    # Derive a key for development
    secret = os.environ.get("OUTLOOK_TOKEN_ENCRYPTION_SECRET", "agentcore-outlook-default-secret")
    salt = os.environ.get("OUTLOOK_TOKEN_ENCRYPTION_SALT", "agentcore-outlook-salt-2025")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=salt.encode(),
        iterations=100000,
    )
    derived = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
    logger.warning("Using derived Outlook encryption key. Set OUTLOOK_TOKEN_ENCRYPTION_KEY for production.")
    return derived


class OutlookTokenManager:
    """Manages encrypted in-memory storage of Outlook access tokens."""

    def __init__(self):
        self._token_store: Dict[str, Dict[str, Any]] = {}
        self._expired_users: Dict[str, datetime] = {}
        self._lock = threading.Lock()
        encryption_key = _get_or_generate_encryption_key()
        self._cipher = Fernet(encryption_key)
        logger.info("Outlook Token Manager initialized with encryption enabled")

    def store_token(self, user_id: str, access_token: str, expires_in: int = 3600) -> bool:
        try:
            if not user_id or not access_token:
                return False
            encrypted_token = self._cipher.encrypt(access_token.encode()).decode()
            expiration_time = datetime.utcnow() + timedelta(seconds=expires_in)
            with self._lock:
                self._token_store[user_id] = {
                    "token": encrypted_token,
                    "created_at": datetime.utcnow(),
                    "expires_at": expiration_time,
                }
                self._expired_users.pop(user_id, None)
            logger.info("Stored encrypted Outlook token for user: %s", user_id)
            return True
        except Exception as e:
            logger.error("Error storing token for user %s: %s", user_id, e)
            return False

    def get_token(self, user_id: str) -> Optional[str]:
        try:
            if not user_id:
                return None
            with self._lock:
                if user_id not in self._token_store:
                    return None
                token_data = self._token_store[user_id]
            encrypted_token = token_data["token"]
            return self._cipher.decrypt(encrypted_token.encode()).decode()
        except Exception as e:
            logger.error("Error retrieving token for user %s: %s", user_id, e)
            return None

    def delete_token(self, user_id: str) -> bool:
        try:
            with self._lock:
                if user_id in self._token_store:
                    del self._token_store[user_id]
                    logger.info("Removed Outlook token for user: %s", user_id)
                    return True
                return False
        except Exception as e:
            logger.error("Error deleting token for user %s: %s", user_id, e)
            return False

    def was_token_expired(self, user_id: str) -> bool:
        return bool(user_id and user_id in self._expired_users)

    def is_connected(self, user_id: str) -> bool:
        try:
            if not user_id:
                return False
            with self._lock:
                if user_id not in self._token_store:
                    return False
                token_data = self._token_store[user_id]
                if datetime.utcnow() >= token_data["expires_at"]:
                    self._expired_users[user_id] = datetime.utcnow()
                    del self._token_store[user_id]
                    return False
                return True
        except Exception as e:
            logger.error("Error checking connection for user %s: %s", user_id, e)
            return False


# Global singleton
outlook_token_manager = OutlookTokenManager()

"""
Outlook Chat-Bar Router — MiBuddy-style OAuth + Graph API endpoints.

Provides a standalone Outlook integration for the orchestrator chat bar:
  GET  /outlook-chat/auth/login    — Initiate OAuth + PKCE popup flow
  GET  /outlook-chat/auth/callback — Complete OAuth, store token, close popup
  GET  /outlook-chat/status        — Check if current user is connected
  POST /outlook-chat/disconnect    — Remove token and session cookie
  POST /outlook-chat/get_emails    — Retrieve emails from mailbox
  POST /outlook-chat/search_emails — Search emails by query
  POST /outlook-chat/get_calendar  — Retrieve calendar events
  POST /outlook-chat/send_email    — Send an email
"""
from __future__ import annotations

import base64
import hashlib
import logging
import os
import secrets
import threading
import time
from typing import Dict, Optional
from urllib.parse import quote_plus
from uuid import uuid4

from fastapi import APIRouter, Query, Request
from fastapi.responses import HTMLResponse, JSONResponse, RedirectResponse

from agentcore.services.outlook_chat.outlook_service import OutlookService
from agentcore.services.outlook_chat.token_manager import outlook_token_manager

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/outlook-chat", tags=["Outlook Chat Integration"])

# ── Environment ──────────────────────────────────────────────────
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
OUTLOOK_OAUTH_REDIRECT_URI = os.environ.get("OUTLOOK_OAUTH_REDIRECT_URI", "")

# ── In-memory state stores ───────────────────────────────────────
_pkce_lock = threading.Lock()
_pkce_states: Dict[str, Dict] = {}  # state -> {code_verifier, user_id, created_at}

_session_lock = threading.Lock()
_outlook_cookie_sessions: Dict[str, str] = {}  # session_id -> user_id

_PKCE_STATE_TTL = 600  # 10 minutes

# ── OAuth scopes ─────────────────────────────────────────────────
_OUTLOOK_SCOPES = " ".join([
    "https://graph.microsoft.com/User.Read",
    "https://graph.microsoft.com/Mail.Read",
    "https://graph.microsoft.com/Mail.Read.Shared",
    "https://graph.microsoft.com/Mail.ReadBasic",
    "https://graph.microsoft.com/Mail.Send",
    "https://graph.microsoft.com/Calendars.Read",
    "https://graph.microsoft.com/Calendars.Read.Shared",
    "https://graph.microsoft.com/Calendars.ReadBasic",
    "offline_access",
])

# ── HTML responses for popup ─────────────────────────────────────
_AUTH_SUCCESS_HTML = """<!DOCTYPE html>
<html><head><title>Connecting...</title></head>
<body>
<script>
  try { if (window.opener) { window.opener.postMessage({type:'OUTLOOK_AUTH_SUCCESS'}, window.location.origin); } } catch(e) {}
  window.close();
</script>
<p>Outlook connected. You may close this window.</p>
</body></html>"""

_AUTH_ERROR_HTML = """<!DOCTYPE html>
<html><head><title>Auth Error</title></head>
<body>
<script>
  try {{ if (window.opener) {{ window.opener.postMessage({{type:'OUTLOOK_AUTH_ERROR',error:'{error}'}}, window.location.origin); }} }} catch(e) {{}}
  window.close();
</script>
<p>Authentication failed: {error}. You may close this window.</p>
</body></html>"""


# ── Helpers ──────────────────────────────────────────────────────

def _html_escape(text: str) -> str:
    return (
        text.replace("&", "&amp;")
        .replace("<", "&lt;")
        .replace(">", "&gt;")
        .replace('"', "&quot;")
        .replace("'", "&#x27;")
    )


def _build_redirect_uri(request: Request) -> str:
    """Build the OAuth redirect URI from the incoming request."""
    if OUTLOOK_OAUTH_REDIRECT_URI:
        return OUTLOOK_OAUTH_REDIRECT_URI

    host = (
        request.headers.get("X-Forwarded-Host")
        or request.headers.get("host")
        or ""
    ).lower().rstrip("/")
    protocol = request.headers.get("X-Forwarded-Proto", request.url.scheme or "http")
    return f"{protocol}://{host}/api/outlook-chat/auth/callback"


def _is_request_secure(request: Request) -> bool:
    proto = request.headers.get("X-Forwarded-Proto", request.url.scheme or "http")
    return proto.lower() == "https"


def _get_user_id(request: Request) -> Optional[str]:
    """Extract the current user's ID from the request.

    Agentcore injects the authenticated user via middleware. The user object
    is available at ``request.state.user`` after JWT validation.  We fall back
    to the ``outlook_session`` cookie for endpoints that run without a JWT
    (e.g. the OAuth callback which is triggered by Microsoft's redirect).
    """
    # Primary: JWT-authenticated user injected by agentcore auth middleware
    user = getattr(request.state, "user", None)
    if user:
        return str(getattr(user, "id", "")) or None

    # Fallback: cookie-based session (set after OAuth callback)
    session_id = request.cookies.get("outlook_session")
    if session_id:
        with _session_lock:
            return _outlook_cookie_sessions.get(session_id)

    return None


# ── OAuth endpoints ──────────────────────────────────────────────

@router.get("/auth/login")
async def outlook_auth_login(request: Request):
    """Initiate Authorization Code + PKCE flow (opens in popup)."""
    # Purge stale states
    cutoff = time.time() - _PKCE_STATE_TTL
    with _pkce_lock:
        stale = [k for k, v in _pkce_states.items() if v.get("created_at", 0) < cutoff]
        for k in stale:
            _pkce_states.pop(k, None)

    user_id = _get_user_id(request)

    code_verifier = secrets.token_urlsafe(64)
    code_challenge = (
        base64.urlsafe_b64encode(hashlib.sha256(code_verifier.encode("ascii")).digest())
        .rstrip(b"=")
        .decode("ascii")
    )

    state = secrets.token_urlsafe(32)
    with _pkce_lock:
        _pkce_states[state] = {
            "code_verifier": code_verifier,
            "user_id": user_id,
            "created_at": time.time(),
        }

    redirect_uri = _build_redirect_uri(request)
    logger.info("Outlook OAuth login: redirect_uri=%s", redirect_uri)

    auth_url = (
        f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/authorize"
        f"?client_id={AZURE_CLIENT_ID}"
        f"&response_type=code"
        f"&redirect_uri={quote_plus(redirect_uri)}"
        f"&scope={quote_plus(_OUTLOOK_SCOPES)}"
        f"&state={state}"
        f"&code_challenge={code_challenge}"
        f"&code_challenge_method=S256"
        f"&prompt=select_account"
    )
    return RedirectResponse(url=auth_url, status_code=302)


@router.get("/auth/callback")
async def outlook_auth_callback(
    request: Request,
    code: Optional[str] = Query(None),
    state: Optional[str] = Query(None),
    error: Optional[str] = Query(None),
    error_description: Optional[str] = Query(None),
):
    """Complete Authorization Code + PKCE flow; set cookie; close popup."""

    def error_response(reason: str) -> HTMLResponse:
        safe = _html_escape(reason)
        return HTMLResponse(content=_AUTH_ERROR_HTML.format(error=safe))

    if error:
        logger.warning("Outlook OAuth error: %s - %s", error, error_description)
        return error_response(error)

    if not code or not state:
        return error_response("missing_code_or_state")

    with _pkce_lock:
        state_data = _pkce_states.pop(state, None)

    if not state_data:
        return error_response("invalid_state")

    if time.time() - state_data.get("created_at", 0) > _PKCE_STATE_TTL:
        return error_response("state_expired")

    code_verifier = state_data["code_verifier"]
    user_id = state_data.get("user_id")

    redirect_uri = _build_redirect_uri(request)

    token_data = OutlookService.exchange_code_for_token(code, redirect_uri, code_verifier)
    if not token_data:
        return error_response("token_exchange_failed")

    access_token = token_data.get("access_token")
    expires_in = int(token_data.get("expires_in", 3600))

    if not access_token:
        return error_response("no_access_token_in_response")

    # Identify user from Graph if we don't have one from JWT
    if not user_id:
        user_info = OutlookService.validate_access_token(access_token)
        if user_info:
            user_id = user_info.get("id") or user_info.get("userPrincipalName")

    if not user_id:
        return error_response("cannot_identify_user")

    outlook_token_manager.store_token(user_id, access_token, expires_in)

    session_id = str(uuid4())
    with _session_lock:
        _outlook_cookie_sessions[session_id] = user_id

    is_secure = _is_request_secure(request)
    response = HTMLResponse(content=_AUTH_SUCCESS_HTML)
    response.set_cookie(
        key="outlook_session",
        value=session_id,
        httponly=True,
        secure=is_secure,
        samesite="lax",
        max_age=expires_in,
        path="/",
    )
    return response


# ── Status / Disconnect ──────────────────────────────────────────

@router.get("/status")
async def get_outlook_status(request: Request):
    """Check if the current user has an active Outlook session."""
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse(content={"connected": False}, status_code=200)

    is_connected = outlook_token_manager.is_connected(user_id)
    return JSONResponse(content={"connected": is_connected}, status_code=200)


@router.post("/disconnect")
async def disconnect_outlook(request: Request):
    """Remove Outlook token and session cookie."""
    user_id = _get_user_id(request)
    if not user_id:
        return JSONResponse(content={"error": "User not authenticated"}, status_code=401)

    outlook_token_manager.delete_token(user_id)

    session_id = request.cookies.get("outlook_session")
    if session_id:
        with _session_lock:
            _outlook_cookie_sessions.pop(session_id, None)

    response = JSONResponse(content={"message": "Outlook disconnected successfully"}, status_code=200)
    response.delete_cookie(key="outlook_session", path="/")
    return response


# ── Mail endpoints ───────────────────────────────────────────────

def _require_token(request: Request) -> str:
    """Get the stored access token for the current user or raise 401."""
    user_id = _get_user_id(request)
    if not user_id:
        raise _http_error(401, "User not authenticated")
    token = outlook_token_manager.get_token(user_id)
    if not token:
        raise _http_error(401, "Outlook not connected. Please connect first.")
    return token


class _HTTPError(Exception):
    def __init__(self, status: int, detail: str):
        self.status = status
        self.detail = detail


def _http_error(status: int, detail: str) -> _HTTPError:
    return _HTTPError(status, detail)


@router.post("/get_emails")
async def get_outlook_emails(request: Request):
    """Retrieve emails from the user's mailbox."""
    try:
        token = _require_token(request)
        body = await request.json()
        emails = OutlookService.get_emails(
            token,
            top=body.get("top", 10),
            skip=body.get("skip", 0),
            folder=body.get("folder", "inbox"),
            search=body.get("search"),
            unread_only=body.get("unread_only", False),
            received_after=body.get("received_after"),
            received_before=body.get("received_before"),
        )
        if emails is not None:
            return JSONResponse(content={"success": True, "emails": emails, "count": len(emails)})
        return JSONResponse(content={"error": "Failed to retrieve emails"}, status_code=500)
    except _HTTPError as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status)
    except Exception as e:
        logger.error("Error retrieving Outlook emails: %s", e)
        return JSONResponse(content={"error": str(e)}, status_code=500)


@router.post("/search_emails")
async def search_outlook_emails(request: Request):
    """Search emails by query."""
    try:
        token = _require_token(request)
        body = await request.json()
        query = body.get("query", "")
        if not query:
            return JSONResponse(content={"error": "query is required"}, status_code=400)
        emails = OutlookService.search_emails(token, query, body.get("top", 10))
        if emails is not None:
            return JSONResponse(content={"success": True, "emails": emails, "count": len(emails)})
        return JSONResponse(content={"error": "Failed to search emails"}, status_code=500)
    except _HTTPError as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status)
    except Exception as e:
        logger.error("Error searching Outlook emails: %s", e)
        return JSONResponse(content={"error": str(e)}, status_code=500)


@router.post("/get_calendar")
async def get_outlook_calendar(request: Request):
    """Retrieve calendar events."""
    try:
        token = _require_token(request)
        body = await request.json()
        events = OutlookService.get_calendar_events(
            token,
            start_date=body.get("start_date"),
            end_date=body.get("end_date"),
            top=body.get("top", 10),
        )
        if events is not None:
            return JSONResponse(content={"success": True, "events": events, "count": len(events)})
        return JSONResponse(content={"error": "Failed to retrieve calendar events"}, status_code=500)
    except _HTTPError as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status)
    except Exception as e:
        logger.error("Error retrieving Outlook calendar: %s", e)
        return JSONResponse(content={"error": str(e)}, status_code=500)


@router.post("/send_email")
async def send_outlook_email(request: Request):
    """Send an email."""
    try:
        token = _require_token(request)
        body = await request.json()
        to = body.get("to", [])
        subject = body.get("subject", "")
        if not to or not subject:
            return JSONResponse(content={"error": "to and subject are required"}, status_code=400)
        success = OutlookService.send_email(
            token, to, subject, body.get("body", ""), body.get("body_type", "HTML")
        )
        if success:
            return JSONResponse(content={"success": True, "message": "Email sent successfully"})
        return JSONResponse(content={"error": "Failed to send email"}, status_code=500)
    except _HTTPError as e:
        return JSONResponse(content={"error": e.detail}, status_code=e.status)
    except Exception as e:
        logger.error("Error sending Outlook email: %s", e)
        return JSONResponse(content={"error": str(e)}, status_code=500)

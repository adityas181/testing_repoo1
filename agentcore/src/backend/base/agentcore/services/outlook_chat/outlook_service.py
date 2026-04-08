"""
Outlook Service for chat-bar integration — Microsoft Graph API wrapper.

Ported from MiBuddy-Backend. Provides email read/search/send and calendar
operations using a per-user access token stored by the token manager.
"""

import logging
import os
import requests
from typing import Optional, Dict, Any, List
from datetime import datetime, timedelta

logger = logging.getLogger(__name__)

# Azure AD credentials — loaded from environment
AZURE_TENANT_ID = os.environ.get("AZURE_TENANT_ID", "")
AZURE_CLIENT_ID = os.environ.get("AZURE_CLIENT_ID", "")
AZURE_CLIENT_SECRET = os.environ.get("AZURE_CLIENT_SECRET", "")


class OutlookTokenExpiredError(Exception):
    """Raised when a Graph API call returns 401 (token expired/revoked)."""


def _check_token_expired(response, context: str = ""):
    if response.status_code == 401:
        logger.warning("Token expired/revoked during %s: %s", context, response.status_code)
        raise OutlookTokenExpiredError(f"Access token expired during {context}")


class OutlookService:
    """Service for Outlook operations via Microsoft Graph API."""

    GRAPH_API_ENDPOINT = "https://graph.microsoft.com/v1.0"
    TOKEN_ENDPOINT = f"https://login.microsoftonline.com/{AZURE_TENANT_ID}/oauth2/v2.0/token"

    @staticmethod
    def validate_access_token(access_token: str) -> Optional[Dict[str, Any]]:
        """Validate an access token by calling Microsoft Graph /me."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }
            response = requests.get(
                f"{OutlookService.GRAPH_API_ENDPOINT}/me",
                headers=headers,
                timeout=10,
            )
            if response.status_code == 200:
                return response.json()
            logger.warning("Token validation failed: %s", response.status_code)
            return None
        except Exception as e:
            logger.error("Error validating token: %s", e)
            return None

    @staticmethod
    def get_emails(
        access_token: str,
        top: int = 10,
        skip: int = 0,
        folder: str = "inbox",
        search: Optional[str] = None,
        unread_only: bool = False,
        received_after: Optional[str] = None,
        received_before: Optional[str] = None,
    ) -> Optional[List[Dict[str, Any]]]:
        """Retrieve emails from user's mailbox."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }

            filters: list[str] = []
            if unread_only or received_after or received_before:
                headers["ConsistencyLevel"] = "eventual"

            params: Dict[str, Any] = {
                "$top": min(top, 50),
                "$skip": skip,
                "$orderby": "receivedDateTime desc",
                "$select": "id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,importance,isRead,inferenceClassification",
            }

            if received_after:
                filters.append(f"receivedDateTime ge {received_after}")
            if received_before:
                filters.append(f"receivedDateTime lt {received_before}")
            if unread_only:
                filters.append("isRead eq false")

            if filters:
                params["$filter"] = " and ".join(filters)
                params["$count"] = "true"

            if search:
                params["$search"] = f'"{search}"'

            endpoint = f"{OutlookService.GRAPH_API_ENDPOINT}/me/mailFolders/{folder}/messages"

            response = requests.get(endpoint, headers=headers, params=params, timeout=30)

            if response.status_code == 200:
                return response.json().get("value", [])
            _check_token_expired(response, "get_emails")
            logger.error("Failed to retrieve emails: %s - %s", response.status_code, response.text)
            return None
        except OutlookTokenExpiredError:
            raise
        except Exception as e:
            logger.error("Error retrieving emails: %s", e)
            return None

    @staticmethod
    def search_emails_by_sender(
        access_token: str, sender: str, top: int = 10
    ) -> Optional[List[Dict[str, Any]]]:
        """Search emails from a specific sender across the entire mailbox."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }
            params = {
                "$search": f'"from:{sender}"',
                "$top": min(top, 50),
                "$select": "id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,importance,isRead",
            }

            response = requests.get(
                f"{OutlookService.GRAPH_API_ENDPOINT}/me/messages",
                headers=headers,
                params=params,
                timeout=30,
            )

            if response.status_code == 200:
                return response.json().get("value", [])
            _check_token_expired(response, "search_emails_by_sender")
            logger.error("Failed to search emails by sender: %s - %s", response.status_code, response.text)
            return None
        except OutlookTokenExpiredError:
            raise
        except Exception as e:
            logger.error("Error searching emails by sender: %s", e)
            return None

    @staticmethod
    def search_emails(
        access_token: str, query: str, top: int = 10
    ) -> Optional[List[Dict[str, Any]]]:
        """Search emails using Microsoft Graph search API (KQL syntax)."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }
            params = {
                "$search": f'"{query}"',
                "$top": min(top, 50),
                "$orderby": "receivedDateTime desc",
            }

            response = requests.get(
                f"{OutlookService.GRAPH_API_ENDPOINT}/me/messages",
                headers=headers,
                params=params,
                timeout=30,
            )

            if response.status_code == 200:
                return response.json().get("value", [])
            _check_token_expired(response, "search_emails")
            logger.error("Failed to search emails: %s", response.status_code)
            return None
        except OutlookTokenExpiredError:
            raise
        except Exception as e:
            logger.error("Error searching emails: %s", e)
            return None

    @staticmethod
    def get_email_by_id(
        access_token: str, message_id: str
    ) -> Optional[Dict[str, Any]]:
        """Get a specific email by its ID."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }
            response = requests.get(
                f"{OutlookService.GRAPH_API_ENDPOINT}/me/messages/{message_id}",
                headers=headers,
                timeout=20,
            )
            if response.status_code == 200:
                return response.json()
            _check_token_expired(response, "get_email_by_id")
            logger.error("Failed to retrieve email: %s", response.status_code)
            return None
        except OutlookTokenExpiredError:
            raise
        except Exception as e:
            logger.error("Error retrieving email: %s", e)
            return None

    @staticmethod
    def get_calendar_events(
        access_token: str,
        start_date: Optional[str] = None,
        end_date: Optional[str] = None,
        top: int = 10,
    ) -> Optional[List[Dict[str, Any]]]:
        """Retrieve calendar events."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
                "Prefer": 'outlook.timezone="India Standard Time"',
            }

            if not start_date:
                start_date = datetime.utcnow().isoformat() + "Z"
            if not end_date:
                end_date = (datetime.utcnow() + timedelta(days=7)).isoformat() + "Z"

            requested_top = max(1, min(int(top or 10), 200))

            params: Dict[str, Any] = {
                "$top": min(requested_top, 50),
                "$orderby": "start/dateTime",
                "$select": "id,subject,start,end,location,attendees,organizer,isOnlineMeeting,onlineMeetingUrl,isCancelled,responseStatus,showAs",
                "startDateTime": start_date,
                "endDateTime": end_date,
            }

            endpoint = f"{OutlookService.GRAPH_API_ENDPOINT}/me/calendarView"

            collected: List[Dict[str, Any]] = []
            next_url: Optional[str] = endpoint
            next_params: Optional[Dict] = params

            while next_url and len(collected) < requested_top:
                response = requests.get(
                    next_url, headers=headers, params=next_params, timeout=30
                )

                if response.status_code != 200:
                    _check_token_expired(response, "get_calendar_events")
                    logger.error("Failed to retrieve calendar events: %s", response.status_code)
                    return None

                data = response.json()
                batch = data.get("value", [])
                if not batch:
                    break

                collected.extend(batch)
                next_url = data.get("@odata.nextLink")
                next_params = None

            return collected[:requested_top]
        except OutlookTokenExpiredError:
            raise
        except Exception as e:
            logger.error("Error retrieving calendar events: %s", e)
            return None

    @staticmethod
    def send_email(
        access_token: str,
        to_recipients: List[str],
        subject: str,
        body: str,
        body_type: str = "HTML",
    ) -> bool:
        """Send an email."""
        try:
            headers = {
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json",
            }

            message = {
                "message": {
                    "subject": subject,
                    "body": {"contentType": body_type, "content": body},
                    "toRecipients": [
                        {"emailAddress": {"address": email}} for email in to_recipients
                    ],
                }
            }

            response = requests.post(
                f"{OutlookService.GRAPH_API_ENDPOINT}/me/sendMail",
                headers=headers,
                json=message,
                timeout=30,
            )

            if response.status_code == 202:
                logger.info("Email sent successfully")
                return True
            logger.error("Failed to send email: %s - %s", response.status_code, response.text)
            return False
        except Exception as e:
            logger.error("Error sending email: %s", e)
            return False

    @staticmethod
    def exchange_code_for_token(
        auth_code: str, redirect_uri: str, code_verifier: Optional[str] = None
    ) -> Optional[Dict[str, Any]]:
        """Exchange authorization code for access token (with optional PKCE)."""
        try:
            data: Dict[str, str] = {
                "client_id": AZURE_CLIENT_ID,
                "client_secret": AZURE_CLIENT_SECRET,
                "code": auth_code,
                "redirect_uri": redirect_uri,
                "grant_type": "authorization_code",
                "scope": "User.Read Mail.Read Mail.Send Calendars.Read offline_access",
            }
            if code_verifier:
                data["code_verifier"] = code_verifier

            response = requests.post(
                OutlookService.TOKEN_ENDPOINT,
                data=data,
                headers={"Content-Type": "application/x-www-form-urlencoded"},
                timeout=15,
            )

            if response.status_code == 200:
                return response.json()
            logger.error("Token exchange failed: %s - %s", response.status_code, response.text)
            return None
        except Exception as e:
            logger.error("Error exchanging code for token: %s", e)
            return None

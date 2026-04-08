from __future__ import annotations

import asyncio
from dataclasses import dataclass
from email.message import EmailMessage
from html import escape
from pathlib import Path
import smtplib
import ssl


TEMPLATES_DIR = Path(__file__).with_suffix("").parent / "templates"


@dataclass(slots=True)
class SmtpConfig:
    host: str
    port: int
    username: str | None
    password: str | None
    from_email: str
    from_name: str | None
    use_tls: bool
    use_ssl: bool
    timeout_seconds: int


def _coalesce_setting(
    settings,
    *names: str,
) -> str | None:
    for name in names:
        value = getattr(settings, name, None)
        if isinstance(value, str):
            stripped = value.strip()
            if stripped:
                return stripped
        elif value is not None:
            return str(value)
    return None


def _coalesce_bool_setting(settings, *names: str, default: bool) -> bool:
    for name in names:
        value = getattr(settings, name, None)
        if isinstance(value, bool):
            return value
        if isinstance(value, str) and value.strip():
            return value.strip().lower() in {"1", "true", "yes", "on"}
    return default


def _coalesce_int_setting(settings, *names: str, default: int) -> int:
    for name in names:
        value = getattr(settings, name, None)
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.strip():
            try:
                return int(value.strip())
            except ValueError:
                continue
    return default


def _load_smtp_config(settings) -> SmtpConfig:
    host = _coalesce_setting(settings, "smtp_host", "smtp_server", "mail_server")
    port_raw = _coalesce_int_setting(settings, "smtp_port", "mail_port", default=0)
    from_email = _coalesce_setting(
        settings,
        "smtp_from_email",
        "smtp_from",
        "mail_from",
        "mail_from_email",
    )

    if not host or not port_raw or not from_email:
        raise ValueError("SMTP is not fully configured.")

    username = _coalesce_setting(settings, "smtp_username", "smtp_user", "mail_username")
    password = _coalesce_setting(settings, "smtp_password", "mail_password")
    from_name = _coalesce_setting(settings, "smtp_from_name", "mail_from_name")
    use_ssl = _coalesce_bool_setting(settings, "smtp_use_ssl", "mail_use_ssl", default=False)
    use_tls = _coalesce_bool_setting(settings, "smtp_use_tls", "mail_use_tls", default=not use_ssl)
    timeout_seconds = _coalesce_int_setting(settings, "smtp_timeout_seconds", default=20)

    return SmtpConfig(
        host=host,
        port=port_raw,
        username=username,
        password=password,
        from_email=from_email,
        from_name=from_name,
        use_tls=use_tls,
        use_ssl=use_ssl,
        timeout_seconds=timeout_seconds,
    )


def _render_template(template_name: str, context: dict[str, str]) -> str:
    template_path = TEMPLATES_DIR / template_name
    template = template_path.read_text(encoding="utf-8")
    return template.format(**context)


def _render_changed_fields_html(changed_fields: list[str]) -> str:
    if not changed_fields:
        return '<tr><td style="padding:4px 0;color:#64748b;">No field details were provided.</td></tr>'
    return "".join(
        f'<tr><td style="padding:4px 0;color:#334155;">'
        f'<span style="color:#6366f1;margin-right:6px;">&#8226;</span>{escape(field)}</td></tr>'
        for field in changed_fields
    )


def _render_changed_fields_text(changed_fields: list[str]) -> str:
    if not changed_fields:
        return "  - No field details were provided."
    return "\n".join(f"  - {field}" for field in changed_fields)


def _build_message(
    *,
    smtp_config: SmtpConfig,
    recipient_email: str,
    subject: str,
    context: dict[str, str],
) -> EmailMessage:
    message = EmailMessage()
    message["To"] = recipient_email
    message["From"] = (
        f"{smtp_config.from_name} <{smtp_config.from_email}>"
        if smtp_config.from_name
        else smtp_config.from_email
    )
    message["Subject"] = subject
    message.set_content(_render_template("user_notification.txt", context))
    message.add_alternative(
        _render_template("user_notification.html", context),
        subtype="html",
    )
    return message


def _send_message_sync(
    *,
    smtp_config: SmtpConfig,
    message: EmailMessage,
) -> None:
    if smtp_config.use_ssl:
        with smtplib.SMTP_SSL(
            smtp_config.host,
            smtp_config.port,
            timeout=smtp_config.timeout_seconds,
            context=ssl.create_default_context(),
        ) as server:
            if smtp_config.username and smtp_config.password:
                server.login(smtp_config.username, smtp_config.password)
            server.send_message(message)
        return

    with smtplib.SMTP(
        smtp_config.host,
        smtp_config.port,
        timeout=smtp_config.timeout_seconds,
    ) as server:
        server.ehlo()
        if smtp_config.use_tls:
            server.starttls(context=ssl.create_default_context())
            server.ehlo()
        if smtp_config.username and smtp_config.password:
            server.login(smtp_config.username, smtp_config.password)
        server.send_message(message)


async def send_user_notification_email(
    *,
    settings,
    recipient_email: str | None,
    recipient_name: str,
    subject: str,
    headline: str,
    intro_text: str,
    summary_text: str,
    actor_name: str,
    changed_fields: list[str],
    organization_name: str | None = None,
    department_name: str | None = None,
) -> tuple[bool, str | None]:
    if not recipient_email:
        return False, "Recipient email is missing for this user."

    try:
        smtp_config = _load_smtp_config(settings)
    except ValueError as exc:
        return False, str(exc)

    context = {
        "recipient_name": recipient_name,
        "headline": headline,
        "intro_text": intro_text,
        "summary_text": summary_text,
        "actor_name": actor_name,
        "organization_name": organization_name or "-",
        "department_name": department_name or "-",
        "changed_fields_html": _render_changed_fields_html(changed_fields),
        "changed_fields_text": _render_changed_fields_text(changed_fields),
    }

    try:
        message = _build_message(
            smtp_config=smtp_config,
            recipient_email=recipient_email,
            subject=subject,
            context=context,
        )
        await asyncio.to_thread(
            _send_message_sync,
            smtp_config=smtp_config,
            message=message,
        )
        return True, None
    except Exception as exc:  # noqa: BLE001
        return False, str(exc)

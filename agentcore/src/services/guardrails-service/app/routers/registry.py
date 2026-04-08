"""REST endpoints for the guardrail catalogue (CRUD)."""

from __future__ import annotations

import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import verify_api_key
from app.database import get_session
from app.models.guardrail_catalogue import (
    GuardrailCatalogueCreate,
    GuardrailCatalogueRead,
    GuardrailCatalogueUpdate,
)
from app.schemas import (
    DemoteGuardrailResponse,
    GuardrailSyncStatusResponse,
    PromoteGuardrailRequest,
    PromoteGuardrailResponse,
)
from app.services import registry_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/v1/guardrails", tags=["guardrail-registry"])


@router.get("", response_model=list[GuardrailCatalogueRead])
@router.get("/", response_model=list[GuardrailCatalogueRead])
async def list_guardrails(
    framework: str | None = None,
    status: str | None = None,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """List all guardrail catalogue entries, optionally filtered by framework or status."""
    return await registry_service.get_guardrails(session, framework=framework, status=status)


@router.post("", response_model=GuardrailCatalogueRead, status_code=201)
@router.post("/", response_model=GuardrailCatalogueRead, status_code=201)
async def create_guardrail(
    body: GuardrailCatalogueCreate,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """Create a new guardrail in the catalogue."""
    return await registry_service.create_guardrail(session, body)


@router.get("/{guardrail_id}", response_model=GuardrailCatalogueRead)
async def get_guardrail(
    guardrail_id: UUID,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """Get a single guardrail by ID."""
    guardrail = await registry_service.get_guardrail(session, guardrail_id)
    if guardrail is None:
        raise HTTPException(status_code=404, detail="Guardrail not found")
    return guardrail


@router.patch("/{guardrail_id}", response_model=GuardrailCatalogueRead)
async def update_guardrail(
    guardrail_id: UUID,
    body: GuardrailCatalogueUpdate,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """Update an existing guardrail in the catalogue.

    Production guardrails are immutable — returns 400 if attempted.
    """
    try:
        guardrail = await registry_service.update_guardrail(session, guardrail_id, body)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    if guardrail is None:
        raise HTTPException(status_code=404, detail="Guardrail not found")
    return guardrail


@router.delete("/{guardrail_id}", status_code=204)
async def delete_guardrail(
    guardrail_id: UUID,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """Delete a guardrail from the catalogue.

    Production guardrails and UAT guardrails with active prod references
    cannot be deleted — returns 409.
    """
    try:
        deleted = await registry_service.delete_guardrail(session, guardrail_id)
    except ValueError as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    if not deleted:
        raise HTTPException(status_code=404, detail="Guardrail not found")


# ---------------------------------------------------------------------------
# Promotion (UAT → PROD)
# ---------------------------------------------------------------------------


@router.post("/{guardrail_id}/promote", response_model=PromoteGuardrailResponse)
async def promote_guardrail(
    guardrail_id: UUID,
    body: PromoteGuardrailRequest,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """Promote a UAT guardrail to production.

    Creates a frozen prod copy (or reuses/updates an existing one).
    Increments prod_ref_count on the UAT record.
    """
    try:
        promoted_by = UUID(body.promoted_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=f"Invalid promoted_by UUID: {body.promoted_by}") from exc

    try:
        prod_read, in_sync = await registry_service.promote_guardrail(session, guardrail_id, promoted_by)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return PromoteGuardrailResponse(
        prod_guardrail_id=str(prod_read.id),
        source_guardrail_id=str(guardrail_id),
        promoted_at=prod_read.promoted_at,
        in_sync=in_sync,
    )


@router.post("/{guardrail_id}/demote", response_model=DemoteGuardrailResponse)
async def demote_guardrail(
    guardrail_id: UUID,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """Decrement prod_ref_count when a production deployment is removed.

    Accepts either a UAT guardrail ID or a prod copy ID.
    """
    try:
        new_count, source_id = await registry_service.demote_guardrail(session, guardrail_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return DemoteGuardrailResponse(
        source_guardrail_id=str(source_id),
        prod_ref_count=new_count,
    )


# ---------------------------------------------------------------------------
# Sync status (UAT vs PROD)
# ---------------------------------------------------------------------------


@router.get("/{guardrail_id}/sync-status", response_model=GuardrailSyncStatusResponse)
async def get_sync_status(
    guardrail_id: UUID,
    session: AsyncSession = Depends(get_session),
    _api_key: str = Depends(verify_api_key),
):
    """Compare a UAT guardrail with its prod copy and return sync status."""
    try:
        status = await registry_service.get_sync_status(session, guardrail_id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    return GuardrailSyncStatusResponse(**status)

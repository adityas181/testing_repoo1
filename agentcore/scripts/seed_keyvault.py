#!/usr/bin/env python
"""Seed Azure Key Vault secrets from a master file (no .env dependency).

Usage:
  python scripts/seed_keyvault.py --master-file ./keyvault_master.env
  python scripts/seed_keyvault.py --master-file ./keyvault_master.env --vault-url https://<vault>.vault.azure.net/

The script:
  - Reads secret name/value pairs from --master-file
  - Writes them directly to Key Vault
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


def _load_env_file(path: Path) -> dict[str, str]:
    env: dict[str, str] = {}
    if not path.exists():
        return env
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        key = key.strip()
        value = value.strip().strip("'\"")
        env[key] = value
    return env


def _required(value: str | None, message: str) -> str:
    value = (value or "").strip()
    if not value:
        raise ValueError(message)
    return value


def main() -> int:
    parser = argparse.ArgumentParser(description="Seed Azure Key Vault secrets for Agentcore backend.")
    parser.add_argument(
        "--master-file",
        required=True,
        help="Path to a dotenv-style file containing KEY_VAULT_SECRET_NAME=VALUE pairs.",
    )
    parser.add_argument("--vault-url", default="", help="Key Vault URL (overrides config/env).")
    parser.add_argument("--tenant-id", default="", help="Azure tenant ID (optional).")
    parser.add_argument("--client-id", default="", help="Azure client ID (optional).")
    parser.add_argument("--client-secret", default="", help="Azure client secret (optional).")
    parser.add_argument("--dry-run", action="store_true", help="Print actions without writing to Key Vault.")
    args = parser.parse_args()

    master_env = _load_env_file(Path(args.master_file))

    vault_url = args.vault_url or os.getenv("AGENTCORE_KEY_VAULT_URL") or master_env.get("KEY_VAULT_URL", "")
    tenant_id = args.tenant_id or os.getenv("AGENTCORE_KEY_VAULT_TENANT_ID") or master_env.get("KEY_VAULT_TENANT_ID", "")
    client_id = args.client_id or os.getenv("AGENTCORE_KEY_VAULT_CLIENT_ID") or master_env.get("KEY_VAULT_CLIENT_ID", "")
    client_secret = args.client_secret or os.getenv("AGENTCORE_KEY_VAULT_CLIENT_SECRET") or master_env.get(
        "KEY_VAULT_CLIENT_SECRET", ""
    )

    vault_url = _required(vault_url, "Key Vault URL is required (--vault-url or AGENTCORE_KEY_VAULT_URL).")

    to_seed: list[tuple[str, str]] = []
    for secret_name, secret_value in master_env.items():
        if secret_name in {
            "KEY_VAULT_URL",
            "KEY_VAULT_TENANT_ID",
            "KEY_VAULT_CLIENT_ID",
            "KEY_VAULT_CLIENT_SECRET",
        }:
            continue
        if not secret_name:
            continue
        secret_value = _required(secret_value, f"Secret value missing for '{secret_name}'.")
        to_seed.append((secret_name, secret_value))

    if not to_seed:
        raise ValueError("No secrets found in master file.")

    if args.dry_run:
        print("Dry run: secrets to be written:")
        for secret_name, _ in to_seed:
            print(f"  - {secret_name}")
        return 0

    from azure.identity import ClientSecretCredential, DefaultAzureCredential
    from azure.keyvault.secrets import SecretClient

    if tenant_id and client_id and client_secret:
        credential = ClientSecretCredential(
            tenant_id=tenant_id,
            client_id=client_id,
            client_secret=client_secret,
            additionally_allowed_tenants=["*"]
        )
    else:
        credential = DefaultAzureCredential(exclude_interactive_browser_credential=True,additionally_allowed_tenants=["*"] )

    client = SecretClient(vault_url=vault_url, credential=credential)

    for secret_name, secret_value in to_seed:
        client.set_secret(secret_name, secret_value)
        print(f"Wrote secret: {secret_name}")

    print("Key Vault seeding complete.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

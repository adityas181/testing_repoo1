# AgentCore — Pre-Deployment Checklist

> **Purpose:** Complete every item below **before** initiating deployment. Missing any item will cause deployment failures.
>
> **Last Updated:** March 2026

---

## 10.1 Infrastructure Readiness

| # | Item | Required Specification | Status |
|---|------|----------------------|--------|
| 1 | Kubernetes Cluster (AKS) | Namespace `micro-test` created, RBAC configured | ☐ |
| 2 | Ingress Controller | TLS termination configured for `https://20.44.53.149.nip.io` | ☐ |
| 3 | PostgreSQL 16+ | Provisioned and accessible from cluster, database `agentcore` created | ☐ |
| 4 | Azure Cache for Redis | Host: `rediscachedatabase1.redis.cache.windows.net`, Port: `6380`, SSL enabled | ☐ |
| 5 | Azure Blob Storage | Container `micro-container` created | ☐ |
| 6 | RabbitMQ (CloudAMQP or self-hosted) | AMQPS endpoint provisioned | ☐ |
| 7 | Neo4j Graph Database | Instance at `neo4j+ssc://877b0527.databases.neo4j.io`, user `neo4j` created | ☐ |
| 8 | Pinecone Vector DB | Index `agentcore-ltm` created with dimension `1536`, region `us-east-1` (AWS) | ☐ |
| 9 | Azure OpenAI | Deployment of `text-embedding-3-small` at `openaipwc.openai.azure.com` | ☐ |
| 10 | Langfuse | Deployed in-cluster at `langfuse-web.micro-test.svc.cluster.local:3000` | ☐ |
| 11 | Azure Monitor Workspace | Prometheus endpoint provisioned (South India region) | ☐ |

---

## 10.2 Azure AD App Registration

| # | Item | Value / Action | Status |
|---|------|---------------|--------|
| 1 | Tenant ID | `7a746742-7931-4f5d-8af3-d2bf6fbb3a15` | ☐ |
| 2 | Client ID | `6c8b172a-2e73-4218-a57d-628cef702b6f` | ☐ |
| 3 | Client Secret | Generated and stored securely | ☐ |
| 4 | Redirect URIs added in Azure Portal | `https://20.44.53.149.nip.io/agents` and `https://20.44.53.149.nip.io/flows` | ☐ |
| 5 | API Permissions | Granted and admin-consented as required | ☐ |

---

## 10.3 Azure Key Vault — Secrets Provisioned

All 24 secrets below must exist in **`agentickeyvaults.vault.azure.net`** before deployment.

### Authentication Method

- [ ] **Option A:** Azure Workload Identity / Managed Identity configured on AKS *(recommended — no client secret needed in env)*
- [ ] **Option B:** Service Principal — Client Secret generated and available for all service configs

### Core Platform Secrets

| # | Secret Name | Description | Status |
|---|------------|-------------|--------|
| 1 | `agentcore-shared-postgres-url` | PostgreSQL connection string | ☐ |
| 2 | `agentcore-backend-secret-key` | Backend signing key (random 256-bit) | ☐ |
| 3 | `agentcore-azure-client-secret` | Azure AD client secret | ☐ |
| 4 | `agentcore-redis-password` | Redis authentication password | ☐ |
| 5 | `agentcore-azure-storage-connection-string` | Blob Storage connection string | ☐ |
| 6 | `agentcore-rabbitmq-url` | RabbitMQ AMQPS URL | ☐ |

### Inter-Service API Keys

| # | Secret Name | Status |
|---|------------|--------|
| 7 | `agentcore-model-service-api-key` | ☐ |
| 8 | `agentcore-mcp-service-api-key` | ☐ |
| 9 | `agentcore-guardrails-service-api-key` | ☐ |
| 10 | `agentcore-pinecone-service-api-key` | ☐ |
| 11 | `agentcore-graph-rag-service-api-key` | ☐ |
| 12 | `agentcore-backend-service-api-key` | ☐ |

### External Service Credentials

| # | Secret Name | Description | Status |
|---|------------|-------------|--------|
| 13 | `agentcore-rag-pinecone-api-key` | Pinecone API key | ☐ |
| 14 | `agentcore-rag-neo4j-password` | Neo4j password | ☐ |
| 15 | `agentcore-ai-search-endpoint` | Azure AI Search endpoint | ☐ |
| 16 | `agentcore-ai-search-api-key` | Azure AI Search API key | ☐ |
| 17 | `agentcore-key-vault-ltm-embedding-api-key` | Azure OpenAI API key (LTM) | ☐ |
| 18 | `agentcore-ado-token` | Azure DevOps PAT (Code Read & Write) | ☐ |

### Observability Secrets

| # | Secret Name | Description | Status |
|---|------------|-------------|--------|
| 19 | `agentcore-langfuse-db-url` | Langfuse PostgreSQL URL | ☐ |
| 20 | `agentcore-langfuse-salt` | Langfuse hashing salt | ☐ |
| 21 | `agentcore-observability-encryption-key` | Observability encryption key | ☐ |
| 22 | `agentcore-grafana-api-key` | Grafana API key | ☐ |
| 23 | `agentcore-prometheus-client-secret` | Prometheus / Azure Monitor secret | ☐ |

### Multi-Region

| # | Secret Name | Description | Status |
|---|------------|-------------|--------|
| 24 | `agentcore-region-registry` | JSON array of region definitions | ☐ |

---

## 10.4 Network & DNS Verification

| # | Verification | Status |
|---|-------------|--------|
| 1 | `https://20.44.53.149.nip.io` resolves and Ingress TLS cert is valid | ☐ |
| 2 | Cluster DNS resolves `*.micro-test.svc.cluster.local` for all services | ☐ |
| 3 | Pods can reach `agentickeyvaults.vault.azure.net` (Key Vault) | ☐ |
| 4 | Pods can reach `rediscachedatabase1.redis.cache.windows.net:6380` | ☐ |
| 5 | Pods can reach PostgreSQL host on port `5432` | ☐ |
| 6 | Pods can reach RabbitMQ AMQPS endpoint | ☐ |
| 7 | Pods can reach `neo4j+ssc://877b0527.databases.neo4j.io` | ☐ |
| 8 | Pods can reach `https://openaipwc.openai.azure.com/` | ☐ |
| 9 | Pods can reach Pinecone API (`us-east-1`) | ☐ |
| 10 | Pods can reach `https://dev.azure.com/` (ADO Git integration) | ☐ |
| 11 | Port `5839` exposed via Ingress/LoadBalancer for Publish Service | ☐ |

---

## 10.5 Git Repository Access

| # | Item | Value | Status |
|---|------|-------|--------|
| 1 | Git Provider | Azure DevOps (`ado`) | ☐ |
| 2 | Repository URL | `https://dev.azure.com/mtcaiml/Application_Agentic_Foundational_PWC/_git/...` | ☐ |
| 3 | Target Branch | `manifest_testing` | ☐ |
| 4 | Manifest Path | `helm_chart/values.yaml` | ☐ |
| 5 | ADO PAT stored in Key Vault | `agentcore-ado-token` with **Code (Read & Write)** scope | ☐ |

---

## 10.6 Configuration Values to Confirm Before Deployment

These values are **currently empty or placeholder** in the production config and **must be set**:

| # | Variable | Current Value | Action Required |
|---|----------|--------------|-----------------|
| 1 | `AGENTCORE_PLATFORM_ROOT_EMAIL` | `""` (empty) | Set to platform administrator email |
| 2 | `MCP_SERVICE_ENCRYPTION_KEY` | `your-secret-key-here` | Replace with a real encryption key |
| 3 | `GLOBAL_LOG_LEVEL` | `DEBUG` | Change to `INFO` for production |
| 4 | `GRAFANA_URL` | `""` (empty) | Set if Grafana dashboards are required |
| 5 | `AZURE_PROMETHEUS_RESOURCE_ID` | `""` (empty) | Set if Azure Monitor metrics are required |
| 6 | `AZURE_PROMETHEUS_TENANT_ID` | `""` (empty) | Set if Azure Monitor metrics are required |
| 7 | `AZURE_PROMETHEUS_CLIENT_ID` | `""` (empty) | Set if Azure Monitor metrics are required |
| 8 | All `*_KEY_VAULT_CLIENT_SECRET` fields | `""` (empty) | Set if **not** using Managed Identity |

---

## 10.7 Container Images

| # | Item | Status |
|---|------|--------|
| 1 | All Docker images built and pushed to container registry | ☐ |
| 2 | Image tags/versions documented for this release | ☐ |
| 3 | Container registry accessible from the AKS cluster | ☐ |
| 4 | Image pull secrets configured in namespace (if private registry) | ☐ |

---

> **Sign-off:** All items above must be marked complete (☐ → ☑) before proceeding to deployment. Any unresolved item should be escalated to the infrastructure or platform team.

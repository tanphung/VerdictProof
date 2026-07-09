# GenLayer dApp Workspace Instructions

This workspace is for building GenLayer dApps. Do not assume the dApp type, product domain, contract behavior, target network, deployment environment, or frontend stack until the user specifies them.

## GenLayer Skills

Use the reusable user-level `genlayer-dapp` skill for GenLayer dApp work.

Prefer the installed `genlayer-dev` plugin skills when available:

- `genlayer-dev:write-contract` for Python Intelligent Contracts.
- `genlayer-dev:genvm-lint` for GenVM linting and lint fixes.
- `genlayer-dev:direct-tests` for fast in-memory direct tests.
- `genlayer-dev:integration-tests` for integration tests against GenLayer environments or Studio.
- `genlayer-dev:genlayer-cli` for deployment, interaction, transaction inspection, and debugging.

Do not use `genlayernode` unless the user explicitly asks for validator node setup.

## Source of Truth

- Use official GenLayer docs and installed GenLayer skills when unsure.
- Use GenLayer docs/MCP if available before making API or command decisions.
- Never invent GenLayer APIs, decorators, storage types, CLI flags, RPC methods, SDK imports, chain names, or frontend calls.
- If docs or tooling are unavailable, say what is unverified before proceeding.

## Expected dApp Structure

Follow the existing repo structure when present. If creating a new project, prefer these conventional locations unless the user asks otherwise:

- `contracts/` for Python Intelligent Contracts.
- `tests/direct/` for direct mode tests.
- `tests/integration/` for integration tests.
- `frontend/` for the dApp frontend.
- `deploy/` for deployment scripts.
- `gltest.config.yaml` or project-specific config for GenLayer test/network configuration.

## Workflow

For contract changes:

1. Inspect existing project scripts and conventions.
2. Write or update Python Intelligent Contracts using current GenLayer patterns.
3. Run GenVM lint when tooling is available.
4. Run relevant direct tests.
5. Run integration tests when a GenLayer environment or Studio is available.
6. Build or typecheck the frontend when contract integration changes.
7. Deploy only after the user confirms the target network/environment and deployment intent.

## Frontend Integration

Use official GenLayerJS docs or existing project wrappers for frontend contract integration. Keep contract addresses, network config, and schemas in explicit config files or environment variables. Prefer typed wrappers in TypeScript frontends.

## Reporting

At the end of GenLayer work, report:

- Which skill or workflow was used.
- What files changed.
- What commands ran.
- What passed, failed, or remains unverified.

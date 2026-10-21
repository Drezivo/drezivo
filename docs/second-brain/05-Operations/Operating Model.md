---
title: Operating Model
type: operations
status: current
owner: Drezivo team
source: "../../runbooks/"
updated: 2026-10-21
tags: [drezivo, operations]
---

# Operating Model

This note is a navigation layer. The procedures in [`docs/runbooks`](../../runbooks/README.md) are authoritative; follow the runbook for the affected service and confirm the target environment before acting. Never put credentials, customer data, or private file details in the vault.

## Release and recovery

- [Deploy](../../runbooks/deploy.md), [release](../../runbooks/release.md), and [rollback](../../runbooks/rollback.md).
- [Environment configuration](../../runbooks/environments.md) and [local development](../../runbooks/local-development.md).

## Incidents and security

- [Incident response](../../runbooks/incident.md), [security incidents](../../runbooks/security-incident.md), and [security automation](../../runbooks/security-automation.md).
- [On-call checklist](../../runbooks/oncall-checklist.md) and [pilot operation](../../runbooks/pilot-operation.md).

## Database, storage, and workers

- [Database migrations](../../runbooks/migrations.md).
- [Object cleanup](../../runbooks/file-object-cleanup.md), [storage migration](../../runbooks/object-storage-migration.md), and [private media delivery](../../runbooks/private-media-delivery.md).
- [Cloud Run worker operations](../../runbooks/worker-cloud-run.md).

## Vault and dated reviews

- [[Hosting the Vault]] describes how to host and maintain this Obsidian vault.
- [[API Security Review 2026-09-23]] is a dated code snapshot; revalidate findings against current code before treating them as active.

---
title: Glossary
type: glossary
status: current
updated: 2026-09-16
tags: [drezivo, glossary]
---

# Glossary

| Term | Definition | Example |
| --- | --- | --- |
| tenant | isolated business account | a clothing rental shop |
| branch | physical location within a tenant | Quezon City branch |
| RLS | PostgreSQL row-level filtering | transaction can see only its tenant |
| outbox | durable post-transaction work | send a confirmation email |
| idempotency key | retry-safe intent identifier | one result after two clicks |
| lease | time-limited job claim | worker recovery after timeout |
| DTO | deliberately limited wire object | public response omits private fields |
| capability token | narrow guest access secret | reservation exchange cookie |
| minor unit | integer smallest currency unit | PHP 1,299 as 129900 centavos |

# AGENTS.md

Scope: documentation in this repository.

The `docs/` directory contains shared product, architecture, database, planning, and implementation reference material for the clothing rental SaaS.

Docs should help future implementation stay aligned with the product:

> A multi-tenant SaaS operating system for clothing rental businesses.

## Core Rules

* Treat product docs as source-of-truth guidance for product intent.
* Keep documentation rental-first, not generic ecommerce-first.
* Preserve the distinction between business-facing SaaS workflows and public customer storefront workflows.
* Keep V1 single-branch and single-garment; fittings and multi-item UI are V1.1. See product/Drezivo-PRD.md.
* Do not casually introduce marketplace behavior, native mobile apps, integrated payment gateways, advanced analytics, AI recommendations, loyalty systems, complex accounting, or enterprise workflows unless explicitly requested.
* Make tenant isolation explicit when documenting data, backend behavior, permissions, or product flows.
* Prefer clear product language over implementation jargon unless the doc is specifically technical.
* Keep docs useful for engineers, product planning, and future agents.

## Source Priority

When product docs conflict, prefer sources in this order:

1. Current owner instructions, then `product/Drezivo-PRD.md` and accepted ADRs; legacy project context is historical.
2. Page, flow, architecture, database, and feature-specific docs.
3. Notes and exploratory documents.

If a conflict cannot be resolved from the docs, call it out instead of silently blending incompatible rules.

## Product Boundaries

* The public storefront is not a marketplace.
* Customers should primarily interact with one business storefront at a time.
* Customer accounts are deferred; V1 is guest checkout.
* Guest checkout requires verified contact before submission; fittings are V1.1.
* Guest reservations and fittings should use secure, unguessable status links.
* V1 payments use GCash or Maya QR images and uploaded receipts.
* Payment status and reservation status are separate concepts.
* Exclusive physical-asset holds expire at their communicated deadline or release on a valid cancellation/rejection.
* A customer cancellation request does not release held availability until the owner processes it.
* Products have variants; each physical garment is separately identified and allocated. One garment per V1 checkout.

## Documentation Style

* Use Markdown with stable, descriptive headings.
* Keep headings and terminology consistent across related docs.
* Prefer short paragraphs and focused bullet lists.
* Use diagrams or `text` code blocks for flows when they make behavior clearer.
* Make V1 versus future scope explicit.
* Avoid duplicating long sections unless the duplication is intentional for a standalone spec.
* Update related docs when a product decision changes.
* Do not leave stale notes that contradict the current product direction without labeling them as historical or superseded.

## Writing Product Specs

* Start from the user or owner workflow, then document the system behavior.
* Explain the business reason for each required field or page.
* Keep customer-facing flows simple and reservation-focused.
* Keep business-facing flows operational and centered on daily rental management.
* Document public versus private information clearly.
* Avoid exposing internal notes, private verification documents, customer information, internal payment details, or other tenants' data in public-facing specs.
* Do not blindly copy existing manual forms. Every documented field should have a reason to exist.

## Technical Docs

* Align technical docs with the backend conventions in `api/AGENTS.md`.
* Use `organization_id` or the established tenant identifier consistently when discussing multi-tenancy.
* Document data ownership and access boundaries for every tenant-owned resource.
* Call out availability, reservation lifecycle, payment status, and fitting status as distinct concepts when relevant.
* Prefer concrete examples that match clothing rental workflows in the Philippines target market.

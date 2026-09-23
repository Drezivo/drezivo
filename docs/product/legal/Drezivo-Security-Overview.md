---
title: Drezivo Security Overview
type: trust-document-draft
status: launch-gated
jurisdiction: Philippines
effective_date: "[INSERT EFFECTIVE DATE]"
owner: "[INSERT LEGAL ENTITY NAME]"
---

# Drezivo Security Overview

**Last updated:** [INSERT DATE]
**Security contact:** [INSERT SECURITY CONTACT EMAIL]

> [!warning] Publish only after verification
> This is proposed customer-facing copy. It must be reviewed against the production configuration,
> security-testing evidence, incident process, and support commitments before it is published. It
> is not a security certification or promise that every incident can be prevented.

## Our security approach

Drezivo is designed to keep each rental business's workspace and customer information separate.
We use layered controls rather than relying on one safeguard: authenticated access, server-side
authorization, tenant and branch checks, protected files, secure development, redacted logs,
monitoring, backups, and incident response.

## Access controls

- Staff access is assigned to individual accounts and limited by role and branch.
- Owners control sensitive actions such as publishing, user management, payment instructions,
  refunds, exports, and account closure.
- Sensitive actions should require recent sign-in verification and multi-factor authentication
  where configured.
- Support access is intended to be time-bound, tenant-specific, reason-recorded, and auditable,
  not a standing unrestricted impersonation role.

## Data and files

- Drezivo is designed to collect only the booking and operational information needed for the
  feature. Government identification is not a default checkout requirement.
- Private receipts, identity documents, and exports are restricted to authorized users. They are
  not public catalogue assets.
- Information is protected in transit and stored through approved service providers. Access to
  private files should use short-lived, authorization-checked links.
- We do not ask businesses to send us payment-card numbers to run the V1 receipt-review workflow.

## Reliable operations

- Booking, availability, payment-evidence, refund, and deposit actions are designed to use
  server-side validation and duplicate-safe transactions.
- Time-sensitive work such as notifications and exports is designed to use durable job records and
  bounded retries rather than untracked background work.
- We plan backup, recovery, monitoring, and incident-response procedures. Specific service-level,
  recovery, and availability commitments are made only in an approved written agreement.

## Shared responsibilities

Each rental business must use individual accounts, protect credentials, remove former staff,
maintain accurate policies and payment instructions, and report suspected compromise promptly.
The business remains responsible for its customer-facing privacy notice, lawful basis for customer
data, merchant policies, payment collection, consumer obligations, and refund decisions.

## Reporting a security issue

Report a suspected security vulnerability through the
[Vulnerability Disclosure Policy](Drezivo-Vulnerability-Disclosure-Policy.md). Account-security or
privacy concerns should be sent to **[INSERT SECURITY OR PRIVACY CONTACT]**.

## Related documents

- [Privacy Policy](Drezivo-Privacy-Policy.md)
- [Data Processing Addendum](Drezivo-Data-Processing-Addendum.md)
- [Acceptable Use Policy](Drezivo-Acceptable-Use-Policy.md)

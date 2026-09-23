---
title: Drezivo Data Retention and Deletion Standard
type: internal-governance-draft
status: approval-required
jurisdiction: Philippines
owner: "[INSERT DATA PROTECTION OWNER]"
last_reviewed: "[INSERT DATE]"
---

# Drezivo Data Retention and Deletion Standard

> [!danger] No retention period is approved yet
> This internal standard creates the control process. It does not authorize indefinite retention or
> establish a production retention period. Philippine counsel, the Data Protection Officer,
> finance/tax owner, security owner, and product owner must approve the completed schedule before
> production personal-data processing begins.

## 1. Purpose

Retention must be tied to a declared purpose, lawful obligation, dispute/claim need, or approved
legitimate business purpose. Drezivo must retain only what is necessary and must securely delete,
anonymize, or irreversibly de-identify data when retention ends. No data category may be retained
indefinitely for a possible future use.

This standard applies to Drezivo account data, rental-business customer data, payment evidence,
files, exports, logs, backups, support records, and data held by subprocessors.

## 2. Required approval record

Before a category enters production, its owner must complete and approve the schedule below. The
public Privacy Policy, DPA, product configuration, backups, and deletion jobs must match it.

| Category | Purpose and lawful basis | Controller / owner | Active retention | Export / closure period | Backup deletion period | Disposal method | Approver | Status |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Drezivo account and billing records | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | Unapproved |
| Tenant catalogue and reservation operations | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | Unapproved |
| Financial, tax, refund, and deposit records | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | Unapproved |
| Payment evidence and private uploads | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | Unapproved |
| Optional government-ID verification | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | Unapproved |
| Security and audit events | [INSERT] | [INSERT] | [INSERT] | N/A | [INSERT] | [INSERT] | [INSERT] | Unapproved |
| Support records | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | [INSERT] | Unapproved |
| Generated exports and temporary uploads | [INSERT] | [INSERT] | N/A | N/A | [INSERT] | [INSERT] | [INSERT] | Unapproved |

## 3. Operating rules

- Collect the minimum data needed for the declared feature. Government ID, date of birth, social
  handles, and other sensitive data are not default fields.
- Apply the shortest approved retention period that meets the documented purpose. A tenant's
  business records, Drezivo's billing records, and a security audit record may have different
  legitimate retention needs.
- On account closure, offer the approved export path, then make tenant data inaccessible and queue
  deletion according to the approved schedule. Never use closure as a shortcut to erase records
  needed for approved returns, refunds, settlement, legal obligations, or a valid dispute.
- Private uploads, exports, and temporary files require a separate expiry. Expiry must revoke
  access as well as delete the object or schedule its secure deletion.
- Backups, replicas, caches, analytics, queues, and subprocessors must have documented deletion or
  expiry behavior. A primary-database delete is incomplete until those paths are accounted for.
- Deletion must be logged with a non-sensitive audit record. A deletion request, hold, export,
  anonymization, and legal-retention exception must be traceable without retaining the erased data.
- A legal hold, fraud investigation, security incident, or dispute can pause deletion only when an
  authorized owner records the reason, scope, start date, review date, and release condition.

## 4. Data-subject and tenant requests

The request workflow must identify whether Drezivo or the rental business is the controller. A
tenant customer usually contacts the rental business first; Drezivo assists its tenant under the
DPA. Verify the requester before disclosure, export, correction, or deletion. Explain any lawful
retention exception and do not remove a record in a way that breaks financial or custody history.

## 5. Verification and review

Before launch and at least annually, the data protection owner must test one representative export,
closure, deletion, backup-expiry, and legal-hold workflow. The test must check that:

1. the user-facing policy matches actual behavior;
2. authorized users can export only their own tenant data;
3. deletion removes or irreversibly de-identifies all primary and derived data on schedule;
4. backups and subprocessors follow their documented lifecycle; and
5. logs and audits contain no secret, token, receipt image, government ID, or unnecessary personal
   data.

## References

- [Privacy Policy](Drezivo-Privacy-Policy.md)
- [Data Processing Addendum](Drezivo-Data-Processing-Addendum.md)
- [Data Privacy Act of 2012](https://privacy.gov.ph/data-privacy-act/)
- [DPA Implementing Rules and Regulations](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/)

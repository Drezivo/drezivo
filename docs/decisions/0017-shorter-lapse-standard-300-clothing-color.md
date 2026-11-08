# 0017: Shorter lapse window, Standard back to 300 garments, one color per clothing

Date: 2026-11-01. Status: accepted (owner QA, 2026-11-01).

## Decisions

1. **Lapse window.** When a paid trial or paid month ends without an approved payment:
   - the storefront stays online without bookings for `STOREFRONT_GRACE_DAYS` = **1** day (was 3);
   - the workspace stays view-only for `READ_ONLY_ACCESS_DAYS` = **7** days (was 30), then locks.

   Both constants live in `contracts/src/tenancy/billing.ts`. Access is still derived at request
   time (`api/src/modules/billing/access.ts`), so the change applies to every lapsed workspace at
   once, including ones already in the old 30-day window.
2. **Standard returns to 300 active garments.** Migration 0090 had raised it to 400 until Growth
   existed. Migration 0093 first moves Gigi's Rental (storefront `gigis-rental`) to Growth
   (₱499, 500 garments), keeping its period, then sets Standard to 300. It stops if any other
   Standard shop holds more than 300 active garments.
3. **Color belongs to the clothing.** The Edit clothing page has one Color field in Clothing
   information and writes it to every variant. Variants keep their `color_label` column, so
   reservations, fittings, the calendar and the storefront read colors unchanged.

## Not done: permanent deletion after the view-only window

The owner asked for workspace data to be permanently deleted once the view-only days end. That is
not implemented. It is irreversible; tenant data spans about 65 tables, including append-only
finance postings whose deletes are revoked on purpose, plus stored files; and the Privacy Policy
and Terms promise 30 days of data retention. A purge needs an agreed retention period, updated
legal text, and a reviewed design (tombstone, storage cleanup, Clerk organization cleanup, dry run)
before it is built. Until then a locked workspace keeps its data.

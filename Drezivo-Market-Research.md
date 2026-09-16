# Drezivo — Market Research and Product Review

**Research date:** 15 September 2026  
**Owner-confirmed pricing:** Starter PHP 300/month; Professional PHP 499/month; Business PHP 1,299/month. Confirmed during this review; conflicting screenshot prices are outdated. Market willingness to pay and contribution margins remain unmeasured.
**Scope:** desk research for a Philippine clothing-rental operations SaaS. This is evidence for a product decision, not proof of product–market fit. No merchant interviews, paid experiments, competitor trials, or production benchmarks were conducted.

## 1. Recommendation

Build a clothing-rental operations product for independent shops first. Lead V1 with reliable booking of a particular garment, clear payment verification, and turnaround management. Validate fittings for V1.1; do not market them as available at launch. Keep the proposed Next.js/TypeScript, Express/TypeScript, Neon PostgreSQL, Clerk, S3, and REST stack. A modular backend and explicit data invariants matter more at this stage than adding infrastructure.

The opportunity is **a locally usable, clothing-specific workflow**, not the invention of online rental booking. The feature gap and willingness to pay remain hypotheses. Branches are a later operating model, but tenant ownership, physical garment identity, and a default branch belong in the initial model.

### Evidence categories

- **Observed:** visible on a first-party page or supplied resource on the research date.
- **Inference:** a product/design conclusion drawn from evidence; not a vendor or market claim.
- **Hypothesis:** something to test with customers before committing price, scale, or roadmap.
- A feature not found in this review is **unverified**, not necessarily absent. Vendor pages describe advertised capabilities; their reliability was not independently tested.

## 2. Competitive landscape

| Alternative | Observed evidence | Implication for Drezivo | Limits of comparison |
|---|---|---|---|
| Booqable | Booking pages, rental inventory, buffers, payments, team permissions, and location-related packaging appear in its feature/pricing material. | These are baseline expectations. Compete on onboarding and clothing operations; do not call a calendar a unique differentiator. | Philippine payment-provider coverage and total localized cost were not tested. |
| TWICE Commerce | Public materials distinguish individual stock units from customer listings; cover returns, maintenance, and multiple sales models. | Separate the physical garment from its catalogue entry. | Its broader circular-commerce positioning does not establish fit for a small gown shop. |
| Goodshuffle Pro | Availability accounts for the item's use window; its help article explains logistics and category buffers. | Availability must include preparation, transit where relevant, and cleaning. | Event-rental workflows differ from clothing fitting and size selection. |
| Rentman | Documents location-aware availability, returns, repairs, and internal movement between locations. | Multi-branch means custody and movement rules, not simply a branch filter. | Equipment/event operations are an adjacent reference, not an exact clothing competitor. |
| Spreadsheets + messaging + paper receipts | Existing PRD identifies this as the intended replacement. | CSV onboarding, owner-created walk-in bookings, and simple daily actions are essential. | Prevalence and switching willingness are unvalidated; interview actual shops. |
| General storefront/site builders | A local rental shop operates a policy page on Wix. | Merchants may already have a usable website; a shareable booking page can avoid forcing a full site migration. | This one example cannot establish market share or demand. |

Sources: [Booqable pricing/features](https://booqable.com/pricing/), [TWICE platform](https://www.twicecommerce.com/), [Goodshuffle availability rules](https://help.goodshuffle.com/en/articles/1643596-understanding-item-availability-and-conflicts), [Rentman location management](https://rentman.io/product-updates/managing-multiple-equipment-locations), [Dress Diary rental policies](https://dressdiarybykelcey.wixsite.com/dress-diary-by-kel-1/terms-conditions-rental-policy).

### What this research does and does not establish

Booqable explicitly includes clothing and costume rentals among its use cases. Drezivo therefore faces general rental software as well as manual alternatives. [Booqable introduction](https://help.booqable.com/en/articles/84961-introduction-to-booqable).

TWICE also documents manual security deposits and post-return maintenance time. Manual payment recording and cleaning buffers are established rental needs; they are not evidence of an exclusive Drezivo advantage. [TWICE feature catalogue](https://www.twicecommerce.com/features).

The review did not establish a reliable count of Philippine clothing-rental establishments, a dominant local SaaS provider, or a verified unmet demand curve. Do not write “no competitors,” “first in the Philippines,” or a clothing-rental TAM using all Philippine MSMEs.

## 3. Philippine context and clothing-specific evidence

### Business segment

DTI's **2023** statistics report 1,241,733 MSMEs, 99.63% of recorded establishments. These are historical, economy-wide figures, not the count of clothing-rental businesses or Drezivo prospects. They support investigating small-business needs, but cannot establish the addressable market. [DTI 2023 MSME statistics](https://dtiwebfiles.s3-ap-southeast-1.amazonaws.com/MSME%20Resources/2023%20Philippine%20MSME%20Statistics%20in%20Brief_as%20of%2022%20November%202024.pdf).

### Payments

BSP's **2024** report puts digital payments at 57.4% of monthly retail payment volume. This is a dated macroeconomic observation, not a clothing-rental payment mix or a claim that 2024 is the latest available year. Cash and externally verified transfers remain appropriate pilot capabilities. [BSP 2024 e-payments report](https://www.bsp.gov.ph/PaymentAndSettlement/2024_Report_on_E-payments_Measurement.pdf).

BSP describes interoperable QR payment use for participating institutions. Drezivo must use the merchant's configured payment instructions and identify the actual payment rail; a displayed QR image does not give Drezivo settlement confirmation or a refund API. [BSP QR information](https://www.bsp.gov.ph/SitePages/MediaAndResearch/Multimedia_QRPh.aspx).

### One direct merchant example

Dress Diary By Kelcey in Las Piñas publicly describes a reservation fee, a separate refundable security deposit, inspection, cleaning, damage, and late-return rules. Its page contains differing descriptions of when the balance is due. This supports modelling **versioned merchant policies**, while illustrating why web copy must not be copied uncritically into universal business rules. It is one shop, not a representative survey. [Merchant policy page](https://dressdiarybykelcey.wixsite.com/dress-diary-by-kel-1/terms-conditions-rental-policy).

**Design inferences:**

1. Track the specific garment: alterations and condition can make two nominally identical dresses operationally different.
2. Store measurements with units; retain item measurements and the accepted booking description. A size label alone does not guarantee fit.
3. Separate event date, pickup, return deadline, and blocked turnaround interval.
4. Distinguish advance payment toward rental charges from refundable security money.
5. Capture condition at release and return, plus itemized approved adjustments and deposit settlement.
6. Let merchants configure policy values. Do not impose a competitor's penalty, non-refund term, or replacement-cost rule.

### Privacy implications

The Philippine privacy framework requires legitimate purpose and proportionality, and limits retention. It does not justify collecting government IDs, date of birth, and social profiles from every renter by default. Recommend minimal booking contact data, optional justified verification, a documented retention schedule, restricted access, and erasure/export workflows. Legal roles and jurisdiction-specific obligations need review before launch. [NPC implementing rules](https://privacy.gov.ph/implementing-rules-regulations-data-privacy-act-2012/), [NPC right to erasure](https://privacy.gov.ph/right-to-erasure-or-blocking/).

## 4. Findings in the supplied PRD and screens

The archive preserves the original PRD. The following observations concern that baseline, not the revised requirements.

| Finding | Evidence in baseline | Required correction |
|---|---|---|
| Uploaded evidence can appear as payment | Original FR-21 and Storefront/(7) Confirmation Details.png display Paid while reservation remains pending | Show proof submitted / awaiting verification. Only merchant verification creates a settled payment. |
| Hold semantics conflict | Original FR-22 only blocks dates after confirmation but also calls a pending item soft-held | Acquire an exclusive expiring hold before displaying payment instructions; confirmation retains the same allocation atomically. |
| Price sources disagree | PRD: PHP 300 / 499 / 1,299; Public/Landing Page/(3) Pricing and FAQ.png: PHP 999 / 1,999 / 3,999 | Owner confirmed PRD prices during review. Use PHP 300 / 499 / 1,299; update the outdated screen when implementing. |
| Current status mixes different concepts | Inventory form offers Available and calendar blocks; calendar displays future rentals and cleaning | Separate actual readiness/custody from availability for a requested interval. |
| Payment examples imply integrations | Original Payments section includes Card/PayPal and customer copy mentions SMS | V1 lists only configured manual methods and email. Do not imply integrations. |
| Staff benefit precedes permissions | Business plan offers staff, but original v1 has only an owner role | Include a minimal safe staff role at launch, or remove staff from every sold plan. Recommended: include it. |
| Customer privacy is overspecified | Original customer detail includes DOB, socials and identity verification | Minimize default fields; justify optional verification and retention. |
| SaaS operating lifecycle absent | Operator controls, billing grace, restore, exports are mostly unspecified | Define them before trusting real business records to the platform. |
| Screenshot success claims too strong | Confirmation screen asserts email was sent | Show notification queued until provider acknowledgment; delivery can still fail. |
| Marketing mixes audiences | Public-site FAQ answers renter questions | SaaS site answers merchant subscription/onboarding questions; tenant storefront explains rental policies. |

Screens reviewed directly for these observations: the confirmation details, add-clothing form, rental calendar, and pricing/FAQ images. All reference images remain unchanged. This review is a requirements audit, not a pixel-by-pixel design audit of every screen.

## 5. Positioning and release strategy

### Recommended first customer

An owner-led Philippine formalwear rental shop with a manageable serialized collection, a single pickup location, and repeat administrative work around reservations and returns. Inventory size, rental frequency, team size, and digital readiness must be measured during discovery; they are not known market averages.

**Proposed promise:** “Know which garment is booked, what is paid, and what needs to be ready next.” Validate that this is more valuable than a generic online storefront.

### Release principles

- **V0:** validate the booking and payment workflow using real merchant examples; run a limited pilot with clear manual support.
- **V1:** single branch, basic owner/staff permissions, inventory, guest bookings, daily operations, receipt review, returns, deposits, exports, audit and recovery.
- **V1.1:** fittings with room/staff/garment capacity, multi-item interface, richer operating tools.
- **V2:** branch inventory, transfer dispatch/receive, branch-scoped teams, consolidated reporting.
- **V3:** larger-company governance and integrations only after proven demand, operational readiness, and contract review.

These are recommended gates, not calendar commitments. If interviews show fittings are necessary for most reservations, promote a minimal fitting workflow into V1 and remove a lower-value feature to preserve scope.

## 6. Pricing and unit economics

The owner confirmed the monthly prices as **PHP 300 / 499 / 1,299** for Starter / Professional / Business. This resolves the source discrepancy and is the authoritative commercial input. It does not itself measure willingness to pay or unit economics. Do not advertise “Most Popular,” unlimited storage/items, or dedicated support without evidence and a support budget. Reliability, basic access control, usable export, and prevention of duplicate bookings should not be premium safety features.

Booqable's public page separates base plans, billing cadence, and add-ons. Exact checkout currency, regional taxation, billing terms, and add-on totals must be verified when making a purchasing comparison. Drezivo should present its own all-in cost clearly rather than compare an ambiguous foreign headline price against a PHP plan. [Booqable pricing](https://booqable.com/pricing/).

### Proposed commercial experiment

Validate conversion and support economics at the confirmed prices with qualified prospects and clearly defined plan scope. Record objections, trial activation, paid conversion, support minutes, asset uploads, monthly reservations, and cancellations. Avoid interpreting “I would pay” as payment evidence. Use transparent pilot terms; do not silently change prices for existing tenants.

Build a per-tenant contribution model:

`net monthly subscription receipts − allocated hosting/database/auth/storage/egress/email cost − payment collection cost − variable support cost`

Then separately subtract engineering, fixed operations, acquisition costs, and taxes to model company viability. Refundable renter deposits are not Drezivo revenue. Merchant rental collections are not Drezivo subscription revenue.

**Illustration only:** PHP 499 net receipts minus PHP 120 technical costs minus PHP 150 support = PHP 229 contribution before fixed costs. The inputs are invented sensitivity values, not vendor quotes or forecasts. At PHP 300 with the same costs, contribution is PHP 30. This illustrates why very low pricing needs real support and usage measurements.

Use bounded asset, storage, seat, and branch allowances with a documented overage process. Count physical active assets, not only styles. Downgrade must not delete records or prevent returns/refunds for already accepted rentals.

## 7. Validation plan before general availability

### Discovery sample — proposal, not completed research

Recruit 12–15 shops spanning owner-only, small teams, and at least three multi-branch operators. The multi-branch interviews assess V2 needs, not a promise of V1 branch support. Include different clothing categories and locations. Observe a recent booking from inquiry through deposit settlement, with permission and redacted records.

Ask for evidence of:

- Last double booking, late return, disputed payment, or damaged garment; how it was resolved.
- Actual inventory identity and size/alteration practices.
- Time spent on fitting arrangements and whether payment precedes fitting.
- Deposit rules, refund timing, payment verification, and cash handling.
- Transfer frequency, stock ownership, and whether branches are one legal business.
- Existing tool cost, migration effort, internet reliability, and willingness to pay now.

### Pilot gates — proposed targets

1. At least five shops complete onboarding with their own catalogue and policies.
2. At least 100 end-to-end rentals across the pilot, including cancellation, late payment, return inspection, and deposit release cases.
3. Zero system-created duplicate allocations or duplicate financial postings; every discovered defect receives a reproducer and regression test.
4. At least four of five shops independently complete the routine pickup/return workflow.
5. Restore exercise succeeds within the proposed TRD recovery targets; no unresolved critical isolation/privacy defect.
6. At least three shops choose to pay under a clearly disclosed pilot offer. This is an early signal, not statistical proof of retention or market fit.

Report sample sizes and distributions, including failed onboarding and churn. Revisit the release plan if fitting-first rental is common or the review-hold deadline causes lost bookings.

## 8. Research limits and next decisions

No paywalled market-size reports were treated as facts; no unsupported CAGR is included. Vendor documentation can change. Sources were reviewed on the date above; historical reports retain their historical year. No conclusion here establishes tax-invoice compliance, security certification, merchant acquiring eligibility, or a vendor SLA for Drezivo.

Decisions still requiring business validation: plan allowances and margins at the confirmed prices; whether fittings must move into V1; maximum manual review window and opening-hours treatment; merchant legal/policy templates; retention periods; hosting region and paid service plans; renter-payment integration provider; enterprise isolation/SSO requirements. Technical defaults and launch gates are provided in the companion documents so development planning can proceed.

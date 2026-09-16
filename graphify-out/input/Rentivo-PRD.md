# Product Requirements Document (PRD)
## Rentivo — Clothing Rental Business Management SaaS

**Version:** 1.0
**Status:** Draft for review
**Owner:** Product Team
**Last updated:** September 15, 2026

---

## 1. Overview

### 1.1 What is Rentivo?
Rentivo is a subscription-based SaaS platform built for **clothing rental businesses** (gown rentals, formal wear, Filipiniana, barong, costumes, bridesmaid dresses, etc.). Rentivo gives each business two things:

1. **A branded public Storefront** where their own customers can browse the catalogue, check availability, and reserve/book clothing — without back-and-forth messaging.
2. **An internal Business System** where the business owner (and staff) manages inventory, reservations, the rental calendar, fittings, customers, and payments — all their day-to-day operations in one place.

Rentivo itself is marketed and sold through a third surface: the **Public Site (rentivo.com)**, where prospective clothing-rental businesses learn about the product, compare pricing plans, and sign up.

### 1.2 Guiding principle
**Keep it simple.** Rentivo's target customers are small-to-mid-size rental businesses (often a single owner-operator or a small team) who are currently using spreadsheets, notebooks, and social media DMs. The product should never feel like enterprise software. Every screen should be understandable without training, every workflow should be shorter than the manual process it replaces, and features should be added only when they remove real friction — not to "cover every edge case."

### 1.3 The three surfaces
| Surface | Audience | Purpose |
|---|---|---|
| **Public Site** ("Rentivo") | Prospective business owners | Marketing, pricing, sign-up |
| **Business System** ("Rentivo" internal dashboard) | Business owner & staff (tenant) | Manage inventory, reservations, calendar, fittings, customers, payments, storefront, settings |
| **Storefront** (e.g. "LuxeRentals") | End customers of each tenant business | Browse catalogue, check availability, reserve, pay deposit via QR |

Each paying business ("tenant") gets one Business System workspace and one Storefront, reachable at a unique URL (e.g. `yourapp.com/store/lunas-gown-rentals`).

---

## 2. Problem Statement

Clothing rental businesses today are commonly stuck with fragmented, manual processes:

1. **Scattered inquiries** — customers message through Instagram, Facebook, or Messenger, and the owner has to track every conversation manually.
2. **Manual tracking** — spreadsheets and notebooks are used to track reservations, inventory, and customer details; this is slow and error-prone.
3. **Scheduling conflicts** — it's hard to know whether an item is available, already rented, or being cleaned, leading to double bookings and lost sales.
4. **Payment hassles** — customers send screenshots or hand over cash, making it difficult to confirm and track transactions properly.
5. **Lost opportunities** — without a proper online store, the business misses customers who just want to browse and book on their own.

Rentivo solves this by centralizing catalogue, availability, reservations, fittings, customers, and payments in one simple system, and by giving each business its own always-on storefront.

---

## 3. Goals & Non-Goals

### 3.1 Goals
- Let a rental business get a working online storefront live in minutes, with no technical setup.
- Give customers a self-serve way to browse, check real-time availability, and reserve clothing without messaging the business directly.
- Let the business owner confirm payment manually via uploaded proof-of-payment before a reservation is locked in (no requirement for a live payment gateway integration in v1).
- Replace spreadsheets with one simple internal system for inventory, reservations, calendar, fittings, customers, and payments.
- Keep the interface simple enough for a non-technical small-business owner to use without training.

### 3.2 Non-Goals (out of scope for v1)
- Real-time, automated payment gateway processing (auto-verified card/e-wallet charges). v1 uses **manual, business-confirmed** QR payments only.
- Multi-location / multi-branch inventory management.
- Native mobile apps (v1 is responsive web only).
- Marketplace / cross-business discovery (customers only browse one business's storefront at a time — each storefront is single-tenant branded).
- Staff role-based permissions beyond a single "Business Owner" role (see Section 9, flagged as a fast-follow).
- Automated SMS delivery (email notifications are in scope; SMS is referenced in copy as a future channel).

---

## 4. Target Users & Personas

### 4.1 Business Owner — primary Business System user
Owns or manages a clothing rental shop (gowns, formal wear, costumes, barong/Filipiniana). Currently uses Instagram/Facebook DMs, spreadsheets, and a paper/Google calendar. Not deeply technical. Wants to spend less time on admin and more time on the business. Needs to see, at a glance, what's happening today (pickups, returns, fittings, pending confirmations) and to confirm payments and reservations quickly.

### 4.2 End Customer — Storefront visitor
Wants to rent a gown or formal outfit for an event (wedding, debut, formal). Browses on mobile or desktop, wants to see availability for her specific event date, and wants a simple way to reserve and pay a deposit without creating an account or messaging back and forth.

### 4.3 Prospective Business Owner — Public Site visitor
Runs (or is starting) a clothing rental business and is evaluating whether to sign up for Rentivo. Wants to quickly understand what the product does, see pricing, and get started with no credit card required.

---

## 5. Information Architecture

### 5.1 Public Site navigation
Features · How It Works · Pricing · FAQ — plus **Sign In** and **Get Started** in the header.

### 5.2 Business System navigation (left sidebar)
Dashboard · Reservations · Calendar · Clothing (Inventory) · Customers · Fittings · Payments · Storefront · Settings

### 5.3 Storefront navigation (per tenant, top nav)
Home · Catalog · Categories · About · Rental Info · Contact — plus wishlist/cart icon and social icons, fully re-brandable per business (logo, name, tagline, colors, photos).

---

## 6. Feature Requirements

### 6.1 Public Site (Marketing & Sign-up)

**FR-1. Landing page — Hero & Problem**
- Hero section: product name/logo, primary value proposition headline ("Run Your Clothing Rental Business Effortlessly"), supporting copy, primary CTA ("Get Started Free") and secondary CTA ("Watch Demo"), trust bullets (Easy to use / No credit card required / Set up in minutes).
- "The Problem" section: 5-step visual breakdown of the pain points rental businesses face today (scattered inquiries, manual tracking, scheduling conflicts, payment hassles, lost opportunities), each with an icon/image and short description.
- Closing CTA banner: "Simplify your operations. Grow your business." + Get Started Free button.

**FR-2. Landing page — Solution & Differentiators**
- "The Solution" section: 4 key value pillars (Centralized Management, Real-Time Availability, Automated & Organized, Designed for Rental Businesses) shown alongside a product screenshot mockup (dashboard + mobile storefront preview).
- "Core Differentiators" grid (6 cards): Smart Availability Tracking, Effortless Reservation Flow, Flexible Payment Options, Happy Customers, Your Storefront Your Brand, Reliable Support — each with an illustrative image, title, and one-line description.
- CTA banner: "Join Rentivo Today."

**FR-3. Landing page — Pricing & FAQ**
- Three-tier pricing table: **Starter, Professional (Most Popular), Business** — monthly PHP pricing, feature checklist per tier (see Section 8), and a "Get Started" button per plan.
- Trust row: No credit card required / Cancel anytime / Dedicated support.
- FAQ accordion (6 default questions: account requirement, payment methods, cancellation/reschedule, returns & late fees, security deposit, delivery vs. pickup).
- "Still have questions?" contact card.
- Footer: logo, Quick Links, Legal (Terms, Privacy, Cookie Settings), social icons, email signup.

**FR-4. Sign up / Sign in**
- New business owners can create an account and are guided into an onboarding flow that creates their Business System workspace and a default (draft/unpublished) Storefront.
- No credit card required to start a trial.

---

### 6.2 Business System (Internal Operations Dashboard)

**FR-5. Dashboard (Home)**
- Personalized greeting ("Good morning, {name}!") with current date.
- "Today's Overview" stat row: Rentals Today, Pickups Today, Returns Today, Fittings Today, Pending Reservations, Overdue Returns (flagged in red, "Requires action").
- **Today's Schedule** — chronological list of the day's events (fitting, pickup, return, reservation, payment) with customer, item, time, and status.
- **Reservations Requiring Attention** — pending confirmation, payment pending, missing information, pickup approaching — each with a one-click "Review" action.
- **Clothing Alerts** — low stock, maintenance required, unavailable items.
- **Returns & Overdue Rentals** — tabbed view (Overdue / Returning Today / Returning Tomorrow) with quick "View"/"View Reservation" actions.
- **Upcoming Rentals** table and **Fitting Appointments** table for the near future.
- **Quick Actions** panel: Add Clothing, Create Reservation, Add Customer, Schedule Fitting.
- **Business Performance** panel: Rental Revenue, Completed Rentals, Average Rental Value, New Customers (this month, with % change vs. prior period) and a short "Your business is growing!" insight.

**FR-6. Reservations**
- Stat cards: Total Reservations, Active Rentals, Upcoming Pickups, Upcoming Returns, Needs Attention.
- Status tabs: All / New / Pending Confirmation / Confirmed / Picked Up / Returned / Completed / Cancelled (each with a live count).
- Search (by customer, reservation #, clothing, or phone), filters, and a date-range picker; export.
- Table columns: Reservation #, Customer, Clothing (thumbnail), Rental Period, Pickup/Return, Delivery method, Payment status, Reservation status, row actions (…).
- Clicking a row opens a **detail side panel**: customer card, rental item(s), rental period, delivery method, payment (amount + status + link to payment detail), verification status (ID upload), notes, and quick actions (Mark as Picked Up, Cancel Reservation, More Actions, View Calendar, View Customer).
- **This is where the business owner manually confirms a reservation** after reviewing the customer's uploaded proof-of-payment (see FR-16/FR-17).

**FR-7. Rental Calendar**
- Date-range navigator (e.g., 2-week view) with filters: Category, Size, Status, specific Clothing item.
- Legend: Reserved / Rented / Pickup / Return / Fitting / Unavailable (color-coded).
- Grid: rows = clothing items (with thumbnail, code, size, price), columns = dates; each booked span renders as a colored bar showing customer name and date range.
- Selecting an item or a bar opens a **detail panel**: item photo, price, availability breakdown by date range (Reserved/Rented/Cleaning/Available), quick actions (View Clothing Details, View All Reservations, Check Availability), and Upcoming Reservations for that item.

**FR-8. Clothing / Inventory**
- Stat cards: Total Clothing, Available, Reserved, Rented, Cleaning, Maintenance, Unavailable.
- Search + filters (category, size, status, more filters).
- Table: Photo, Name, Category, Size, Price/Day, Status (badge), Availability (next open date), row actions (View details / Edit / Archive).
- **Add Clothing** form: multi-photo upload (up to 10, first = main photo), Basic Information (name, category, description), Size & Measurements (size chips, bust/waist/hips), Color, Pricing & Deposit (rental price/day, refundable security deposit), Rental Rules (free-text list), Internal Notes (private, staff-only), an inline **Availability calendar** to block/open dates, and Current Status selector. Primary action "Save Clothing"; secondary "Save and Add Another."
- **Clothing Detail** page (tabs: Overview / Availability / Upcoming Reservations / Rental History / Maintenance): Basic Information, Measurements, Rental Rules, Current Status (condition, cleaning status, location), an availability calendar strip across multiple items, side panels for Upcoming Reservations, Rental History, and Maintenance & Cleaning (last cleaned / next cleaning due).

**FR-9. Manage Categories**
- Card grid of categories (e.g., Gowns, Dresses, Filipiniana, Barong, Costumes, Formal Wear), each showing a representative photo, item count, short description, **Edit** action, and a **Visible** toggle (to show/hide the category on the public storefront).
- **Add Category** action; drag-to-reorder controls the display order on the storefront (per in-app tip).

**FR-10. Customers**
- Stat cards: Total Customers, Active Rentals, New Customers (this month, %), Returning Customers (%).
- Search (name, phone, Instagram/Facebook) + status filter + sort; **Add Customer**.
- Table: Photo/name (+ VIP badge where applicable), Contact Information, Social Media, Total Rentals, Last Rental, Status (Active/New), row action "View."
- **Customer Detail** panel (tabs: Overview / Current Reservations / Rental History / Fitting History / Payment History / Notes): full contact profile (phone, email, socials, address, DOB, preferred contact, customer type), Quick Stats (Total Rentals, Active Reservations, Total Spent, Average Rental Value), current reservations, rental history, fitting history, payment history, and free-text notes. Edit Customer action.

**FR-11. Fittings**
- Stat cards: Upcoming Fittings, Completed Fittings (this month), Cancelled Fittings (this month).
- Search + status/date filters; **Schedule Fitting** action.
- Table: Customer, Date & Time, Clothing, Type, Status (Upcoming/Confirmed/Completed/Cancelled), action "View."
- **Fitting Detail** panel: customer card, Appointment Status + date/time, Fitting Fee, Payment Status (+ link), Appointment Status detail (check-in state), Notes (editable), Related clothing item (link to Clothing Detail), Quick Actions (View Customer, View Reservation, View Calendar).
- **Fitting Schedule & Availability** (settings page): Operating Hours per weekday (with a closed toggle for weekends), Available Days selector, Appointment Duration (dropdown, e.g., 30 minutes), Breaks (start/end time + reason, add/edit/delete), Maximum Appointments Per Slot (stepper), Fitting Fee (currency input). A live "Schedule Overview" summary panel reflects all settings, plus contextual quick tips.

**FR-12. Payments**
- Stat cards: Total Paid, Pending, Failed, Refunded (amount + transaction count each).
- Search (customer, reservation #, payment method) + status/type filters + date range.
- Table: Amount, Customer, Related Reservation/Fitting (with type icon and linked reference), Payment Method (Card, GCash, PayPal, Cash, etc. with masked reference), Status (Paid/Pending/Failed/Refunded badge), Date, row actions.
- This is the ledger view the business owner uses to reconcile manually-confirmed QR/e-wallet payments and cash payments against reservations and fittings.

**FR-13. Manage Storefront**
- Header: publish state (Published/Unpublished) and controls (View Storefront, Preview).
- **Storefront Overview** card: cover photo, logo, business name/tagline, Store URL (copyable), Status + Unpublish action, Social Links, Edit Storefront.
- **Storefront Preview** panel: a live rendered preview of the public storefront, with "Open in new tab" and "Copy Link."
- **Storefront Details**: Business Information (name, description), Contact Information (phone, email, address, social handles), Media (logo, cover image) — each editable.
- **Storefront Status** card confirming the store is live and reachable.
- Four sub-management entry points, each opening a focused settings screen:
  - **Manage Content** — featured clothing, categories, and what appears on the storefront home/catalog.
  - **Manage Policies** — rental duration rules, deposit policy, cancellation policy, other rental terms shown to customers.
  - **Manage Requirements** — what information/documents (e.g., valid ID) are required from customers at checkout.
  - **Manage Settings** — pickup/delivery options and fees, accepted payment methods, customer-facing notifications.

**FR-14. Settings**
- **Business**: Business Information (name, email, phone, address, timezone, currency), Regional Settings, Business Preferences.
- **Notifications**: master toggle for email notifications; separate checklists for **Customer Notifications** (reservation received/confirmed/cancelled, payment received/failed, pickup/return reminders) and **Business Notifications** (new reservation, payment received, cancellation request, overdue return, new fitting appointment); delivery channel and notification-schedule (instant vs. batched) controls.
- **Security**: password management, two-factor authentication toggle.
- **Account**: Profile Information (name, email, phone, photo, role), Authentication (change password, 2FA), Account Preferences (language, date format, time format, timezone), Active Sessions (device list with "Sign out of other devices").

---

### 6.3 Storefront (Per-Tenant Customer-Facing Site)

**FR-15. Storefront Home**
- Branded header (logo, tagline, nav: Home/Catalog/Categories/About/Rental Info/Contact, social icons, cart/wishlist icon).
- Hero banner (photo + welcome message + primary CTA "Browse Collection").
- "Shop by Category" row (category tiles with photo + name, "View All Categories" link).
- "Featured Collection" grid: item card = photo, availability badge (Available/Reserved/Rented/Limited/Unavailable), wishlist heart, name, subcategory, price/duration.
- "Why Choose Us" panel (Premium Quality, Flexible Rental Periods, Convenient & Hassle-Free) + "Rental Information" panel (Rental Duration, Security Deposit, Pickup/Return, Cancellation Policy) — content sourced from Manage Storefront → Policies.
- Footer: logo/tagline, contact info, social links, quick links, copyright.

**FR-16. Catalog**
- Page header banner with title + short description.
- Left filter rail: text search, Categories (with counts), Size, Color (swatches with counts), Price Range slider, Availability (Available/Reserved/Rented/Unavailable, with counts).
- Result grid: item count + Sort dropdown (e.g., Newest First); each card shows availability badge, photo, wishlist heart, name, subcategory, price/duration, size chips, and a status dot + label. Pagination at the bottom.

**FR-17. Clothing Detail**
- Back-to-catalog link. Image gallery (main image + thumbnail strip, prev/next arrows, index counter).
- Title, category, star rating + review count, price/duration, refundable security deposit note, short description, color, available sizes.
- Right-hand **booking card**: availability badge, "Select Rental Dates," primary CTA **"Check Availability"**, secondary "Save to Wishlist," and a Quick Info list (Rental Duration, Pickup/Return, Delivery).
- Lower tab section: Details / Measurements / Rental Info, plus a persistent Rental Information strip (Duration, Pickup/Return, Delivery, Damage Policy, Cancellation Policy).

**FR-18. Reservation flow — Step 1: Dates**
- Opens as an overlay/drawer on top of the clothing detail page, with a persistent item summary (photo, name, price, deposit) and a 3-step progress indicator (**1. Dates → 2. Details → 3. Review**).
- Month calendar with Available (green) vs. Not Available (red/pink) days clearly marked; the customer selects a start and end date.
- Selected Dates summary card (start → end, total days) with an Edit affordance.
- Primary CTA "Continue," reassurance microcopy ("Your information is secure and private.").

**FR-19. Reservation flow — Step 2: Details**
- **Your Information**: Full Name, Contact Number, Email Address, Instagram Username (optional) — all required except where noted.
- **Pickup / Delivery Method**: radio choice of Self Pickup (free), Lalamove (flat delivery fee, Metro Manila), LBC (flat fee, nationwide, 1–3 days), or Other (free-text instructions) — each option shows its fee inline.
- **Verification Required**: optional ID upload to complete the reservation.
- **Rental Dates**: editable Rental Date / Return Date / Event Date fields plus a Rental Duration dropdown; shows Rental Fee per Day and computed Total Rental Fee.
- **Add-ons & Penalties**: optional paid add-ons with stepper quantity controls (e.g., Additional Accessories, Filipiniana Sleeves, Additional Day — each with a per-unit fee) and a mutually-exclusive **Discount** selector (No Discount / Early Bird / 2nd Rental / 3rd Rental — each with a fixed peso discount).
- **Payment Method**: selectable tiles (Cash, GCash, Maya, BPI, etc.).
- **Summary** block: Rental Fee, Add-ons & Penalties, Discount Amount, **Total Amount**, Security Deposit, a **QR code to scan and pay the deposit** (with the business's e-wallet handle shown), and a **Payment Receipt upload** field (required) for the customer to attach proof of payment.
- Primary CTA "Continue"; secondary "Back to Dates."

**FR-20. Reservation flow — Step 3: Review**
- Read-only recap of everything from Steps 1–2, grouped into cards (Clothing Details, Customer Information, Pickup/Delivery, Payment Method, Rental Summary with Total Amount), each with an "Edit" shortcut back to the relevant step.
- **Important Notes** callout: the reservation will be reviewed by the business before it is confirmed; the customer will be notified by email/SMS; they should double-check their contact info.
- Primary CTA **"Confirm Reservation"**; secondary "Back to Details."

**FR-21. Confirmation**
- Success state: checkmark, "Reservation Received," confirmation that details were emailed, the reservation reference number (copyable), and a **Reservation Status badge = "Pending Confirmation"** (this is the crucial rule: the reservation is *submitted*, not yet *confirmed*, until the business verifies the payment).
- Summary card: item photo, size/color, rental period, pickup/return dates, and a cost breakdown (Rental Fee, Security Deposit, Add-ons & Penalties, Discount, Total Amount).
- Customer Information and Pickup/Delivery recap cards, and a Payment card showing method, status (e.g., "Paid" once the receipt is submitted, pending business verification for final confirmation), and reference number.
- "What Happens Next?" explainer and a "Need Help? Contact Business" card.
- Actions: View Reservation, Return to Storefront, Browse More Clothing.

**FR-22. Payment confirmation rule (core business logic)**
This is the defining transaction rule of the product, matching how small rental businesses actually operate in the Philippines today:
1. The customer selects a payment method and scans the business's **static QR code** (GCash/Maya/bank) to pay the security deposit and/or rental fee.
2. The customer **uploads a screenshot/photo of the payment receipt** as proof.
3. The reservation is created with status **"Pending Confirmation"** — the item is soft-held but not guaranteed.
4. The **business owner reviews the uploaded receipt** in the Business System (Reservations or Payments) and manually marks the payment as **Paid** and the reservation as **Confirmed** (or rejects/requests more info if the receipt doesn't match).
5. Only after business confirmation does the reservation move to "Confirmed," blocking the dates on the calendar and inventory.
There is no automatic payment-gateway verification in v1 — this manual-confirm step is intentional, matching the "they themselves confirm the payment before it is booked" requirement, and keeps the system simple and fraud-resistant for small operators.

---

## 7. Status & State Model (shared vocabulary across the system)

| Entity | Statuses |
|---|---|
| **Reservation** | New → Pending Confirmation → Confirmed → Picked Up → Returned → Completed · (or) Cancelled · Late Return (flag) |
| **Clothing Item** | Available · Reserved · Rented · Cleaning · Maintenance · Unavailable |
| **Payment** | Pending · Paid · Failed · Refunded |
| **Fitting Appointment** | Upcoming · Confirmed · Completed · Cancelled |
| **Customer** | New · Active · Returning · VIP (tag) |
| **Storefront** | Draft/Unpublished · Published |

Status badges use consistent colors across every screen (green = good/available/paid/confirmed, blue = in-progress/reserved/upcoming, purple = rented/completed-adjacent, amber/orange = needs attention/pending/cleaning, red = overdue/failed/unavailable/cancelled) so business owners can scan screens quickly without reading every label.

---

## 8. Subscription Plans

| | **Starter** — ₱300/mo | **Professional** — ₱499/mo *(Most Popular)* | **Business** — ₱1299/mo |
|---|---|---|---|
| Clothing items | Up to 50 | Up to 200 | Unlimited |
| Calendar & availability | Basic reservations & calendar | Advanced calendar & availability | Advanced calendar & availability |
| Customer management | ✔ | ✔ | ✔ |
| Transaction tracking | ✔ | Payment tracking | Payment tracking |
| Fittings management | — | ✔ | ✔ |
| Notifications | Email | Email & in-app | Email & in-app |
| Support | — | Priority support | Dedicated support |
| Reporting | — | — | Advanced reporting & analytics |
| Staff accounts | — | — | Multiple staff accounts |
| Branding | Standard storefront | Standard storefront | Custom branding |

All plans: no credit card required to start, cancel anytime, no long-term contract.

Plan tier should gate: item count ceiling, calendar sophistication, fittings module access, notification channels, reporting depth, number of staff logins, and storefront custom-branding options. Enforcement of these limits is a functional requirement of billing/account logic, not just marketing copy.

---

## 9. Roles & Permissions (v1 and fast-follow)

**v1 ships with a single role: Business Owner**, who has full access to their tenant's Business System and Storefront settings. This keeps the mental model simple for the initial launch.

**Fast-follow (flagged, not required for v1):** Staff accounts with restricted permissions (e.g., a front-desk staff role that can manage Reservations, Calendar, Fittings, and Customers but not Settings, Payments configuration, or Storefront branding) — this is explicitly listed as a Business-tier benefit ("Multiple staff accounts") and should be scoped once core v1 is validated.

---

## 10. Non-Functional Requirements

- **Simplicity first:** every workflow should be completable by a non-technical user without a support ticket; avoid unnecessary configuration steps.
- **Multi-tenancy & data isolation:** each business's inventory, customers, reservations, and payments must be fully isolated from other tenants.
- **Responsive design:** the Storefront in particular must work well on mobile, since end customers will primarily browse and book from their phones.
- **Performance:** catalog and calendar views should remain fast with hundreds of clothing items and reservations.
- **Data integrity:** availability shown on the Storefront must always reflect the true state of the Business System calendar in real time (no double-booking).
- **Security & privacy:** customer-uploaded ID/verification images and payment receipts are sensitive — store and access them securely, and only expose them to the owning business.
- **Localization defaults:** default currency PHP, default timezone Asia/Manila, primary market the Philippines (reflected in delivery options like Lalamove/LBC and payment options like GCash/Maya) — but the system should not hard-code these, to allow future markets.
- **Notifications reliability:** confirmation, status-change, and reminder emails must be delivered reliably to both the business and the customer.

---

## 11. Success Metrics

- **Activation:** % of sign-ups that publish a live Storefront within 7 days.
- **Engagement:** average number of reservations processed per active business per month.
- **Conversion (storefront):** Storefront visit → reservation-submitted conversion rate.
- **Time-to-confirm:** median time between a reservation being submitted and being confirmed by the business (a proxy for how much the manual QR-confirmation step slows things down).
- **Retention:** monthly subscription retention / churn by plan tier.
- **Plan upgrade rate:** % of Starter businesses upgrading to Professional/Business as their catalogue grows.

---

## 12. Assumptions & Open Questions

**Assumptions**
- Primary launch market is the Philippines (PHP currency, GCash/Maya/BPI payment rails, Lalamove/LBC delivery integrations referenced as options, not necessarily live API integrations in v1 — QR codes can simply be images the business uploads).
- End customers do **not** need to create an account to browse or reserve (per the FAQ: "No, you can start browsing and making reservations without creating an account... creating an account allows you to track your reservations and rental history"), implying an **optional** customer account layer is a fast-follow, not a v1 blocker.
- One Storefront per business in v1 (no multi-branch/multi-location support yet).

**Open questions for stakeholder review**
1. Should customer accounts (optional login to track reservation history) be in v1 scope, or deferred?
2. Do delivery methods (Lalamove/LBC) need live courier API integration, or are they simply configurable line items with flat fees in v1?
3. Is there a need for a Rentivo-side super-admin panel (for the SaaS operator to manage tenants, billing, and support) — this PRD does not currently define one, and it should be scoped separately if needed.
4. What happens if a reservation's payment receipt is rejected — does the customer get notified in-app, or only by email?
5. Should the Business-tier "multiple staff accounts" and role permissions be scoped now or explicitly deferred to a v1.1 release?

---

## 13. Appendix — Reference Screens Provided

**Public Site:** Hero & Problem · Solution & Differentiators · Pricing & FAQ

**Storefront:** Business Storefront (Home) · Catalog · Clothing Detail · Availability & Date Selection · Customer Information (2 states) · Confirmation (Review) · Confirmation Details (Reservation Received)

**Business System:** Dashboard · Reservations · Rental Calendar · Clothing (list, Add Clothing, Clothing Details) · Manage Categories · Customers (list, Customer Details) · Fittings (Fitting Page, Fitting Details, Fitting Schedule & Availability) · Payments · Manage Storefront · Settings (Account, Business Information, Notifications)
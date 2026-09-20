> Historical reference: where this document conflicts, [current PRD](Drezivo-PRD.md) governs. Original content preserved below.

	# Clothing Rental SaaS — Customer & Business Pages

## 1. Product Page Architecture

The platform is divided into two primary experiences:

- **Customer-facing platform** — discover clothing, check availability, reserve, and manage rentals.
- **Business-facing platform** — manage clothing, availability, reservations, customers, fittings, payments, and rental operations.

The business side is substantially larger because it contains the core SaaS value.

The core distinction is:

```text
CUSTOMER
Discover → Check Availability → Reserve → Manage Rental

BUSINESS
Manage Inventory → Availability → Reservations → Customers → Operations
```

---

# 2. Customer Pages

The customer experience should remain relatively lightweight.

## Public / Storefront

| Page                              | Purpose                                                                      |
| --------------------------------- | ---------------------------------------------------------------------------- |
| **Business Storefront**           | Browse a specific rental business's clothing                                 |
| **Clothing Catalog**              | Browse all clothing and filter by category                                   |
| **Clothing Details**              | Photos, price, size, measurements, description, availability                 |
| **Availability / Date Selection** | Select rental dates and determine whether the item is available              |
| **Reservation Checkout**          | Guest information, email verification, rental details, QR payment, receipt upload |
| **Reservation Confirmation**      | Pending confirmation and secure status access after submitting a request     |

A clothing item should have a shareable public URL because businesses will likely send these links through Instagram, Messenger, Facebook, TikTok, etc.

---

## Customer Account

Customer accounts are optional in V1. A guest can complete a reservation or fitting without signing in. An authenticated customer receives the same booking flow plus a consolidated history.

| Page | Purpose |
|---|---|
| **Customer Dashboard** | Overview of upcoming/current rentals |
| **My Reservations** | List of current and previous reservations |
| **Reservation Details** | Full details of one rental |
| **My Fittings** | Upcoming and previous fitting appointments |
| **Fitting Details** | Details of a specific fitting |
| **Profile / Account Settings** | Basic customer information and account settings |

---

## Customer Authentication

Authentication is optional and must not gate reservation or fitting checkout. Guest checkout verifies the submitted email with a one-time code without creating an account.

| Page / State | Purpose |
|---|---|
| **Customer Sign In / Sign Up** | Email or Google OAuth |
| **Email Verification** | Passwordless verification code |
| **Authentication Success** | Redirect to appropriate customer destination |

Authentication is passwordless:

```text
Email
  ↓
Verification Code
  ↓
Authenticated
```

or:

```text
Google OAuth
  ↓
Authenticated
```

After a guest request is submitted, the customer receives a secure, unguessable email link to view its status and request cancellation. If the customer later creates an account using the same verified email, eligible previous reservations and fittings should appear in the account history.

---

# 3. Business Pages

This is the main SaaS application.

The business side should be structured around the actual rental operational lifecycle rather than generic SaaS modules.

---

## A. Dashboard

### Dashboard

The owner's operational home.

It should answer:

> **"What's happening in my business today?"**

Potential information:

- Today's rentals
- Upcoming pickups
- Upcoming returns
- Today's fittings
- Pending reservations
- Payment status
- Recent activity
- Important alerts

This should be an operational dashboard, not an analytics-heavy dashboard.

---

# B. Reservations

### Reservations

Central place to manage every rental reservation.

Should support:

- Pending reservations
- Confirmed reservations
- Active rentals
- Completed rentals
- Cancelled reservations

### Reservation Details

Detailed view of a reservation:

- Customer
- Clothing
- Rental dates
- Pickup date
- Return date
- Delivery method
- Payment
- Verification
- Status
- Notes

Reservation lifecycle:

```text
Verified Form + Receipt Submitted
 ↓ (selected size is blocked)
Pending Confirmation
 ↓ owner approves
Confirmed
 ↓
Picked Up
 ↓
Returned
 ↓
Completed
```

Alternative states:

```text
Rejected
Cancellation Requested
Cancelled
No-show
Late Return
Damaged
```

Owner rejection releases the selected size. A customer cancellation request does not release it until the owner processes the request. Refunds are coordinated manually outside the platform.

---

# C. Rental Calendar

### Rental Calendar

This deserves its own primary page.

The calendar should allow the owner to understand:

- Which clothing is reserved
- Which clothing is currently rented
- Pickup dates
- Return dates
- Fitting appointments
- Unavailable periods

The most important question it should answer:

> **"Can I rent this clothing item on these dates?"**

This is one of the most important pages in the entire application.

---

# D. Clothing / Inventory

### Clothing

The main clothing management page.

Owners can:

- View clothing styles
- Search
- Filter
- Add clothing
- Edit clothing
- Archive clothing while preserving reservation/history references

### Add Clothing

The current V1 creation UX follows the authoritative style → variant → physical-asset model. The owner enters common data once and Drezivo expands it rather than exposing database mechanics.

Create a clothing style with:

- Shared photos
- Name
- Description
- Category
- Shared color
- One or more selected sizes
- Measurement source per selected size: reusable default guide, custom structured measurements, or none
- Pricing entered once and copied to generated variants: fixed-duration package or daily rate
- Security deposit
- Optional preparation and turnaround buffers

Each selected size creates one variant and one initial physical piece in the V1 UI. This is not a database quantity constraint: later workflows may add multiple physical assets to the same variant when a shop owns duplicate copies of one size.

A business can upload one reusable default measurement-guide image in Settings. New variants may reference that exact guide without duplicating the file. A specific size can opt into custom measurements instead. Replacing the tenant default does not silently rewrite existing clothing that references an older guide.

Availability, reservation state, cleaning, maintenance and custody are intentionally not configured as one mutable “clothing status” during creation. They are handled by the availability/reservation/asset workflows.

### Clothing Details

A detailed view of an individual rental item.

It should show:

- Photos
- Basic information
- Current status
- Rental price
- Availability
- Upcoming reservations
- Rental history
- Maintenance/cleaning state

A product may have several size/color variants. Every actual rentable piece is a serialized physical asset. The V1 Add Clothing flow starts with one physical asset per selected size for simpler data entry, while the underlying model supports multiple pieces of the same variant later. Availability is computed from actual asset allocations and readiness, not from a product-level quantity or status.

### Clothing Availability

This can either be part of Clothing Details or a dedicated availability management experience.

It should allow the owner to see and manage unavailable periods such as:

```text
Reserved
Rented
Cleaning
Maintenance
Unavailable
```

The owner can configure a product-level cleaning buffer. The buffer extends the selected size's blocked period after each return.

---

# E. Customers

### Customers

Central customer directory.

Searchable by:

- Name
- Phone
- Social media information

### Customer Details

Show:

- Customer information
- Current reservations
- Rental history
- Fitting history
- Payment history
- Notes

The important use case is:

> **"Has this customer rented from us before?"**

---

# F. Fittings

### Fitting Appointments

Manage all fitting appointments.

Include:

- Upcoming fittings
- Completed fittings
- Cancelled fittings
- Customer
- Date
- Time
- Status

Guests can request a fitting without an account. After verified email, QR payment, and receipt upload, the selected slot is blocked as pending until the owner approves or rejects it.

### Fitting Details

Show:

- Customer
- Date/time
- Fitting fee
- Payment status
- Notes
- Appointment status

### Fitting Availability / Schedule

Configure:

- Operating hours
- Available days
- Appointment duration
- Breaks
- Maximum appointments per slot
- Fitting fee

---

# G. Payments

For V1, keep this relatively simple.

### Payments

A centralized view of payments associated with:

- Reservations
- Fittings

Show:

- Amount
- Customer
- Related reservation
- Payment method
- Payment status
- Date
- Uploaded receipt

Potential statuses:

```text
Paid
Pending
Failed
Refunded
```

V1 does not integrate PayMongo or another payment gateway. Each business provides a GCash or Maya QR image and payment instructions. Customers upload receipts, owners review them during approval, and any refund is handled manually with the customer.

Do not turn this into a full accounting system yet.

---

# H. Storefront Management

The business needs to manage its public-facing store.

### Storefront

Configure the business's public storefront:

- Business name
- Logo
- Cover image
- Description
- Contact information
- Address
- Social links

### Storefront Preview

Allow the owner to see what customers see.

### Store Settings

Configure:

- Rental policies
- Deposit rules
- Pickup/return policies
- Customer requirements
- Payment settings
- GCash / Maya QR image and payment instructions
- Delivery options

---

# I. Categories

### Categories

Manage clothing categories such as:

- Gowns
- Dresses
- Filipiniana
- Barong
- Costumes
- Formal Wear

This could potentially live under Clothing rather than being a top-level navigation item, depending on how much functionality it eventually has.

---

# J. Business Onboarding

This is not part of the main dashboard, but it is an important page flow.

### Business Setup

After a new business owner authenticates:

```text
Create Business
      ↓
Business Information
      ↓
Storefront Setup
      ↓
Rental Settings
      ↓
Add First Clothing
      ↓
Ready to Launch
```

Do not put all business setup fields directly on the signup page.

Authentication should remain:

```text
Email → Verification Code
```

or:

```text
Google OAuth
```

Then onboarding collects the business information.

---

# K. Settings

### Business Settings

General business configuration.

Potential areas:

- Business information
- Storefront
- Rental policies
- Availability settings
- Fitting settings
- Payment settings
	- Delivery options
- Notifications

### Account Settings

For the business owner's account:

- Name
- Email
- Profile
- Authentication
- Account preferences

---

# 4. Recommended Business Navigation

A starting sidebar structure:

```text
BUSINESS

Dashboard

Reservations
Calendar

Clothing
Customers
Fittings

Payments

Storefront
Settings
```

Within Clothing:

```text
Clothing
 ├── All Clothing
 ├── Categories
 └── Availability
```

Within Reservations:

```text
Reservations
 ├── All
 ├── Pending
 ├── Confirmed
 ├── Active
 └── Completed
```

Not every item necessarily needs to be a separate top-level page. Some should be tabs, filters, nested views, or parts of detail pages.

---

# 5. Overall Platform Architecture

```text
                    PLATFORM
                       │
             ┌─────────┴─────────┐
             │                   │
         CUSTOMER             BUSINESS
             │                   │
       Storefront             Dashboard
             │                   │
       Clothing                Reservations
             │                   │
       Availability             Calendar
             │                   │
       Reservation              Clothing
             │                   │
       Payment                 Customers
             │                   │
       Confirmation             Fittings
                                 │
                              Payments
                                 │
                              Storefront
                                 │
                              Settings
```

---

# 6. Core V1 Pages

If the goal is to avoid overbuilding, prioritize these first.

## Customer

1. **Storefront**
2. **Clothing Catalog**
3. **Clothing Details + Availability**
4. **Guest Email Verification**
5. **Reservation Checkout**
6. **Reservation Confirmation / Secure Status Link**
7. **Fitting Booking**
8. **Optional Customer Account**
9. **My Reservations / Reservation Details**
10. **My Fittings / Fitting Details**

## Business

1. **Dashboard**
2. **Reservations**
3. **Reservation Details**
4. **Rental Calendar**
5. **Clothing**
6. **Add/Edit Clothing**
7. **Clothing Details + Availability**
8. **Customers**
9. **Customer Details**
10. **Fitting Appointments**
11. **Fitting Schedule**
12. **Payments**
13. **Storefront Management**
14. **Business Settings**
15. **Business Onboarding**

---

# 7. Product Priority

The product should remain centered around the rental workflow.

```text
Clothing
   ↓
Availability
   ↓
Reservations
   ↓
Rental Calendar
   ↓
Customers
   ↓
Fittings
   ↓
Payments
   ↓
Storefront
   ↓
Dashboard
```

The **rental availability + reservation + calendar workflow** is the heart of the SaaS.

The customer side should remain simple, while the business side should become the operational system for the rental business.

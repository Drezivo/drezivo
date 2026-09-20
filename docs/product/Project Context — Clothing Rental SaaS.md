> Historical reference: where this document conflicts, [current PRD](Drezivo-PRD.md) governs. Original content preserved below.

# Clothing Rental SaaS — Project Context

## 1. What This Project Is

This project is a **multi-tenant SaaS platform for clothing rental businesses**.

The platform is designed specifically for small-to-medium clothing rental businesses that currently manage their operations through a combination of:

- Instagram
- Facebook
- Messenger
- Google Forms
- Google Sheets
- Manual calendars
- GCash/payment screenshots
- Manual customer communication

The goal is to replace this fragmented workflow with **one simple operating system for their rental business**.

The platform allows clothing rental businesses to:

- Create their own online storefront
- Showcase their rental clothes
- Create shareable links for individual clothing items
- Accept rental reservations
- Manage rental availability
- Manage pickup and return dates
- Manage customers
- Manage fitting appointments
- Track payments
- View everything through a centralized dashboard and calendar

The product should feel like a combination of:

**Online Store + Rental Management System + Booking System + Calendar + Customer Management**

but specifically designed for **clothing rentals**.

---

# 2. Core Product Vision

The core vision is:

> **Manage your entire clothing rental business in one place.**

The platform should eliminate the need for owners to manually track:

- Which dress is available
- Who rented it
- When it will be picked up
- When it will be returned
- Which clothes are currently reserved
- Who has a fitting appointment
- Whether a customer has paid
- Which customers have rented before

The most important concept is **rental availability**.

This is NOT primarily an appointment booking platform.

The core object is:

> **A clothing item whose availability changes across dates.**

---

# 3. Target Market

## Primary ICP

Small-to-medium clothing rental businesses, especially businesses operating primarily through social media.

Examples:

- Gown rental businesses
- Dress rental businesses
- Evening wear rentals
- Wedding gown rentals
- Bridesmaid dress rentals
- Debut dress rentals
- Filipiniana rentals
- Barong rentals
- Formal wear rentals
- Costume rentals
- Pageant dress rentals
- Photoshoot clothing rentals

The initial target market is the **Philippines**.

Instagram and Facebook are especially important acquisition channels because many small rental businesses already use them as their primary storefront.

---

# 4. Existing Customer Workflow

A typical rental business may currently operate like this:

```text
Instagram
    ↓
Customer sends DM
    ↓
Owner answers availability questions
    ↓
Owner sends Google Form
    ↓
Customer submits form
    ↓
Owner checks Google Sheets
    ↓
Owner manually checks calendar
    ↓
Customer sends payment
    ↓
Customer sends payment screenshot
    ↓
Owner verifies payment
    ↓
Owner manually records reservation
    ↓
Owner communicates pickup/return details
```

The SaaS should turn this into:

```text
Instagram
    ↓
Clothing link
    ↓
Online storefront
    ↓
Customer selects clothing
    ↓
Customer selects rental dates
    ↓
Customer submits reservation
    ↓
Customer pays
    ↓
Reservation is automatically recorded
    ↓
Owner sees it in dashboard/calendar
```

---

# 5. Core Product Modules

The initial platform consists of these major modules.

## 5.1 Business / Store

Every rental business gets its own tenant/store.

Example:

```text
yourapp.com/store/business-name
```

Each business should have:

- Business name
- Logo
- Cover image
- Description
- Contact information
- Address
- Instagram
- Facebook
- Store settings
- Rental policies
- Payment settings

Each tenant's data must be isolated from every other tenant.

---

# 6. Online Storefront

Each business gets a public storefront where customers can browse rental clothing.

Example:

```text
Store
├── Home
├── Categories
├── All Clothes
└── Clothing Details
```

The storefront should allow customers to:

- Browse clothing
- View photos
- View pricing
- View sizes
- View descriptions
- View measurements
- View availability
- Start a reservation

The storefront is NOT intended to be a large general-purpose ecommerce website.

Its primary purpose is:

> **Show available rental clothing and convert visitors into reservations.**

---

# 7. Individual Clothing Pages

Every clothing item should have its own public URL.

Example:

```text
yourapp.com/store/business-name/clothing/black-satin-gown
```

This URL can be shared through:

- Instagram
- Facebook
- Messenger
- TikTok
- Link-in-bio
- Direct messages

Example clothing page:

```text
Black Satin Evening Gown

₱1,500 rental

Available sizes:
S / M / L

Description:
Elegant black satin gown suitable for formal events.

[Select Rental Dates]
```

This is an important part of the product because owners can send customers directly to the clothing item they are interested in.

---

# 8. Clothing / Inventory

Clothing is modeled as **style → variant → physical piece**, not as one ecommerce stock row. The Clothing page is primarily catalogue/inventory management; reservation and date availability are handled in their dedicated operational views.

A clothing style contains shared information such as:

- Name
- Photos
- Description
- Category

Each selected size becomes a variant with its size/color, pricing, deposit, rental timing, and measurement source. The Add Clothing UI enters common color/pricing/timing once and copies those values into generated variants instead of asking the owner to repeat the same form for every size.

Measurements may use the tenant's reusable default measurement-guide image, custom structured measurements for a specific size, or no measurements. The default guide is stored once and referenced by many variants; it is not duplicated for every clothing item. Replacing the business default does not silently change variants already referencing an older guide.

In the V1 Add Clothing workflow, selecting Small, Medium, Large, and XL creates four variants and four initial physical pieces. This is a simplified creation rule, not a permanent one-piece-per-size database restriction; multiple physical assets can reference the same variant later when a business owns duplicate copies.

Preparation and turnaround/cleaning buffers belong to variant rental timing and extend the asset's blocked period around a reservation. Reserved, rented, cleaning, maintenance and unavailable are not one mutable product status. Planned blocks come from asset allocations while physical readiness/custody remain separate asset state.

The system must understand that each physical piece can be unavailable for specific dates.

Example:

```text
Black Gown

Sep 10 → Available
Sep 11 → Reserved
Sep 12 → Reserved
Sep 13 → Reserved
Sep 14 → Cleaning
Sep 15 → Available
```

---

# 9. Rental Calendar

The **rental calendar is one of the most important features of the entire product.**

The owner should be able to see clothing availability across dates.

Example:

```text
                Sep 10   Sep 11   Sep 12   Sep 13   Sep 14

Black Gown     Available Reserved Reserved Reserved Cleaning

Red Dress      Reserved Reserved Available Available Available

White Gown     Available Available Reserved Reserved Available

Blue Dress     Available Reserved Reserved Available Available
```

The owner should be able to quickly answer:

> "Is this clothing item available on this date?"

without checking Google Forms, spreadsheets, Messenger, or separate calendars.

---

# 10. Reservation System

Customers should be able to reserve clothing through the storefront. They may reserve as guests; a customer account is optional and must never be required to complete a reservation.

Basic reservation flow:

```text
Select Clothing
      ↓
Select Pickup Date
      ↓
Select Return Date
      ↓
Select Delivery Mode
      ↓
Enter Customer Information
      ↓
Verify Email with One-Time Code
      ↓
Verification / Required Documents
      ↓
View Business GCash / Maya QR Code
      ↓
Pay Deposit and Upload Receipt
      ↓
Submit Pending Reservation
      ↓
Selected Size Is Blocked
      ↓
Owner Approves or Rejects
```

Submitting the completed form and payment receipt immediately blocks the selected size for the requested dates. The hold prevents another customer from requesting overlapping dates while the reservation awaits owner approval.

If the owner approves, the reservation becomes confirmed. If the owner rejects it, the size becomes available again and any refund is coordinated manually with the customer outside the platform.

---

# 11. Reservation Information

The existing customer workflow provides a useful starting point.

Possible reservation fields:

### Customer Information

- Full name
- Email address
- Contact number
- Instagram username
- Facebook account
- Address

### Reservation

- Clothing item
- Pickup date
- Return date
- Delivery mode

### Delivery modes

- Self pickup
- Lalamove
- LBC
- Other configured delivery methods

### Verification

- Valid ID
- Required customer information

The exact fields should be configurable per business where practical.

Email is the canonical verified identity for guest customers. The customer must verify it with a one-time code before submitting. Repeat guest bookings with the same normalized, verified email should reuse the same business customer record.

Do NOT blindly copy every field from the existing Google Form.

Every field should have a reason to exist.

---

# 12. Reservation Status

Reservations should have clear lifecycle states.

Primary flow:

```text
NEW
 ↓
PENDING CONFIRMATION
 ↓
CONFIRMED
 ↓
PICKED UP
 ↓
RETURNED
 ↓
COMPLETED
```

Alternative states may include:

```text
CANCELLATION_REQUESTED
CANCELLED
NO_SHOW
LATE_RETURN
DAMAGED
```

The exact status model can evolve as the product is validated.

---

# 13. Reservation Dashboard

Owners should have a centralized reservation panel.

Example:

```text
Reservations

Today

Customer       Clothing          Pickup      Return      Status
Maria          Black Gown        Sep 8       Sep 10      Confirmed
Jane           Red Dress         Sep 8       Sep 11      Pending
Anna           White Gown        Sep 9       Sep 12      Confirmed
```

Clicking a reservation should show:

- Customer
- Clothing
- Rental dates
- Pickup information
- Return information
- Delivery method
- Payment status
- Verification status
- Notes
- Reservation status

---

# 14. Fitting Appointments

Fitting appointments are a secondary but important feature.

Businesses should be able to configure:

- Fitting fee
- Appointment duration
- Operating hours
- Available days
- Break times
- Maximum appointments per slot

Customer flow:

```text
Book a Fitting
      ↓
Select Date
      ↓
Select Time
      ↓
Enter Name
      ↓
Enter Contact Information
      ↓
Verify Email with One-Time Code
      ↓
View Business GCash / Maya QR Code
      ↓
Pay Fitting Fee and Upload Receipt
      ↓
Submit Pending Fitting
      ↓
Selected Slot Is Blocked
      ↓
Owner Approves or Rejects
```

Fitting requests use the same guest-first, receipt-based approval workflow as reservations. A completed request immediately blocks the selected appointment slot. Approval confirms the fitting; rejection releases the slot.

---

# 15. Unified Business Calendar

The platform should eventually have one calendar containing different business activities.

For example:

```text
September 12

10:00 AM
Fitting — Maria

11:30 AM
Rental — Red Evening Gown

1:00 PM
Fitting — Carla

3:00 PM
Pickup — Black Gown

6:00 PM
Return — White Dress
```

The owner should be able to understand what is happening in the business from one calendar.

Potential calendar filters:

- All
- Rentals
- Pickups
- Returns
- Fittings
- Availability

---

# 16. Payments

V1 uses business-provided GCash or Maya QR codes rather than an integrated payment provider. The owner uploads the QR image and payment instructions for customers to see during reservation and fitting checkout.

The customer pays outside the platform and uploads a receipt as proof. The owner reviews that receipt while approving or rejecting the request. PayMongo, automatic payment verification, and automatic refunds are not part of V1.

When a paid request is rejected or cancelled, the owner coordinates the refund manually with the customer and records the resulting payment state in the platform.

Payment status should be tracked separately from reservation status.

Example:

```text
Reservation: CONFIRMED
Payment: PAID
```

or:

```text
Reservation: PENDING
Payment: UNPAID
```

Do not assume that a reservation status and payment status are the same thing.

---

# 17. Customer Management

Each business should have its own customer records.

Guest checkout creates or reuses a customer record using the customer's normalized, verified email. If that customer later creates an optional account with the same verified email, eligible previous reservations and fittings should appear in their history.

Customer information may include:

- Name
- Phone
- Social media username
- Address
- Rental history
- Fitting history
- Current reservations
- Payment history
- Notes

A customer should be able to have multiple reservations over time.

The goal is to allow the owner to answer:

> "Has this customer rented from us before?"

and:

> "What did this customer rent previously?"

---

# 18. Dashboard

The owner's dashboard should prioritize operational information.

Potential dashboard cards:

```text
Today's Rentals
Today's Fittings
Upcoming Pickups
Upcoming Returns
Pending Reservations
Revenue
```

The dashboard should not initially become an analytics-heavy BI system.

The priority is:

> **Help the owner run today's business.**

---

# 19. Multi-Tenant Architecture

This is a **multi-tenant SaaS**.

Conceptually:

```text
                 SaaS Platform
                      │
       ┌──────────────┼──────────────┐
       ↓              ↓              ↓
   Business A     Business B     Business C
       │              │              │
     Store          Store          Store
     Clothes        Clothes        Clothes
     Customers      Customers      Customers
     Rentals        Rentals        Rentals
     Fittings       Fittings       Fittings
     Calendar       Calendar       Calendar
     Payments       Payments       Payments
```

Every business must have isolated:

- Users
- Clothing
- Customers
- Reservations
- Fittings
- Payments
- Calendar data
- Business settings

Never allow one tenant to access another tenant's business data.

---

# 20. Product Principles

These principles should guide all future development decisions.

## Principle 1 — Rental First

This is a **clothing rental SaaS**, not a generic ecommerce platform.

Features should primarily help with:

- Rental availability
- Reservations
- Pickup
- Return
- Fittings
- Clothing management

---

## Principle 2 — Availability Is the Core

The most important question the system answers is:

> **"Is this clothing available for these dates?"**

Every feature should respect rental availability.

---

## Principle 3 — Reduce Manual Work

If a business currently does something manually using:

- Google Forms
- Google Sheets
- Messenger
- Payment screenshots
- Manual calendar entries

the SaaS should look for opportunities to automate it.

---

## Principle 4 — Simple for Non-Technical Owners

Many target users are small business owners, not software engineers.

The interface should prioritize:

- Simple terminology
- Clear buttons
- Minimal configuration
- Visual calendars
- Obvious statuses
- Mobile-friendly workflows

Avoid unnecessary enterprise complexity.

---

## Principle 5 — Customer Platform Should Be Simple

Customers must be able to reserve clothing and book fittings without creating an account. Customer accounts remain available as an optional convenience for viewing reservation and fitting history.

The customer primarily needs to:

```text
Browse
 ↓
Choose Clothing
 ↓
Check Availability
 ↓
Reserve
 ↓
Verify Email
 ↓
Pay by QR and Upload Receipt
 ↓
Receive Pending Confirmation
```

Guests receive a secure, unguessable link by email for viewing a request and asking for cancellation. A cancellation request does not release the clothing size or fitting slot until the owner processes it.

Both the customer and owner receive email when a reservation or fitting is submitted. Owner dashboard notifications are outside V1.

The **owner dashboard is the more important product surface.**

---

# 21. MVP — What To Build First

The first version should contain:

### Owner

- Authentication
- Business/store setup
- Clothing management
- Clothing photos
- Clothing details
- Rental pricing
- Availability
- Reservation management
- Rental calendar
- Customer management
- Fitting appointments
- Basic payment tracking
- Basic dashboard

### Customer

- Public storefront
- Clothing browsing
- Individual clothing pages
- Date selection
- Availability checking
- Reservation form
- Fitting booking
- Guest email verification
- GCash / Maya QR payment and receipt upload
- Confirmation
- Secure guest reservation and fitting links
- Optional customer account and history

---

# 22. What NOT To Build First

Do NOT expand the MVP unnecessarily.

Avoid initially building:

- AI stylist
- AI recommendations
- Customer social network
- Clothing marketplace
- Multi-vendor marketplace discovery
- Native iOS app
- Native Android app
- Advanced accounting
- Full POS
- Complex warehouse management
- Multiple warehouse support
- Advanced CRM automation
- Loyalty programs
- Referral systems
- Advanced marketing automation
- Complex analytics
- Business intelligence dashboards
- Full delivery management system
- Integrations with every courier
- Complex inventory accounting
- Recommendation engines
- Automated social media posting
- Custom mobile apps for every business
- Enterprise-level permission systems

These may become valuable later, but they are **not the initial product.**

---

# 23. MVP Priority Order

When deciding what to build, prioritize in this order:

```text
1. Clothing
2. Availability
3. Reservations
4. Rental Calendar
5. Customer Management
6. Fittings
7. Payments
8. Storefront
9. Dashboard
10. Advanced features
```

The exact implementation order can change, but the business value hierarchy should remain centered around rental operations.

---

# 24. Product Moat

The long-term value should come from the platform becoming the operational system of the rental business.

Over time, the platform should contain:

```text
Clothing Inventory
       +
Rental Availability
       +
Reservations
       +
Customers
       +
Fittings
       +
Payments
       +
Rental History
       +
Business Operations
```

The more the business operates through the platform, the more useful and difficult-to-replace the platform becomes.

The goal is NOT simply to provide a website.

The goal is:

> **Become the operating system for clothing rental businesses.**

---

# 25. Customer Acquisition Strategy

The initial acquisition strategy should focus heavily on social media.

Potential lead sources:

- Instagram
- Facebook
- TikTok

Look for small-to-medium rental businesses that:

- Have active social media accounts
- Have many clothing posts
- Take reservations through DMs
- Use Google Forms
- Use Google Sheets
- Manually post availability
- Ask customers to send payment screenshots
- Have difficulty communicating availability
- Have multiple clothing items
- Have recurring rental customers

These businesses are likely to experience the problem this SaaS solves.

---

# 26. Lead Validation

Before building a feature, validate it with actual rental businesses.

Important questions to ask owners:

- How do you currently track which clothes are available?
- How do you know if a dress is already reserved?
- How do customers reserve?
- Do you use Google Forms?
- How do you track pickup and return dates?
- How do you handle late returns?
- How do you handle damaged clothing?
- How do you schedule fittings?
- How do you collect payments?
- Do customers send payment screenshots?
- How do you track customers?
- How many reservations do you handle per week?
- What part of the process takes the most time?
- What causes the most mistakes?
- What information do you repeatedly ask customers for?

Do not assume the answers.

The product should be continuously refined based on real business workflows.

---

# 27. Feature Decision Rule

Before implementing a new feature, ask:

### Question 1

Does this directly help a clothing rental business manage rentals?

### Question 2

Does it reduce manual work?

### Question 3

Does it improve availability, reservations, customers, fittings, payments, or rental operations?

### Question 4

Have real rental businesses demonstrated that they need it?

If the answer to most of these is **no**, the feature should probably not be part of the MVP.

---

# 28. Important Product Distinction

This product should NOT be thought of as:

> "Fresha but for clothes."

Fresha can be used as a **reference for SaaS architecture, calendars, booking, business management, and multi-tenancy**, but this product has a different core domain.

The central domain is:

> **Rental inventory and date-based availability.**

The platform should borrow useful concepts from booking platforms while building a domain-specific experience for clothing rentals.

---

# 29. Long-Term Vision

Eventually, the platform could expand into a complete ecosystem for rental businesses.

Possible future modules:

```text
Rental Management
       ↓
Customer CRM
       ↓
Payments
       ↓
Inventory Management
       ↓
Cleaning / Maintenance
       ↓
Delivery
       ↓
Marketing Automation
       ↓
Analytics
       ↓
AI Recommendations
       ↓
Marketplace
```

But expansion should happen **only after the core rental workflow is proven.**

---

# 30. North Star

Every future conversation about this project should keep this statement in mind:

> **We are building a SaaS operating system for clothing rental businesses.**

The core workflow is:

```text
OWNER
Create Store
    ↓
Add Clothing
    ↓
Set Availability
    ↓
Receive Reservation
    ↓
Manage Rental
    ↓
Pickup
    ↓
Return
    ↓
Complete Rental

CUSTOMER
Discover Clothing
    ↓
View Clothing
    ↓
Check Availability
    ↓
Select Dates
    ↓
Reserve
    ↓
Pay
    ↓
Pickup / Delivery
    ↓
Return
```

The **rental calendar + clothing availability + reservation system** are the heart of the product.

Everything else should support that core.

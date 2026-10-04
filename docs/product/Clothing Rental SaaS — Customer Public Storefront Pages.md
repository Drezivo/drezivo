> Historical reference: where this document conflicts, [current PRD](Drezivo-PRD.md) governs. Original content preserved below.

# Clothing Rental SaaS — Customer Public Storefront Pages

## 1. Customer-Facing Architecture

Every business on the platform has a public-facing storefront where customers can discover clothing and make rental reservations.

The customer-facing experience should follow this core journey:

```text
Business Storefront
        ↓
Clothing Catalog
        ↓
Clothing Details
        ↓
Select Rental Dates
        ↓
Check Availability
        ↓
Reservation Checkout
        ↓
Reservation Confirmation
```

The customer experience should be **simple and rental-focused**.

The primary goal is not to create a large ecommerce website.

The goal is:

> **Help customers find clothing, determine whether it is available for their dates, and make a rental reservation.**

---

# 2. Business Storefront

## Purpose

The **Business Storefront** is the public home page of an individual clothing rental business.

Example:

```text
yourapp.com/store/business-name
```

It represents the business itself and provides the customer with a place to:

- Understand the business
- Browse available clothing
- Discover categories
- View important rental information
- Start a reservation

---

## Business Information

The storefront should display the business's public information.

### Business Identity

- Business name
- Logo
- Cover / hero image
- Business description

### Contact Information

- Phone / contact information
- Business address
- Instagram
- Facebook
- Other configured social links

Social links are particularly important because many target businesses acquire customers through social media.

---

## Business Introduction

The storefront should communicate what the business offers.

Examples:

- Clothing rental specialization
- Types of clothing available
- Rental experience
- Location
- Basic business information

Keep this concise.

The storefront is not intended to become a long corporate "About Us" page.

---

## Clothing Discovery

The storefront should make it easy to begin browsing clothing.

Potential elements:

- Featured clothing
- Popular categories
- Recently added clothing
- Browse all clothing

The exact sections should depend on the business's available inventory.

---

## Categories

The storefront can expose the business's clothing categories.

Examples:

```text
Gowns
Dresses
Filipiniana
Barong
Costumes
Formal Wear
Pageant Dresses
Wedding Dresses
```

Categories should help customers quickly narrow down the clothing they are looking for.

---

## Rental Information

The storefront should communicate important business policies before a customer makes a reservation.

Potential information:

- Rental process
- Rental duration
- Security deposit
- Pickup / return process
- Delivery options
- Basic rental rules
- Cancellation policy
- Customer requirements

Only display policies that the business has configured.

---

## Storefront Primary Actions

The storefront should provide clear paths toward:

- Browse Clothing
- View Categories
- View Clothing
- Start Reservation
- Contact Business

The primary action should generally lead the customer toward browsing the rental inventory.

---

# 3. Clothing Catalog

## Purpose

The **Clothing Catalog** is where customers browse the business's complete collection of rental clothing.

Example:

```text
yourapp.com/store/business-name/clothing
```

The primary goal is:

> **Help customers quickly find clothing that matches what they are looking for.**

---

## Clothing Listing

Each clothing item displayed in the catalog should provide enough information for the customer to decide whether they want to open it.

Display:

- Clothing photo
- Clothing name
- Category
- Rental price
- Available size information
- Availability indicator when appropriate

The clothing image should be one of the strongest visual elements because clothing is highly visual.

---

## Categories

Customers should be able to browse or filter by category.

Examples:

```text
All
Gowns
Dresses
Wedding
Debut
Filipiniana
Barong
Costumes
Formal Wear
```

The actual categories come from the individual business.

Do not force a universal category structure on every business.

---

## Search

Customers should be able to search the business's clothing collection.

Search may use:

- Clothing name
- Category
- Relevant descriptive information

Keep search simple.

---

## Filters

Useful filters may include:

- Category
- Size
- Color
- Price range
- Availability

Only introduce filters that provide meaningful value for the business's inventory.

Do not overload the catalog with unnecessary ecommerce filters.

---

## Availability Awareness

Availability is a core concept of the product.

Customers should be able to understand whether clothing is generally:

- Available
- Reserved
- Rented
- Unavailable

However, a general availability indicator should not replace **date-specific availability checking**.

A clothing item may be unavailable for one date range but available for another.

---

## Catalog Empty State

If the business has no active clothing:

```text
No clothing available

This store hasn't added any rental clothing yet.
```

The public storefront should not expose archived clothing.

Only clothing that the business has made publicly available should appear.

---

# 4. Clothing Details

## Purpose

Every clothing item should have its own public page.

Example:

```text
yourapp.com/store/business-name/clothing/black-satin-gown
```

This page is especially important because businesses can share individual clothing links through:

- Instagram
- Facebook
- Messenger
- TikTok
- Link-in-bio
- Direct messages

The goal is to answer:

> **"What is this clothing item, how much does it cost, and can I rent it for my date?"**

---

## Clothing Images

The clothing page should prominently display the item's photos.

Potential image information:

- Main clothing image
- Additional photos
- Different angles
- Details of the clothing

The system supports up to five ordered photos because customers need enough visual context to evaluate rental clothing without an unbounded gallery.

---

## Basic Clothing Information

Display:

- Clothing name
- Category
- Description
- Color
- Rental price

---

## Size Information

Display the available size information.

Examples:

```text
Available sizes:
S / M / L
```

If measurement information is provided by the business, display the selected variant's configured source clearly. A variant may reference the business's reusable measurement-guide image, provide custom structured measurements, or intentionally provide no measurement information.

Potential custom measurements:

- Bust
- Waist
- Hips
- Length
- Other relevant measurements

Do not duplicate the same business measurement-guide image for every product or size. Render the referenced guide when `measurement_mode = default_guide`; render structured values for `custom`; omit the section for `none`. Measurements are particularly important for rental clothing because customers need to determine whether an item is likely to fit.

---

## Rental Price

Clearly display the rental price.

If applicable, also communicate:

- Security deposit
- Additional configured fees

Do not hide the core rental cost until checkout.

---

## Rental Information

Display relevant customer-facing rental rules.

Examples:

- Rental duration
- Pickup requirements
- Return requirements
- Deposit requirements
- Damage policy
- Cancellation policy

Only display information configured by the business.

---

## Availability

The clothing details page should provide a clear path to checking date-specific availability.

Primary action:

```text
Select Rental Dates
```

The customer should not have to contact the business through Messenger just to determine whether the item is available for a particular date.

---

## Clothing Status

The public page should communicate whether the item can currently be rented.

Possible states:

```text
Available
Currently Unavailable
Archived / Not Available
```

Archived clothing should generally not be publicly accessible through normal catalog browsing.

---

# 5. Availability / Date Selection

## Purpose

Availability is one of the most important parts of the entire customer experience.

The system must determine whether a clothing item is available for the customer's requested rental period.

The customer should be able to:

1. Select a size
2. Select a pickup date
3. Select a return date
4. Check availability
5. Continue to reservation if available

---

## Date Selection

The interface should allow the customer to select:

- Size
- Pickup date
- Return date

The system should validate that the selected rental period is valid.

---

## Availability Result

The customer should receive a clear result.

### Available

```text
Available for your selected dates.

September 12 → September 14
```

Allow the customer to continue.

### Unavailable

```text
Not available for these dates.

This item is already reserved during part of your selected rental period.
```

Provide an easy way to select different dates.

---

## Availability Context

Where useful, the customer should be able to understand why the item is unavailable.

For example:

```text
Unavailable
Sep 12–14 — Already reserved
```

Avoid exposing private customer information.

Do not display:

- Another customer's name
- Private reservation information
- Internal business notes

---

## Date-Based Rental Logic

Availability should be based on the actual rental asset and its reservations.

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

The customer should only be offered dates that the business considers available.

Each configured size is one independently bookable unit in V1. A pending request blocks only its selected size for overlapping dates. The product's configured cleaning buffer extends that size's unavailable period after return.

---

## Availability and Clothing Status

Date availability should account for operational states such as:

```text
Reserved
Rented
Cleaning
Maintenance
Unavailable
```

The customer does not necessarily need to see every internal status.

Instead, the system should translate internal availability into a simple customer-facing result:

```text
Available
Not Available
```

---
# 6. Reservation Checkout

## Purpose

The **Reservation Checkout** collects everything required to create a rental reservation.

The goal is to replace the fragmented process of:

```text
Messenger
 ↓
Google Form
 ↓
Google Sheets
 ↓
Payment Screenshot
 ↓
Manual Calendar Entry
```

with one structured reservation flow.

Checkout is guest-first. A customer account is optional and must not be required to reserve clothing.

---

# Rental Summary

The customer should be able to review what they are reserving.

Display:

- Clothing image
- Clothing name
- Rental period
- Pickup date
- Return date
- Rental price
- Security deposit if applicable
- Applicable fees
- Total amount

The customer should be able to verify the dates before submitting the reservation.

---

# Customer Information

The reservation should collect the customer information required by the business.

Potential information:

- Full name
- Email address
- Contact number
- Instagram username
- Facebook account
- Address

Do not automatically require every field.

The business should only collect information that is actually necessary.

The goal is to avoid recreating an unnecessarily long Google Form.

Email is required contact information for guest checkout, but V1 does not verify it or send reservation/fitting messages to it. Reservation status and receipt access use a reservation-scoped HttpOnly API cookie set when the hold is created. After the receipt is submitted, show the reservation proof page, prompt the customer to take a screenshot before leaving, and confirm navigation with a “Done screenshot?” dialog. Match a repeat guest customer only when normalized full name and email both match exactly; never rewrite an existing customer profile from unverified checkout input. Public fitting requests also do not verify email or send guest email.

---

# Delivery / Pickup

The customer should select the configured delivery or pickup method.

Potential options from the current product context include:

- Self pickup
- Lalamove
- LBC
- Other configured delivery methods

The exact options depend on the business.

If additional information is required for a selected delivery method, display the relevant fields.

---

# Verification

If the business requires additional identity verification, the checkout should communicate what is required.

For example:

```text
Verification Required

Please provide the required identification information
to complete your reservation.
```

The exact verification requirements should be determined by the business.

Do not expose verification information unnecessarily after submission.

---

# Payment

The checkout should communicate:

- Payment method
- Payment status
- Deposit if applicable
- Amount due

V1 payment methods are:

- GCash
- Maya

Display the business's configured QR image and payment instructions. The customer pays outside the platform and must upload a receipt before submitting the request.

PayMongo, automatic payment verification, and automatic refunds are not part of V1. The owner reviews the uploaded receipt as part of the approval decision.

---

# Reservation Review

Before submission, provide a clear final summary.

The customer should be able to verify:

```text
Clothing
Rental dates
Pickup / delivery
Customer information
Contact email
QR payment
Uploaded receipt
Total
```

The customer should know exactly what they are submitting.

---

# Reservation Submission

The final action should clearly communicate that the customer is submitting a request for owner approval:

```text
Submit Reservation Request
```

Before submission, make the blocking behavior clear:

```text
Your reservation will be reviewed by the business
before it is confirmed. Once submitted, this size will be
held for your dates while the request is under review.
```

Submitting the verified form and payment receipt creates a pending reservation and immediately blocks the selected size. Another customer cannot submit an overlapping request for that size while the owner decision is pending.

---

# 7. Reservation Confirmation

## Purpose

The confirmation page tells the customer that their reservation process has successfully completed.

It should provide a clear summary and explain what happens next.

---

## Confirmation State

All newly submitted V1 reservations begin in the pending state:

```text
Reservation Received

Your reservation has been submitted and is waiting
for confirmation from the business.
```

Do not show "Confirmed" when the reservation is actually pending.

The customer sees their reservation details on the proof page after submitting the receipt. The customer is not emailed a verification code, receipt, reservation link, or lifecycle update. Owner/business notification behavior is independent and may email the shop according to its configured notification rules.

---

# Reservation Summary

Display:

- Reservation number
- Clothing
- Rental dates
- Pickup date
- Return date
- Delivery method
- Payment status
- Total amount

---

# Customer Information

Show the relevant submitted information so the customer can verify that the reservation was created correctly.

Do not display sensitive verification information unnecessarily.

---

# Next Steps

Clearly explain what the customer should expect next.

Examples:

```text
Your reservation is confirmed.

Pickup:
September 12

Return:
September 14

The business will contact you with any additional
pickup or delivery instructions.
```

Or, for pending reservations:

```text
Your reservation has been received.

The business will review your request and notify you
once it has been confirmed.
```

If the owner approves, the customer is notified that the reservation is confirmed. If the owner rejects it, the selected size is released and the owner coordinates any refund manually with the customer.

---

# Customer Actions

Useful actions after confirmation:

- View Reservation
- Request Cancellation
- Return to Storefront
- Browse More Clothing
- Contact Business

If the customer has an account, the reservation should also become available under their reservation history.

Guests access the reservation through a secure, unguessable link in the confirmation email. They can request cancellation from that page without creating an account. A cancellation request does not release the held size until the owner processes it.

---

# 8. Customer Journey

The complete public rental journey should be:

```text
Business Storefront
        ↓
Browse Categories
        ↓
Clothing Catalog
        ↓
Clothing Details
        ↓
Select Rental Dates
        ↓
Check Availability
        ↓
Available?
   ┌────┴────┐
  NO        YES
   ↓          ↓
Choose       Reservation
Other Dates  Checkout
              ↓
          Customer Info
              ↓
          Pickup / Delivery
              ↓
          Verification
              ↓
            Payment
              ↓
        Reservation Review
              ↓
          Submit
              ↓
        Confirmation
```

---

# 9. Information Relationship Between Pages

The information should flow naturally from one page to the next.

```text
BUSINESS STOREFRONT
    │
    ├── Business Information
    ├── Categories
    ├── Featured Clothing
    └── Rental Policies
            │
            ↓
CLOTHING CATALOG
    │
    ├── Clothing
    ├── Categories
    ├── Sizes
    ├── Prices
    └── Availability
            │
            ↓
CLOTHING DETAILS
    │
    ├── Photos
    ├── Description
    ├── Size
    ├── Measurements
    ├── Price
    ├── Rental Information
    └── Availability
            │
            ↓
AVAILABILITY / DATE SELECTION
    │
    ├── Pickup Date
    ├── Return Date
    └── Availability Result
            │
            ↓
RESERVATION CHECKOUT
    │
    ├── Rental Summary
    ├── Customer Information
    ├── Delivery / Pickup
    ├── Verification
    └── Payment
            │
            ↓
RESERVATION CONFIRMATION
    │
    ├── Reservation Number
    ├── Rental Summary
    ├── Payment Status
    └── Next Steps
```

---

# 10. What Should Be Public vs Private

The public storefront should expose only customer-relevant information.

## Public

- Business name
- Logo
- Cover image
- Business description
- Public contact information
- Address
- Social links
- Public rental policies
- Active clothing
- Clothing photos
- Clothing description
- Clothing sizes
- Clothing measurements
- Rental price
- Public availability
- Reservation process
- Configured pickup/delivery options

## Private

Do NOT expose:

- Internal business notes
- Internal inventory notes
- Other customers' information
- Other customers' reservations
- Internal reservation notes
- Internal payment information
- Internal maintenance notes
- Private verification documents
- Business analytics
- Internal rental history
- Archived/internal clothing data

---

# 11. Core Customer-Side Principle

The public storefront should answer these questions in order:

### 1. What does this business offer?

**Business Storefront**

### 2. What clothing do they have?

**Clothing Catalog**

### 3. Do I like this particular item?

**Clothing Details**

### 4. Can I rent it for my date?

**Availability / Date Selection**

### 5. Can I reserve it?

**Reservation Checkout**

### 6. What happened after I submitted it?

**Reservation Confirmation**

This sequence should remain the foundation of the customer experience.

---

# 12. V1 Customer Public Pages

The initial customer-facing public experience should contain:

1. **Business Storefront**
2. **Clothing Catalog**
3. **Clothing Details**
4. **Availability / Date Selection**
5. **Guest Email Verification**
6. **Reservation Checkout**
7. **Reservation Confirmation / Secure Status**

These pages form the core public rental funnel.

The customer should be able to complete the entire rental reservation journey without needing to communicate manually with the business through Messenger.

Customer authentication is optional. Creating an account adds reservation and fitting history but is not part of the required public booking path.

---

# 13. Important Product Boundary

The customer storefront is **not a marketplace**.

A customer should primarily interact with **one business's storefront at a time**.

The initial experience should be:

```text
Business
   ↓
Its Storefront
   ↓
Its Clothing
   ↓
Its Availability
   ↓
Its Reservations
```

Do not introduce a marketplace-style experience where customers browse clothing from multiple businesses.

A multi-business marketplace may be a future product direction, but it is not part of the initial storefront experience.

---

# 14. North Star

The public customer experience should make this process simple:

> **See the clothing → Check your dates → Reserve it.**

Everything displayed on these pages should support that journey.

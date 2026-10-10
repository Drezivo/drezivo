---
title: Multi-Item Reservations
type: decision
status: current
owner: Product owner
source: "../../decisions/0016-multi-item-reservations-edit-and-balances.md"
updated: 2026-10-10
tags: [drezivo, decision, reservations, payments]
---

# Multi-Item Reservations

A reservation holds 1 to 10 items of any clothing category, booked by staff or from the storefront.
Each item has its own reservation line and physical asset; the delivery fee is charged once. Staff
can edit a reservation before pickup, including adding and removing items. If the total rises after
the renter paid, the difference becomes a separate balance payment that staff collect before
pickup. Delivery is always offered, and unconfigured delivery is arranged with the renter.
Cancelled, expired and rejected reservations can be continued as a new booking.

The accepted [ADR 0016](../../decisions/0016-multi-item-reservations-edit-and-balances.md) is
authoritative.

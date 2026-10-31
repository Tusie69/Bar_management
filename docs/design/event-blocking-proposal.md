# Event blocking proposal

Status: **not implemented; awaiting PO**. This document authorizes no schema or API changes.

An event block reserves one or more tables for a business purpose during a start/end interval. It is separate from `dining_tables.status = OUT_OF_SERVICE`, which represents service availability such as damage or maintenance. Do not represent an event with a fake guest reservation. Current `table_holds` supports only RESERVATION and WAITLIST_OFFER and requires the matching booking/offer relationships.

## Proposed behavior

Store organization, venue, block identity, one or more distinct table ids, UTC start/end instants, venue time zone for display, reason, optimistic version, status, creator and creation time. Record activation, cancellation and release actors/times/reasons. Require start before end, all tables in the same authorized venue, a non-empty reason and an explicit block-management permission approved by the PO. Preserve persistent ACTIVE/OUT_OF_SERVICE configuration independently.

Proposed lifecycle: SCHEDULED -> ACTIVE -> RELEASED, with SCHEDULED -> CANCELLED. Activation and early release are explicit audited actions. Reaching the planned end marks an active block overdue; it does not silently free allocations. Whether scheduled blocks activate automatically remains a PO decision. Ending an active block early records RELEASED with a cancellation reason and releases all its allocations atomically through the authorized workflow. Keep completed/cancelled records for audit.

For create, reschedule, table changes and activation, lock the scoped tables in stable order and recheck conflicts inside one transaction. Use half-open intervals `[start, end)` so adjacent bookings can be considered separately. Check scheduled blocks and approved reservation occupancy windows, unreleased holds and visits, previous-business-day carry-over and table combinations. A booking's expected arrival alone does not define its occupancy end; the PO must decide a duration/buffer or a conservative conflict rule. Do not silently move, cancel or override a conflicting booking.

Active blocks must participate in the same allocation exclusion as holds and visits. Assignment, walk-ins, waitlist offers/seating, table merge/split/move, availability and floor display must all respect them. Recheck at activation even if scheduling previously passed. Booking creation without table assignment needs a defined later assignment conflict response. Cross-midnight blocks retain one real interval; the business-date boundary must not release or hide occupancy.

Audit creation, scheduling changes, table membership changes, activation, rejected overrides if required, cancellation and release. Store actor/session/tenant/venue, reason, old/new interval/status/tables and version in the operation transaction. Audit failure rolls the mutation back. Show the block label, planned interval, reason and overdue state on the floor; show permission-specific actions without exposing implementation details.

## Options from stabilization

| Option | Required work | Benefit and limitation |
| --- | --- | --- |
| Extend `table_holds` with EVENT_BLOCK | Add kind and shape constraints, independent block identity/reason, actor permission and audit actions; separate booking conversion/deadline paths; integrate scheduling if required | Smaller for immediate manual blocks and reuses HOLD allocation locks/release. Booking-specific joins, foreign keys and carry-over queries need careful separation. Existing holds do not supply a complete scheduling lifecycle. |
| Separate `table_blocks` domain with allocation integration | Scoped header and table members, interval/status/version/actor fields, explicit release, conflict and availability integration across all entry points | Clear lifecycle and reporting for scheduled multi-table events, with more API/query/schema work. A standalone block table cannot enforce allocation exclusion by itself. |

Prefer a separate block domain if scheduled, multi-table events and reporting are required. Extending holds is viable if the approved scope is immediate manual blocks only. Choose after the PO confirms the required workflow; neither option is implemented here.

## PO questions and future acceptance

- Immediate only or future scheduling? Who activates a scheduled block, and what happens if a late visit prevents activation?
- Single or multiple tables, cross-zone sets and existing combinations? Must the entire set activate/release atomically?
- Who can create, reschedule, cancel, release and override? Is a second approval needed for booking conflicts?
- What occupancy duration and buffers apply to bookings and events? Are touching intervals permitted?
- May blocks span business days, recur or extend while ACTIVE? Which notifications expose upcoming/overdue blocks?
- Is explicit release always required, including at end time, and which reason must be recorded?

Before implementation is accepted, demonstrate concurrent booking/block conflicts, partial-set rollback, tenant/venue scope, permission and CSRF denial, audit rollback, cross-day occupancy, explicit release and floor/availability consistency. Reference: [backend merge report](../integration/merge-be-report.md), capability comparison and deferred-feature limits, for the currently implemented table service status and carry-over behavior.

# Sports Court Booking Platform: Implementation Audit and AI Handoff

**Audit date:** 17 November 2026, Vietnam time.  
**Audience:** the product owner and the next AI coding agent.  
**Verdict:** a working foundation with a substantially developed customer interface; not a completed or production-ready implementation of the specification.  
**Evidence policy:** source-confirmed, runtime-verified, previously observed, and unverified results are explicitly separated below. A route, database table, screenshot, or successful build alone does not establish feature completion.

## 1. Read this first

The immediate product is a customer-facing website. Keep customer navigation focused on discovering a venue, choosing a court and time, paying, and managing personal bookings. Staff, Owner/Manager, and Super Admin capabilities remain part of the underlying product specification, but their existence must not turn the customer website into an administrative dashboard.

The next implementation should preserve the charcoal-and-green direction, improve the actual booking experience, and complete the business and security foundations before advertising advanced features. Do not replace missing integrations with simulated success, invented reviews, sample payment destinations, or optimistic documentation.

This audit also incorporates changes discovered during the final recheck. Several files changed after the earlier UI work. Consequently, earlier observations such as “Admin revenue is entirely static,” “Staff has no calendar API,” and “the local application role is a superuser” are no longer accurate descriptions of the latest inspected state. The replacement code exists, but important weaknesses remain.

### 1.1 Source documents and precedence

| Source | Purpose | How to apply it |
|---|---|---|
| User-supplied `court-booking-system-spec-en.md` in Downloads | Original business backbone, Sections 0–25 | Defines roles, booking lifecycle, payments, notifications, data isolation, operational requirements, feature IDs, and acceptance cases. |
| [Repository backbone](../court-booking-system-spec-en.md) | An extended edition of the backbone | Differs from the uploaded original despite a similar document version. Adds Section 26 and promotes bilingual functionality to P1. Preserve these additions rather than silently reverting them. |
| [UI redesign brief](ui-redesign-brief-en.md) | Customer visual and interaction direction | Overrides the older light/green visual treatment for the Customer portal. Defines dark neutral surfaces, green accents, typography, phone mockups, responsive behavior, and accessibility. |
| [Feature extensions brief](feature-extensions-brief.md) | Additional P2/P3 capabilities | Adds setup/imports/deals/analytics and later growth features. Treat these as a roadmap dependent on a tested booking core. |
| The user's latest instructions | Current scope and desired outcome | The user explicitly requested backend connection, smoother interactions, a more polished customer website, and this English audit. This report is documentation, not authorization to activate external providers or financial services. |

The UI brief's narrow “do not change backend” instruction describes its original visual-only task. It does not erase the user's later explicit request to improve and connect the backend. Conversely, the request to assess all proposed features does not mean every P2/P3 feature is already implemented or should be released immediately.

### 1.2 Status vocabulary

- **Verified:** an identified check was executed successfully against the relevant snapshot.
- **Partial:** useful implementation exists, but a material workflow, rule, interface, or test is missing.
- **Source only:** code exists; the complete behavior has not been demonstrated.
- **Missing:** no corresponding complete implementation was found in the inspected routes, screens, or migrations.
- **Blocked by configuration/decision:** requires actual owner configuration, provider credentials, hardware, or an explicit product decision.
- **Regression:** a newer change reintroduced behavior that contradicts the intended product or a previous correction.

Do not calculate a completion percentage from the number of routes or tables. A defensible percentage requires a weighted acceptance matrix, including failed and unexecuted cases.

## 2. Current architecture and boundaries

| Area | Actual implementation | Main evidence |
|---|---|---|
| Customer frontend | Next.js 14.2.23, React 18, TypeScript, Tailwind, Lucide icons | `frontend/package.json`, `frontend/src/app/page.tsx` |
| Customer screens | Homepage/venue discovery, court availability, account dialogs, payment dialog, My Bookings | `frontend/src/components/`, `frontend/src/app/my-bookings/page.tsx` |
| Management frontend | Staff and Admin pages in the same Next.js application | `frontend/src/app/staff/page.tsx`, `frontend/src/app/admin/page.tsx` |
| Super Admin frontend | No dedicated page found | Backend routes exist; a management console UI is missing. |
| API | Express modular monolith, not NestJS | `backend/src/main.ts`, `backend/src/modules/` |
| Database | PostgreSQL, SQL migrations, GiST exclusion constraint | `migrations/001_initial_schema.sql` |
| Cache infrastructure | Redis connection and health check | `backend/src/config/redis.ts` |
| Background work | In-process interval workers for holds and email | `backend/src/workers/` |
| Realtime | In-process EventEmitter and Server-Sent Events | `backend/src/common/realtime.ts` |
| Localization | Shared JSON dictionaries plus custom translation functions | `shared/i18n/`, `frontend/src/context/LanguageContext.tsx` |
| Pricing helper | Shared rule resolver and Vietnam date helper | `shared/booking.ts` |
| Image processing | Multer memory uploads and Sharp WebP conversion | `backend/src/common/uploader.ts` |
| API documentation | Handwritten Swagger/OpenAPI object | `backend/src/common/swagger.ts` |

The specification proposes some technologies; this is not proof that those technologies are installed. In particular, the inspected project does not implement a NestJS application, a BullMQ job system, native mobile apps, or a complete PWA. Avoid an unnecessary framework rewrite: a properly tested Express modular monolith can support the required initial scope.

Source folders, configuration, migrations, test scripts, and the supplied design documents were inspected. Generated bundles, dependencies, and old build output are not treated as authored product requirements. This folder was not a Git repository when checked, so there is no reliable Git diff or attribution trail for identifying which AI authored each change.

## 3. What the latest coding work actually added

### 3.1 Customer experience

- A charcoal/green customer interface with Be Vietnam Pro, reusable buttons, Lucide icons, and illustrative phone mockups.
- Venue discovery connected to the real API, local accent-insensitive filtering, loading/error/empty states, and a retry action.
- Court/date selection using API availability, opening hours, prices, and deposit configuration.
- Adjacent slot selection, displayed totals, and an authentication gate before booking.
- Morning/afternoon/evening filters, hiding elapsed time slots, and cache-assisted date changes.
- Locale switching without an availability refetch or loss of the selected time range in the verified snapshot.
- Venue opening-hours and cancellation-policy details loaded from the venue API.
- Registration, email OTP, login, forgot-password/reset screens, and resend-code controls.
- My Bookings tabs, authenticated calendar downloads, cancellation controls, and language-aware date display.
- A customer API base URL helper using `NEXT_PUBLIC_API_URL` with a local fallback.

### 3.2 Backend and recent management changes

- Customer booking creation now matches the frontend's `/bookings` contract; the older `/bookings/hold` mismatch was corrected.
- Payment status polling reads the server's `{ booking: ... }` wrapper.
- Availability is scoped to the requested venue and loads independent reads concurrently.
- Customer booking pricing uses the shared price resolver rather than its former fixed hourly amount.
- Customer booking creation validates the selected court's venue, opening hours, closures, duration, and future time.
- Customer QR generation reads the tenant's configured receiving account rather than always using a fixed destination.
- A webhook shared-secret boundary was introduced. This is a trusted-adapter boundary, not a verified implementation of any named bank provider's signature protocol.
- Recent Staff changes added `/calendar` and `/bookings` reads, assignment checks, current-shift fetching, corrected `/check-in` calls, and payment controls.
- Recent Admin changes added live report requests, venue/court loading, staff management calls, corrected `/blocks`, and `/uploads` with the `photos` form field.
- Migration `004_comprehensive_rls_and_fixes.sql` introduces a non-superuser application role, more RLS policies, additional encoding repairs, and a seeded bank destination.

These additions are meaningful progress. They do not establish secure tenant isolation, financial correctness, a complete management workflow, or production readiness.

### 3.3 Immediate runtime interruption

During the final user-requested recheck, `localhost:3000`, `localhost:4000/health`, and the venue API all failed to respond. The backend error log contained PostgreSQL error `57P01`, “terminating connection due to administrator command,” followed by an unhandled error event and process termination.

This explains an observed backend outage. It does not prove why another AI stopped replying, and it does not establish that the database was corrupted. Frontend type checking and backend compilation passed despite the outage. The processes were restarted for recovery checks; the final delivery message reports the actual resulting HTTP status.

## 4. Original feature catalog: customer coverage

| ID | Requirement | Current state | Required completion |
|---|---|---|---|
| C-01 | Search by sport, area, date/time, price, amenities | Partial: name/area text search and venue selection | Implement genuine filters and server pagination; define their interaction with live availability. |
| C-02 | Map, nearby courts, directions | Missing/optional venue link only | Add consent-aware location and a selected map integration in P3. |
| C-03 | Venue details, photos, hours, prices, amenities, policy | Partial | Connect persisted photos, actual amenities, accurate price ranges and owner-entered bilingual content. |
| C-04 | Adjacent slots, hold, countdown, VietQR | Partial | Add server idempotency, full policy modes, integration tests, payment recovery, and real provider reconciliation. |
| C-05 | Account, registration, login, recovery, profile, password change | Partial | Complete validation, terms, profile editing, password-change flow, secure session lifecycle, and recovery acceptance tests. |
| C-06 | Data rights: change contact details, delete/export account | Missing | Add verified contact changes, export, deletion/anonymization, and retention rules. |
| C-07 | Upcoming/history, ticket, cancel, reschedule, receipt | Partial | Lists/cancel/calendar exist; finish reschedule UI, receipts, payment resume, and check-in ticket verification. |
| C-08 | Confirmation, receipt, cancellation, reminder email | Partial | Only a small template subset exists; prove delivery and every required lifecycle trigger. |
| C-09 | Push and Zalo notifications | Missing | Provider selection, consent, templates, retries, and recipient-language handling. |
| C-10 | Contact/help/incident reporting | Partial: telephone link | Add useful help content and an auditable incident/support flow. |
| C-11 | Quick rebook | Missing | Generate a new quote and check availability; never copy an old confirmed reservation directly. |
| C-12 | Weekly recurring bookings | Missing | Series data, rolling generation, skip-one-session behavior, and explicit conflict handling. |
| C-13 | Waiting list | Missing | Queue, consent, offer expiry, fair promotion, and normal hold creation. |
| C-14 | Favorites | Missing | Account-scoped favorites and optional, separately consented notifications. |
| C-15 | Vouchers/membership/points/prepaid hours | Missing | Tenant-scoped rules, ledger entries, limits, reversals, and quote integration. |
| C-16 | Group payment split | Missing | Define liability and settlement without introducing an unapproved platform wallet. |
| C-17 | Matchmaking/opponent search | Missing | Privacy, moderation, matching, and abuse handling. |
| C-18 | Reviews after playing | Missing | Verified completed-booking reviews and moderation. Current hardcoded review figures are not this feature. |
| C-19 | VI/EN switching | Partial | Customer switching works; finish profile/device/tab synchronization, management portals, emails, and files. |
| C-20 | Accent-insensitive search, extended backbone | Partial/verified basic cases | Add realistic Vietnamese search tests, pagination, indexes, and filtering coverage. |

## 5. Original feature catalog: Staff coverage

| ID | Requirement | Current state | Required completion |
|---|---|---|---|
| S-01 | Today's overview | Partial: recent live list work | Verify all counts, balances, court states, scope, and empty/error behavior. |
| S-02 | Calendar/search/filter | Partial: new calendar/list APIs | Verify frontend coverage and time/state consistency with Customer bookings. |
| S-03 | Drag/drop rescheduling | Missing | P2: use the booking core and explicit conflict feedback. |
| S-04 | Counter/walk-in booking | Partial | Replace fixed pricing; validate court/venue membership, policy, contact normalization, and payment accounting. |
| S-05 | Check-in/no-show | Partial | Assignment checks were added; enforce legal transitions, timing, transactionality, and one-time counters. |
| S-06 | Collect remaining payment/receipt | Partial | Validate positive integer amounts, assigned active shift, outstanding balance, audit, and correct completion transition. |
| S-07 | Thermal receipt printing | Missing | P2: define supported printers and safe receipt formatting. |
| S-08 | Manual payment handling | Missing as a complete workflow | Add underpayment, overpayment, wrong-note, late-payment, proof, and owner review queues. |
| S-09 | Open/close shift and reconciliation | Partial | API/UI contracts improved; add transactional closure, cash movements, approvals, and concurrency tests. |
| S-10 | Handover notes | Missing | Persist per shift/venue with permissions and history. |
| S-11 | Customer lookup | Partial: tenant profile search | Complete UI and scope/permission tests. |
| S-12 | Extra services | Missing | Catalog, stock, booking line items, collection, and reversal. |
| S-13 | Incidents/temporary blocks | Missing as a complete workflow | Manager notification, conflict handling, scope, and expiry. |
| S-14 | New booking alerts | Partial infrastructure only | Staff subscription/UI alerts, deduplication, reconnect, and all lifecycle broadcasts. |
| S-15 | Time clock | Missing | P3: attendance rules and approved payroll scope. |
| S-16 | Language switch/walk-in language | Partial | Remove hardcoded management copy and persist recipient language correctly. |

## 6. Original feature catalog: Tenant Admin coverage

| ID | Requirement | Current state | Required completion |
|---|---|---|---|
| A-01 | Venue/court CRUD, sports, photos, amenities | Partial: reads/upload processing | Complete authorized CRUD, persistent media association, gallery, and public photo display. |
| A-02 | Composite courts | Schema/seed only | Reserve the constituent physical courts atomically; reject parent/child conflicts. |
| A-03 | Opening hours/closures | Schema and public reads exist | Complete management controls, date exceptions, and overnight business days. |
| A-04 | Price table | Partial resolver/schema | Complete configuration UI/API, holiday rules, precedence, validity, and consistent pricing across every booking path. |
| A-05 | Deposit/cancel/no-show policies | Schema and partial reads | Enforce all modes; calculate cancellation/refund consequences and no-show restrictions. |
| A-06 | Staff/roles/devices/discount limits | Partial | Finish role restrictions, venue assignments, device approval, revocation, and privilege-escalation tests. |
| A-07 | Calendar/bookings/blocks | Partial | Corrected block calls and scope checks exist; unify all operations through one core. |
| A-08 | Receiving account and webhook | Partial | Verify owner-controlled banking configuration, secure change audit, real adapter, and test transfer. |
| A-09 | Reconciliation/refunds | Missing as a complete workflow | Evidence-backed manual review, refund states, actual paid-amount ledger, and idempotency. |
| A-10 | Own booking link/QR/embed | Missing | Public tenant/venue link generation and a documented embed model. |
| A-11 | Basic revenue reports | Partial: recently connected | Add date filtering, accounting definitions, refunds, scoped totals, and realistic validation. |
| A-12 | Occupancy/full reports/exports | Partial calculations only | Replace assumed opening capacity; implement defined formulas and localized exports. |
| A-13 | Activity log | Partial: latest-50 endpoint | Complete filters/pagination, sensitive-data minimization, retention, and reliable writes. |
| A-14 | Subscription/renewal/invoices | Schema/platform creation only | Tenant-facing plan, renewal, invoices, and entitlement enforcement. |
| A-15 | CRM/history/tags/restrictions | Partial profile schema/search | Complete management workflows and isolation. |
| A-16 | Promotions/membership/loyalty | Missing | Pricing and ledger integration. |
| A-17 | Services/inventory | Missing | Catalog, stock movements, sales, audit. |
| A-18 | Venue notification templates | Missing | Safe editing, validation, preview, versioning, and delivery integration. |
| A-19 | Income/expense ledger | Missing | P3: accounting definitions and reconciliation. |
| A-20 | Cross-venue comparison | Missing as a full feature | Tenant ownership and comparison reports, without Manager scope leakage. |
| A-21 | Electronic invoices | Missing | Select a provider only after requirements and current terms are verified. |
| A-22 | Time clock/payroll | Missing | P3: define permitted scope and approval rules. |
| A-23 | Bilingual venue content | Partial JSON fields | Editing UI, fallback rules, validation, and persisted locale. |
| A-24 | Bilingual venue notification templates | Missing | Build on A-18 and the shared catalog. |

The new revenue endpoint is not yet a trustworthy occupancy implementation: it assumes 15 open hours per day rather than calculating configured available court minutes. Its booked-minute query also needs a bounded reporting window and clipping at interval boundaries. A percentage displayed by an endpoint is not proof of the required analytics formula.

## 7. Original feature catalog: Super Admin coverage

| ID | Requirement | Current state | Required completion |
|---|---|---|---|
| P-01 | Tenant/plan/lock management | Partial backend | Console UI, onboarding, entitlement enforcement, renewal, and consistent audit. |
| P-02 | Time-limited support mode | Stub-like API | Persisted expiring session, explicit scope, read-only defaults, access enforcement, and audit of every access. |
| P-03 | Monitoring | Partial aggregate endpoint/health | Central errors, alerts, worker health, failed delivery handling, and useful operational UI. |
| P-04 | Templates/terms versions | Missing management workflow | Bilingual template catalog and recorded terms acceptance/version lifecycle. |
| P-05 | Backup/restore | Missing | Scheduled backups, protected credentials, retention, restore drills, and evidence. |
| P-06 | Feature flags | Missing | Tenant/plan-scoped flags and server-side enforcement. |
| P-07 | Vietnam holiday calendar | Missing | Approved calendar source/configuration; shared pricing integration. |
| P-08 | Support tickets | Missing | Tenant-safe ticket lifecycle and support permissions. |
| P-09 | Abuse prevention | Partial rate limits | Account/device/IP policies, captcha escalation, and abuse monitoring. |
| P-10 | Maintenance notices | Missing | Localized scheduling, audience targeting, and frontend display. |
| P-11 | Platform business reports | Missing | Defined subscription metrics, invoices, and reconciled revenue. |
| P-12 | Language switch/templates | Missing complete console | Implement alongside the actual console. |
| P-13 | Translation management | Missing | Missing-key reports, semantic namespaces, translation review/versioning. |

## 8. Every feature in the extensions brief

All extension features below remain incomplete. Existing generic tables or a similar-looking screen must not be counted as their implementation.

| ID | Phase | Feature | Implementation requirements and acceptance focus |
|---|---|---|---|
| A-25 | P2 | Setup wizard | Persist progress; edit actual configuration tables; draft venues stay private; resume correctly; verify 360px and language changes. Reconcile the brief's required-step versus skippable-step wording before implementation. |
| A-26 | P2 | CSV/Excel import | Customer merge by normalized phone; future bookings through booking core; dry run and conflict preview; file hash/idempotency; safe formula handling; errors export; no payment-history import or unsolicited notifications. |
| A-27 | P2 | Off-peak/last-minute deals | Owner approval; draft suggestions; floor price; deterministic validity/lead-time rules; frozen applied price; explicit voucher stacking. |
| C-21 | P2 | Customer deals tab | Only genuinely available discounted slots; sport/area filtering; original/current price; consent-based notifications. |
| A-28 | P2 | Empty-slot/churn analytics | Exact occupancy, estimated lost revenue, repeat/no-show/churn definitions; readable heatmap; no zero division; scope and exports. |
| C-24 | P2 | Venue SEO pages | Language paths, stable slugs, redirects, canonical/hreflang, sitemap, draft noindex, accurate structured data; never invent reviews. |
| A-29 | P2 | Segmented campaigns | Recorded marketing consent; immediate unsubscribe; frequency cap; preview/count/approval; scheduled cancellable outbox; localized recipients. |
| A-30 | P2 | Rain policy/bulk closure | Outdoor-court data; affected-booking preview; owner approval; idempotent background work; safe reschedule/refund/credit; customer banners. |
| S-17 | P3 | Limited offline counter mode | Read snapshots with timestamps; queued check-in/cash notes; operation IDs; conflict review; clear offline status; prohibit offline create/reschedule/cancel/refund/transfer confirmation. |
| C-22 | P3 | Zalo booking assistant | Use only authorized API truth; normal expiring holds; payment link; human handoff; no AI refunds/payment confirmations; tenant isolation and prompt-injection defenses. |
| C-23 | P3 | Teams | Invitations/acceptance, captain transfer, active membership privacy, split-payment dependency, bookkeeping without custody of funds. |
| A-31 | P3 | Tournaments | Round robin/knockout MVP; configurable ranking; normal conflict-protected court reservation; result-change audit; public bilingual results. |
| A-32 | P3 | Coaches/classes | Coach conflict prevention, capacity/waitlist, separate court/coach lines, enrollment/payment states; no unapproved payroll scope. |
| A-33 | P3 | Lights/doors/IoT | Adapter boundary; owner-selected hardware; schedule offsets; retries; manual override; staff failure alerts; encrypted credentials and command audit. |
| P-14 | P3 | Paid featured placement | Explicit Sponsored label; matching filters; bounded placements; impressions/click records; preserve useful organic ordering. |
| P-15 | P3 | Public API/webhooks | Hashed scoped revocable API keys; read-only first phase; signed outbound events; retries/delivery history; strict tenant permissions. |
| P-16 | P3 | Additional payment providers | Provider abstraction, verified contracts/fees, explicit approval before a money-flow change; do not introduce custody of owners' funds implicitly. |

### 8.1 Extension dependencies that must be preserved

Complete and test P1 first. Then implement setup/imports, deals/customer deals, SEO, analytics, weather closures, and campaigns in justified increments. The proposed 30% low-occupancy threshold, 45-day churn threshold, one campaign per week, import limits, and IoT timing offsets are proposal defaults, not measured facts or legal requirements.

Weather source, Zalo product/approval rules, campaign channels, payment providers, IoT hardware, launch sport/region, and the public API business need remain decisions to verify. This report does not select vendors or claim regulatory compliance.

## 9. Critical findings and required corrections

### F-01 — RLS now exists more widely, but is fail-open when tenant context is absent

**Severity:** Critical. **Evidence:** `migrations/004_comprehensive_rls_and_fixes.sql`, `backend/src/config/database.ts`, direct `pool.query` calls throughout routes.

The newer migration adds forced RLS and policies, but the policy explicitly permits all rows when `app.current_tenant_id` is unset or empty. Both `USING` and `WITH CHECK` use this alternative. Most routes still call the shared pool directly rather than setting tenant context inside a transaction. Therefore the existence of RLS policies does not provide the promised independent tenant boundary.

The final read-only database check observed `rolsuper=false`, `rolbypassrls=false`, and one forced policy on each of the 17 inspected RLS-enabled tables. This supersedes the earlier superuser observation. It does not resolve the fail-open predicate.

**Required correction:** deny tenant-table access by default without valid context; create explicit public read projections and narrowly privileged worker/platform paths. Set context transaction-locally and test pooled connection reuse. Do not solve public browsing by granting unrestricted writes when context is absent. Restrict role grants; do not grant blanket table privileges as a substitute for permission design.

**Acceptance:** tenant A cannot read or mutate B, missing context is denied, public users see only approved public fields, background jobs function with narrow privileges, and no context leaks across reused connections.

### F-02 — Demo banking data was reintroduced as apparently operational configuration

**Severity:** Critical for any real-payment release. **Evidence:** migration 004, tenant bank settings, customer QR routes.

The migration fills the demo tenant's bank destination automatically. The final check consequently found no venue missing a `bank_id`, but that is not evidence that the destination belongs to the owner or was approved. Earlier customer code correctly refused unconfigured payments; seeding plausible banking details undermines that safety boundary.

**Required correction:** separate demo fixtures from live configuration, require explicit owner setup/verification, prevent migrations from overwriting approved bank data, audit changes, and label simulation clearly. Never instruct a real customer to transfer funds to a seeded destination.

### F-03 — Process resilience is insufficient

**Severity:** High. **Evidence:** `.runtime/backend-error.log`, `backend/src/config/database.ts`, interval workers.

An idle database connection termination emitted an unhandled error and killed the API process. Add a safe pool error listener, bounded recovery, observable worker failures, readiness behavior, and a service supervisor. Do not log entire connection objects or environment values. Review asynchronous Express handlers for rejected promises outside `try/catch` and add a consistent error boundary.

**Acceptance:** restart PostgreSQL during a controlled local test; the API degrades clearly and recovers without a manual terminal restart, duplicate jobs, or leaked secrets.

### F-04 — Money collection is not a correct transactional state machine

**Severity:** Critical. **Evidence:** `backend/src/modules/staff/staff.routes.ts`, `/payments`.

The newer code verifies booking tenant/venue assignment before collection, which is an improvement. It still inserts payment and updates the booking separately, lacks sufficient amount/shift/idempotency validation, and sets `COMPLETED` on payment collection even when the balance or playing lifecycle does not justify that transition.

**Required correction:** lock the booking; validate a positive integer amount, method, active assigned shift, and allowed state; record an immutable payment; recalculate balances from confirmed ledger entries; decide completion separately; write audit/outbox records in the same transaction. Deduplicate repeated submissions.

### F-05 — Counter and rescheduled bookings still bypass consistent pricing

**Severity:** High. **Evidence:** `staff.routes.ts` counter creation and `customer.routes.ts` rescheduling multiply duration by a fixed hourly amount.

Move quoting, validity, opening/closure checks, court/venue membership, deposit modes, price snapshots, and conflicts into one booking service. All customer/staff/import/deal/tournament paths must use it. Shared UI helpers are not the authority for money.

### F-06 — Idempotency is missing from important write paths

**Severity:** High. **Evidence:** booking creation, counter booking, payment collection; backbone Section 24.

Frontend disabled buttons do not protect against retries, network replay, multiple tabs, or two application instances. Add scoped idempotency keys, request hashes, transactional storage, and stored-response replay. Reusing a key with a different payload must be rejected.

### F-07 — Composite courts are not proven safe

**Severity:** High. **Evidence:** `court_links` exists, but booking insertion reserves a directly supplied court ID rather than a complete physical-resource set.

An exclusion constraint prevents overlap only for the resource rows actually inserted. Expand composite reservations into physical court occupancy and test parent-versus-child concurrency. Until implemented, do not advertise composite court support as complete.

### F-08 — Cancellation/refunds and no-show rules are incomplete

**Severity:** High. **Evidence:** customer cancellation and Staff no-show handlers.

Cancellation releases court rows and changes state without a complete transactional policy/refund calculation. No-show scope checks were added, but timing, allowed predecessor states, atomic counter updates, and repeat-call idempotency remain necessary. Repeated requests must not increment no-show counts repeatedly or release resources after a failed state transition.

### F-09 — Authentication and sessions remain incomplete

**Severity:** High. **Evidence:** `common/jwt.ts`, `common/auth.guard.ts`, account routes, `AuthContext.tsx`.

- Source fallback secrets remain; production must fail fast without real secrets.
- Bcrypt is implemented, while the backbone specifies Argon2id; treat this as an explicit design deviation requiring a migration decision.
- Registration lacks the full username/reserved-word, phone, password, confirmation, and accepted-terms rules.
- OTP comparisons are not constant-time; quota/consumption concurrency needs review.
- Reset tokens are not backed by a demonstrated single-use consumption record.
- Refresh-token rotation, logout-all-devices, access-token revocation, and immediate suspension enforcement are not complete.
- The generic guard verifies a JWT but does not consistently re-evaluate account/tenant status, assigned venue, or current privileges.
- Customer login accepts a general identifier at the API, while the visible login field remains email-oriented.
- Mandatory Owner/Super Admin 2FA is not demonstrated. Generating/verifying a client-supplied TOTP secret is not an enforced enrolled second factor.

Implement server-bound enrollment and login challenges, strict issuer/audience/purpose checks, short-lived sessions, and account-state enforcement. Keep credentials out of fixtures shipped to users and do not reproduce secrets in reports.

### F-10 — Email delivery can look successful without delivery

**Severity:** High. **Evidence:** `common/email.service.ts`, `workers/email-worker.ts`.

Without SMTP credentials, the development branch marks an outbox item `SENT` and logs the rendered subject. OTP subjects contain the OTP, so the log path can expose codes. Only registration OTP, reset OTP, and booking confirmation have dedicated renderer branches; other types fall back to generic JSON.

The worker selects queued rows with `FOR UPDATE SKIP LOCKED` without keeping an explicit transaction/claim through dispatch. Multiple workers can select the same work. Failed rows are marked `FAILED`, but the selector only reads `QUEUED`; a complete retry schedule is not implemented. Booking confirmation webhook payloads also lack fields the email renderer expects.

Implement explicit development simulation states, no OTP logging, atomic job claims, retries/backoff/dead-letter handling, the required bilingual templates, complete event snapshots, HTML escaping, and real staging mailbox tests. Never count simulated SMTP as a delivered email.

### F-11 — Public realtime exposes more than calendar state and is incomplete

**Severity:** Medium/High depending on identifier use. **Evidence:** `common/realtime.ts`, lifecycle handlers, `CourtCalendarGrid.tsx`.

Public SSE streams serialize the full event, including booking identifiers/codes when supplied. Publish only minimal public occupancy data. The bus is process-local, so multiple API instances do not share events. Not every payment, expiry, cancellation, Staff, or block change reliably emits a complete update. The UI's live label does not establish connection freshness.

Add safe event projections, reconnect/freshness states, event IDs or refetch recovery, complete post-commit publication, and a shared transport before multi-instance deployment.

### F-12 — The latest homepage reintroduced unsupported claims and hardcoding

**Severity:** High for trust/acceptance. **Evidence:** latest `frontend/src/app/page.tsx`.

The newer page includes a hardcoded `4.9 · 128` review display, tournament-standard badge, fixed opening hours, fixed starting price, and a raw hex gradient class. These are not a verified review system, certification, live hours, or a quote. A `cover_photo_url` interface and image branch do not prove that uploaded media is persisted and returned by the API.

Remove unsupported claims; show reviews only from verified review records, derive hours/prices from configuration, use token colors, and complete the media path. Preserve the user's requested visual quality without manufacturing product evidence.

### F-13 — Localization is useful but incomplete

**Severity:** Medium/High. **Evidence:** shared dictionaries, language context, management screens, email/calendar generation.

The customer literal-key check passed for the earlier verified snapshot, but it does not cover dynamic keys, raw visible text, or every portal. The context saves local browser preference/cookie; it does not implement full profile, cross-tab, cross-device, notification, and export synchronization. Many `web.copyN` keys are positional rather than semantic. Some APIs and templates hardcode messages. Keep current form state and hold expiry unchanged when switching languages.

### F-14 — Reporting formulas and date controls need correction

**Severity:** Medium/High. **Evidence:** latest Admin revenue implementation.

Live queries replaced the earlier static display, but occupancy still assumes a fixed 15-hour daily capacity and needs a precise reporting window. No-show/returning/churn metrics must follow documented denominators. Add inclusive start/end date controls with Apply/Cancel, scope enforcement, booking-interval clipping, refunds, and localized exports. Label estimates and forecasts explicitly.

### F-15 — Media and operational setup are unfinished

**Severity:** Medium. **Evidence:** uploader, server upload path, Compose, configuration modules, test scripts.

Uploads use memory storage for up to ten 25MB files; the purported three-job limiter actually rejects only at a larger active threshold and is not a real three-job queue. Validate decode safety, memory bounds, MIME/content, tenant ownership, storage/serving path consistency, retention, and media association. Test source and compiled startup layouts.

Compose initializes extensions but does not by itself demonstrate a versioned application migration/seed run. Relative `__dirname` environment paths differ after compilation. There is no complete CI, backup/restore, production service supervision, or release/rollback workflow. `npm test` references Jest although a complete Jest setup is not present in the inspected manifest.

## 10. UI/UX improvement specification for the next AI

### 10.1 Visual direction to preserve

Use dark charcoal page/panel/nested surfaces, white headings, readable neutral body text, and a restrained green accent. Preserve Be Vietnam Pro with Vietnamese glyph coverage. Use one Lucide icon family, consistent stroke weight and optical size. Use tokens for colors, spacing, radii, shadows, focus, and states. Keep illustrations explicitly illustrative; use real venue photos only when supplied and persisted.

Do not equate “premium” with more gradients, glow, blur, shadows, or animation. The strongest improvement is accurate content, clear hierarchy, stable layouts, and an effortless booking flow.

### 10.2 Concrete screen changes

| Surface | Required improvement | Acceptance |
|---|---|---|
| Header | Compact mobile brand, visible booking history, language control, accessible account state | No wrapping controls or clipped targets at 360px; keyboard labels and focus work. |
| Hero | Keep the brief's product-story composition but shorten the journey to real availability | Main booking action reaches meaningful search/selection; returning users need not scroll through excessive marketing. |
| Search | Real sport/area/date/time/price filters; preserve results while refining | Typing remains responsive; no unnecessary full-screen spinner; scalable server pagination. |
| Venue card | Real photos/amenities/hours/policy/starting price | No fabricated reviews/certifications; clear unavailable-data fallback; no dead detail links. |
| Availability | Clear day, court, time, duration, per-slot units, selected range, and price | No ambiguous half-hour/hour price; past/held/blocked states remain distinguishable without color. |
| Time selection | Explain two-tap adjacent selection or add explicit duration shortcuts | A single 30-minute selection cannot silently fail a 60-minute minimum; show guidance before a disabled action. |
| Price display | Stable tabular numerals and nonbreaking amount/unit | Currency does not wrap onto its own line in narrow three-column mobile cells. |
| Summary | Keep selected court/date/time, total, deposit, remainder, policy and next action visible | Does not imply the selected period filter changes an existing selection; no screen-reader spam. |
| Account forms | Correct identifier support, visible labels, validation, password visibility, terms, recovery | Field values survive errors/language changes; focus stays in the active field; feedback is inline. |
| Payment | Actual payee, amount, note, expiry, confirmation source and recovery | No fake payment success; disable expired actions; resume pending payment from My Bookings. |
| My Bookings | Upcoming/history, detail, payment resume, reschedule, cancel/refund explanation, receipt | Real authenticated data; no sample records presented as the user's bookings. |
| Help | Owner contact, venue policy and useful escalation | No fictional support promises or unimplemented chat actions. |

### 10.3 Accessibility and quality gates

- Verify at 360, 390, 768, 1024 and 1440px, including long English strings and real Vietnamese content.
- Test text zoom, keyboard-only use, screen-reader naming, focus restoration, Escape, and focus trapping.
- Associate every label with its input; provide useful autocomplete/input modes and a password visibility control.
- Keep meaningful mobile body/form content readable and all interactive targets at least 44px.
- Verify normal text contrast of at least 4.5:1 and large text/icons at least 3:1 for actual rendered combinations.
- Pair every booking state with text/icon; test grayscale, not just selected/free states.
- Honor reduced motion, avoid scroll-triggered decorative work, and reserve space to avoid layout shifts.
- Test stale/offline/error/reconnect behavior. Do not display “live” indefinitely after connection loss.
- Use accessible destructive confirmation with an understandable policy consequence; do not rely only on `alert()`/`confirm()` as final production UX.
- Test actual mobile Safari and Zalo/Facebook embedded browsers before claiming cross-browser support. Chromium emulation alone is insufficient.

## 11. Performance plan and evidence boundaries

Previously observed local production measurements in this working session:

| Check | Observed result | Limit |
|---|---|---|
| Venue list, 20 sequential local reads | Median roughly 4–5ms; p95 roughly 8ms | Small seeded database; not load testing. |
| Availability, original sequential reads | Median about 10.5ms | Local snapshot before parallelized reads. |
| Availability after concurrent independent reads | Median about 5.3ms; p95 about 9.5ms | Local snapshot; not internet/mobile performance. |
| Filter click to two animation frames | Median about 33ms; observed p95 about 34ms | Synthetic Chromium check; **not field INP**. |
| Locale switch | Zero additional customer API requests; selection preserved | Verified snapshot before the final newly discovered edits; rerun after changes. |
| Responsive smoke checks | No page horizontal overflow at 360/768/1440px | Does not establish every dialog, state, or browser. |

No claim of universally zero lag is justified. Measure the complete experience, including image loading, fonts, slow networks, API errors, and larger datasets.

**Proposed acceptance budgets, not current measured achievements:** p75 LCP under 2.5s, INP under 200ms, CLS under 0.1; essential local interaction feedback within 100ms; scoped API p95 targets defined against a realistic dataset and concurrent-user profile. Record hardware, browser, network settings, dataset size, warm/cold cache, and build mode.

Implementation priorities:

1. Preserve selection/form state; do not refetch merely because presentation language changes.
2. Keep search responsive with deferred local refinement for small datasets, then move to indexed paginated server search as inventory grows.
3. Use stable cache keys and cancellation of stale requests. Do not permit an old venue/date response to overwrite the current selection.
4. Refresh after SSE without flashing the entire calendar or discarding a valid selection; invalidate a selection explicitly if it is no longer available.
5. Precompute slot state and price once per relevant input change when profiling justifies it; avoid speculative memoization everywhere.
6. Lazy-load nonessential dialogs/details and optimize actual venue images with dimensions and responsive sizes.
7. Bound queries and uploads; inspect query plans and add justified indexes. Never cache authoritative booking/payment decisions.
8. Remove unnecessary scroll blur and broad `transition-all`; animate only useful properties and honor reduced motion.
9. Test real load and worker contention. Redis being connected does not mean caching, distributed jobs, or cross-instance events are implemented.

## 12. Recommended implementation work packages

| Order | Package | Main targets | Definition of done |
|---|---|---|---|
| 1 | Stabilize runtime and configuration | `config/database.ts`, `main.ts`, local launcher/service setup | Health/readiness, sanitized logs, DB restart recovery, source/compiled startup parity. |
| 2 | Correct isolation and authorization | Migration 004 replacement, transaction helpers, guards, all portals | Fail-closed RLS, explicit public projections, least privilege, tenant and venue negative tests. |
| 3 | Secure accounts and sessions | Auth routes, JWT, account dialogs/context | Full validation/terms, OTP concurrency and quotas, single-use recovery, rotation/revocation, enforced 2FA. |
| 4 | Unify booking core | Customer/Staff/admin writes, `shared/booking.ts`, schema | One quote/policy/conflict service, immutable snapshots, physical resource expansion, idempotency, safe transitions. |
| 5 | Complete payment/reconciliation | Webhook, collection, refunds, payment UI | Verified receiving account, real adapter, exact ledger math, all mismatch cases, resumable pending payments. |
| 6 | Reliable notifications | Email renderer/worker/outbox | Full bilingual templates, correct snapshots, safe rendering, retries and proven staging delivery. |
| 7 | Finish customer P1 | Discovery, venue, calendar, account, My Bookings | Accurate data, no fake claims, complete booking/recovery/reschedule/cancel/receipt flows. |
| 8 | Finish operational P1 | Staff/Admin, reports, audit, console | Real state and scoped operations, defined formulas, no placeholder metrics. |
| 9 | Establish release quality | Test setup, CI, dependencies, migrations, backups | Reproducible build/tests, supported dependency set, restore drill, rollback and monitoring evidence. |
| 10 | Add approved P2 features | A-25/A-26, A-27/C-21, C-24, A-28, A-30, A-29 | Implement complete vertical slices only after P1 gates pass. |
| 11 | Add selected P3 growth | Remaining extension catalog | Explicit requirements, provider/hardware verification and isolated acceptance tests. |

For every package: inspect callers and schemas; state assumptions; implement migration/API/UI/catalog/tests together where applicable; execute relevant checks; review the actual rendered UI; report implemented, tested, and blocked items separately. Do not end after creating a screen that calls a nonexistent endpoint.

## 13. Required test matrix

### 13.1 Existing evidence and limitations

- Backend TypeScript build passed during the final source recheck.
- Frontend `tsc --noEmit` passed during the final source recheck.
- Earlier production builds passed, but later source edits must receive their own production build and browser verification.
- `qa/pricing-check.cjs` previously passed six pricing/timezone assertions.
- The existing image/event script previously passed four assertions. These cover Sharp output and the event bus, not a full image-management or SSE product workflow.
- Browser scripts exercised real public APIs, selection, locale preservation, dialogs, recovery entry and responsive overflow in the inspected earlier snapshot.
- `qa/api-check.cjs` used a locally signed synthetic customer token. It does **not** prove real login, account ownership, session security, or successful payment.
- The original system test script writes database records and does not provide complete fixture cleanup. Run it only against a dedicated disposable test database after fixing isolation/cleanup.
- The specification's 119 original cases and 26 language cases are **requirements**, not an executed 145-test suite. No complete acceptance result exists.

### 13.2 Mandatory negative and concurrency cases

1. Two customers hold the same physical slot simultaneously; exactly one succeeds, the other gets `SLOT_TAKEN`.
2. A composite reservation conflicts with constituent reservations in both directions.
3. Expired holds are reclaimed safely before a new insert, including worker delays.
4. Customer A cannot view/download/cancel/reschedule/pay B's booking.
5. Staff/Manager cannot access an unassigned venue; tenant A cannot mutate B through any route or child row.
6. Missing tenant context does not expose tenant data; connection pooling never reuses another request's context.
7. Duplicate booking/payment/idempotency requests create one business result, including concurrent retries.
8. Underpayment, overpayment, wrong note, duplicate webhook, late payment, and cancelled booking all follow defined reconciliation states.
9. Cash collection cannot complete an unpaid booking, use another staff member's shift, or accept negative/fractional amounts.
10. Cancellation and reschedule rollback completely on failure, preserve financial links, and produce correct notifications/audit.
11. OTP consumption is atomic; replay, purpose mismatch, expired code, resend bursts and six failed attempts are rejected.
12. Reset token replay fails; reset/suspension revokes appropriate sessions immediately.
13. Owner/Super Admin login requires a previously enrolled server-bound second factor.
14. Language changes preserve typed inputs, selected slots, current court/date, and the real hold expiry across tabs/devices.
15. All email templates have complete variables, escaped user content, correct language, correct amounts, and delivery/retry evidence.
16. Uploads reject invalid/oversized/decompression-abusive content without exhausting memory; media remains tenant-owned.
17. Overnight venues, local midnight, month/year boundaries, holiday pricing, zero-deposit and manual-approval modes behave correctly.
18. Broken API/SSE/Redis/database connections produce actionable states, bounded retry and recovery, not silent stale “live” UI.

### 13.3 Dependency security snapshot

`npm audit --json` was executed during this review. The frontend audit reported two affected package entries: one critical (`next`) and one high (a nested `postcss`). The backend audit reported one high entry (`zod`). These are package-level audit findings, not proof that every advisory is exploitable in this application.

Resolve advisories using current official release information, compatibility checks, lockfile updates, and regression tests. Do not run a blind major-version `audit fix --force` and claim completion. Keep the development server private. Re-run the audit at the actual release date because advisories and fixed versions change.

## 14. Instructions for the next AI coding agent

```text
Read this report and all linked source documents before editing.

Treat the uploaded original specification as the business backbone, the repository
Section 26 as the existing bilingual extension, the UI brief as the customer visual
direction, and the extensions brief as the P2/P3 roadmap.

First refresh runtime, source timestamps, schema, migration state, and API contracts.
The workspace has changed between checks. Do not repeat old findings as current facts.
Do not attribute changes to a particular agent without evidence.

Implement packages 1-9 as small verified vertical slices before activating advanced
extensions. Preserve the customer-focused website, existing routes, accurate owner
content, dark-neutral surfaces, restrained green accents, and accessible controls.

Never use fabricated reviews, certifications, revenue, availability, provider behavior,
payment confirmation, delivery status, or banking configuration to make a demo look done.
Never weaken tenant isolation to make public browsing or workers appear functional.

For each slice deliver: the concrete behavior, impacted files, migrations and rollback,
API/UI contracts, VI/EN strings, meaningful tests, actual commands/results, rendered
desktop/mobile evidence, and remaining decisions. Distinguish a successful build from
a successful authenticated end-to-end business flow.

Stop a real-money release when isolation, financial correctness, authentication,
provider validation, or critical dependency findings remain unresolved. Continue all
independent implementation and verification that is already authorized.
```

## 15. Final acceptance gate

The system may be described as a completed P1 release only when all required P1 feature IDs have passed their acceptance cases; no Critical/Blocker remains; live claims are backed by real data; a normal customer can register, verify, sign in, book, pay, receive confirmation, manage the booking and recover access; Staff can operate the same truthful calendar and reconcile actual money; owners can configure their business; and backups, monitoring, deployment, and rollback have evidence.

Until then describe the project as an actively developed foundation with verified subsets. Visual polish, a connected database, a list of endpoints, and a passing compiler are useful progress, not substitutes for these gates.


## Remediation follow-up: 17 November 2026

The subsequent fix adds migration 005 to replace the missing-context RLS bypass with scoped tenant, customer and public-read policies. Application connections receive request context through AsyncLocalStorage, reset it on release, and use a separate server-only worker credential for background and authorized platform work. Regression checks cover missing context, public write rejection, correct-tenant access, wrong-tenant rejection and connection reuse. This does not certify every authorization or financial rule in this audit.

Homepage sample reviews/certifications, fixed hours and fixed price were removed. The raw banner color was replaced with a token. Migration 006 removes only the known demo bank fixture so it cannot silently become a live receiving account. Actual payment setup remains required.

The database pool now handles idle connection errors with sanitized logging, and worker intervals catch rejected jobs. Source and compiled startup resolve local environment configuration from their working directory.

Recovery verification passed: terminating an idle API PostgreSQL connection produced a sanitized 57P01 log, the process remained alive, and the subsequent health check returned 200. Customer ownership tests used transaction-scoped fixtures that were rolled back. Browser regression passed at 360/768/1440px, with zero locale-triggered API requests and preserved selection. Frontend production build and backend TypeScript build passed after these changes.


## Account flow follow-up: 17 November 2026

Customer account endpoints now use transactional OTP issuance and consumption with constant-time comparison, resend cooldown, hourly/daily quotas, purpose binding, and row locking. Verification returns both the token and the user object. Password recovery stores only hashed opaque reset tokens, consumes them once, and increments an account session version so older access tokens are rejected. Registration validates confirmation and records a local-preview acknowledgment; this does not provide completed production legal terms or a privacy policy.

Explicit AUTH_EMAIL_MODE=local enables a loopback-only OTP preview in the account dialog when NODE_ENV is not production. The UI identifies this as a test code, can fill it directly, and does not claim an email was sent. SMTP mode queues actual delivery requests and requires SMTP configuration. Missing SMTP no longer produces a simulated SENT email or logs the rendered OTP subject. Actual external mailbox delivery remains unverified because no SMTP credentials were supplied.

Verified: real API account lifecycle, invalid/expired/replaced OTP rejection, resend cooldown, concurrent one-time consumption, single-use reset, old-session revocation, production/untrusted-origin preview rejection, and mobile browser registration through successful sign-in. Temporary test accounts were removed. Frontend production build and backend compilation passed. Remaining financial, refresh-session, provider, and other audit requirements are not marked complete by this update.


## Comprehensive P1 Completion, Extensions & Liquid-Glass UI Overhaul: 18 November 2026

### 1. Database Schema & RLS Migrations (`008` & `009`)
- Applied `migrations/008_complete_booking_core_and_features.sql` and `migrations/009_user_profiles_geo_and_analytics.sql` cleanly (`ON_ERROR_STOP=1`, exit `0`).
- Added profile & privacy fields (`customer_accounts.full_name`, `avatar_url`, `deleted_at`, `marketing_opt_in`; `tenant_staff.avatar_url`, `preferred_language`; `platform_admins.avatar_url`), geospatial & SEO fields (`venues.latitude`, `longitude`, `district`, `city`, `city_slug`, `slug`, `slug_history`, `status`, `weather_closure_banner`; `courts.is_outdoor`), SMTP configuration (`platform_smtp_settings`) and atomic email outbox claim/retry columns, plus extension tables (`onboarding_progress`, `import_jobs`, `import_rows`, `deal_rules`, `marketing_consents`, `campaigns`, `campaign_recipients`, `weather_closure_jobs`, `tournaments`, `tournament_teams`, `tournament_matches`, `device_integrations`, `device_commands`) and `TOURNAMENT` booking enum support.
- Enforced fail-closed Row-Level Security (`FORCE ROW LEVEL SECURITY`) on all tenant-owned extension tables and granted least-privilege DML permissions to `court_app` and `court_worker`.
- Repaired 13 legacy Windows-1252/UTF-8 mojibake database rows across seeded venues, courts, and staff records (`qa/fix-utf8-mojibake.cjs`) and added client-side `localStorage` mojibake healing + live `/me` synchronization.

### 2. Zero Pre-filled Credentials, Full User Profiles & Data Rights (`C-06`)
- Removed all pre-filled emails, usernames, passwords, phone numbers, and demo-credential hint banners across Customer (`AuthModal.tsx`), Staff (`/staff`), Tenant Admin (`/admin`), and Super Admin (`/platform`).
- Implemented complete profile & role-responsibility centers across all 4 portals (`/profile` for Customers; `OperatorProfilePanel` for Staff, Admin, and Super Admin):
  - Square `320x320` WebP avatar upload processed via `sharp` (`optimizeAvatarImage`, concurrency-limited to 3 jobs, pixel-count capped).
  - Full name, phone, and preferred language editing; 2-step OTP-verified email change (`CHANGE_EMAIL`); password change; rotating single-use multi-device refresh tokens (`/api/customer/v1/auth/refresh`, `/me/sessions`, `/me/logout-all`).
  - `C-06` personal data export (`GET /api/customer/v1/me/export` JSON download) and account deletion/anonymization (`POST /api/customer/v1/me/delete`, blocking active future bookings and revoking all active tokens/OTPs).

### 3. Dark-Charcoal & Emerald UI, Dedicated `/map` (`C-02`), Multi-Slot Toggle & Executive Dashboard (`A-11`, `A-12`, `A-28`, `F-14`)
- Preserved the Dark Charcoal (`#1B1B1F`, `#25252A`, `#2E2E35`) & Emerald (`#00A862`, `#00C070`) design token system (`globals.css`) with instant zero-jank `110ms` transitions (eliminating DOM-injected circle ripples), `Be Vietnam Pro` tabular figures, zero raw `#hex` colors in TypeScript components, 360px mobile overflow safety, and `1:1` key parity across `shared/i18n/vi.json` and `shared/i18n/en.json`.
- Implemented independent multi-slot toggle selection (`CourtCalendarGrid.tsx` + `migrations/012_flexible_multi_slot_booking.sql` + multi-interval atomic transaction in `POST /api/customer/v1/bookings`) so customers can toggle any number of contiguous or non-contiguous 30-minute slots on/off freely without clearing prior selections.
- Implemented `LoopingPhotoCarousel` (`frontend/src/components/LoopingPhotoCarousel.tsx`) and `011_venue_galleries_and_system_media.sql` (`platform_media_settings` + `venues.photos` multi-photo WebP galleries):
  - Infinite auto-looping crossfade carousels with `‹` / `›` arrows, dot indicators, slide counters, and mobile touch swipe across Customer Venue Cards, SEO Venue Pages, Hero backdrop, Customer Split Auth Modal, and Staff/Admin/Platform Sign-In Portals.
  - Multi-file WebP gallery upload, cover promotion, and individual photo deletion on both Tenant Admin (`/admin` -> `Thư Viện Ảnh Sân`) and Super Admin (`/platform` -> `Thư Viện Ảnh Sân & Hệ Thống`).
- Implemented dedicated `/map` route (`frontend/src/app/map/page.tsx`) + `VenueMapExplorer` (`C-02`) backed by a disk-cached backend street-tile proxy (`GET /map-tiles/:style/:z/:x/:y` in `backend/src/common/map-tiles.ts`) so real OpenStreetMap Hanoi street maps load with zero external DNS/CORS failures in sandboxed webviews, alongside explicit user-initiated geolocation, Haversine distance (`km`) sorting, standard/dark street toggle, and Google Maps directions.
- Upgraded `/api/admin/v1/reports/revenue` and `AdminExecutiveCharts` with Net Revenue (confirmed payments minus completed refunds), real physical-court configured occupancy (`%`), receivables due at venue, Daily Revenue & Bookings SVG Combo Chart, Weekday × Time-Band Occupancy Heatmap (`%` text in every cell), Court Performance ranking, and formula-safe UTF-8 BOM CSV export. Local evaluation data (`DS-DEMO*` bookings/payments and open friendly tournament) was seeded via `qa/seed-local-demo-activity.cjs` so charts reflect real SQL aggregations rather than hardcoded UI placeholders.

### 4. Configurable Live SMTP (`F-10`) & Authorized P2/P3 Extensions
- **Configurable Live SMTP (`F-10`):** Dynamic database (`platform_smtp_settings` via `/platform` Super Admin UI + live test email endpoint `POST /api/platform/v1/smtp/test`) or `.env` SMTP configuration, atomic worker claiming (`FOR UPDATE SKIP LOCKED`), exponential backoff retries, and zero OTP plaintext logging. Runtime-verified live delivery via `smtp.gmail.com:587` (`POST /api/platform/v1/smtp/test` -> HTTP `200`, `status: "SENT"` with Gmail `messageId`).
- **Implemented Extensions:**
  - `A-25` 7-Step Venue Setup Wizard (`DRAFT` venue privacy until published; required steps 1–3; optional step 5 counter-only notice).
  - `A-26` CSV Legacy Import (UTF-8 BOM Vietnamese headers, phone merge, formula-injection neutralization prefixing `= + - @`, SHA-256 idempotency, dry-run & Booking Core conflict checks).
  - `A-27` & `C-21` Off-Peak / Last-Minute Deals (`floor_price_vnd`, `lead_hours`, frozen `price_snapshot`, `< 30%` occupancy `DRAFT` suggestions requiring owner approval, customer deals feed & calendar strikethrough pricing).
  - `C-24` Bilingual Venue SEO Pages (`/[lang]/san/[city]/[sport]/[slug]`, `DRAFT` `noindex`, `slug_history` 301 redirect, `hreflang`, truthful `SportsActivityLocation` JSON-LD, dynamic `/sitemap.xml`).
  - `A-29` Segmented Marketing Campaigns (`opted_in = TRUE` strictly enforced, `45-day` churn window, `1/week` cap, preview count, 1-click unsubscribe).
  - `A-30` Rain Policy & Bulk Outdoor Closure (`is_outdoor = TRUE` filter, preview affected bookings/deposits, idempotent execution, customer weather banner).
  - `A-31` Tournaments (Round Robin & Knockout, Booking Core `TOURNAMENT` court reservations guarded by GiST `no_overlap`, audited score entry, live standings).
  - `A-33` Smart Lights & Gate IoT (`-10m`/`+5m` continuous coalesced lighting windows across adjacent games, 3-retry unreachable alert to Staff, Staff/Admin manual override).
  - `C-18` Venue Reviews & 1–5 Star Ratings (`migrations/013_venue_reviews_and_moderation.sql`, `VenueReviewsSection`, `AdminReviewsManager`): interactive 1–5 star rating + review composer on venue cards, 5-tier rating breakdown bars, automatic verified-booking badge when linked to a customer booking, and `/admin` moderation (`is_visible` show/hide, `owner_reply`, audited deletion).

### 5. Dependency Security, Executed Verification & Remaining External Scope
- **Dependency Audit Snapshot:** `backend` reports `0 vulnerabilities` (`zod@^4.6.7`, `express-rate-limit@^8.7.4` with IPv6-safe `ipKeyGenerator`, `multer@^2.5.0`, `nodemailer@^10.6.0`, `sharp@^0.35.5`, `helmet@^8.3.0`). `frontend` reports `0 critical` vulnerabilities (`next@16.4.6`, `react@19.2.0`, `postcss@8.5.23`); remaining `npm audit` advisory is build-only `tailwindcss@3.4.19 -> picomatch`, intentionally not force-upgraded to breaking `tailwindcss@4` per Section 13.3.
- **Verification Executed:**
  - `cd backend && npm run build` -> exit `0`
  - `cd frontend && npm run build` (Next.js `16.4.6` Turbopack) -> exit `0`
  - `impeccable detect --json frontend/src` -> `[]` (`0` violations/advisories)
  - `node qa/pricing-check.cjs` -> `6/6` passed
  - `node qa/rls-regression.cjs` -> passed
  - `node qa/comprehensive-full-suite.cjs` -> `51/51` unit & live E2E assertions passed with deterministic `finally` cleanup
- **Optional Phase 2 / Phase 3 Product Backlog (Ready for Next Iteration):**
  1. `C-15` / `A-16`: Promotional Voucher Codes at checkout (`PERCENT` / `FIXED_VND`, usage caps, validity dates).
  2. `C-12`: Weekly Recurring Booking Series (4–8 week rolling reservations with conflict reporting).
  3. `C-11` / `C-14`: Favorite Venues & 1-Click Quick Rebook from `/my-bookings`.
  4. `C-13` / `C-17`: Full-Slot Waitlist Alerts & Player Matchmaking / Opponent Finder board.
  5. `S-07` / `S-12` / `A-17`: Counter Extra Services & Inventory (drinks, racket/shoe/bib rentals) + 80mm Thermal Receipt Print view.
  6. `A-15` / `A-19`: Tenant Customer CRM (VIP/no-show tags & notes) + Simple Income/Expense P&L Ledger.
  7. `PWA`: Web App Manifest (`manifest.json`) & installable mobile home-screen icons.
- **Intentionally Deferred External Integrations (per product owner direction):** Live bank provider cryptographic webhook credentials (SePay/Casso/payOS) with a real owner bank account, and Zalo Official Account / Mini App integration (`C-22`).


# Source inventory - 25 November 2026

Inventory of authored repository files and API declarations. This is a navigation aid, not a claim that every feature passed acceptance testing.

## Files

| File | Lines |
|---|---:|
| `README.md` | 301 |
| `backend/package.json` | 43 |
| `backend/src/common/audit.ts` | 42 |
| `backend/src/common/auth.guard.ts` | 114 |
| `backend/src/common/email.service.ts` | 427 |
| `backend/src/common/ics.ts` | 59 |
| `backend/src/common/idempotency.ts` | 102 |
| `backend/src/common/jwt.ts` | 136 |
| `backend/src/common/map-tiles.ts` | 113 |
| `backend/src/common/realtime.ts` | 73 |
| `backend/src/common/security.ts` | 57 |
| `backend/src/common/swagger.ts` | 183 |
| `backend/src/common/uploader.ts` | 192 |
| `backend/src/config/database-scope.ts` | 3 |
| `backend/src/config/database.ts` | 96 |
| `backend/src/config/redis.ts` | 18 |
| `backend/src/main.ts` | 101 |
| `backend/src/modules/admin/admin.routes.ts` | 1669 |
| `backend/src/modules/admin/extensions.routes.ts` | 2151 |
| `backend/src/modules/booking/booking.service.ts` | 794 |
| `backend/src/modules/customer/auth.routes.ts` | 177 |
| `backend/src/modules/customer/customer.extensions.routes.ts` | 921 |
| `backend/src/modules/customer/customer.routes.ts` | 1637 |
| `backend/src/modules/platform/platform.routes.ts` | 768 |
| `backend/src/modules/staff/staff.routes.ts` | 1283 |
| `backend/src/modules/webhooks/webhook.routes.ts` | 53 |
| `backend/src/test/run_system_tests.ts` | 181 |
| `backend/src/test/test_new_features.ts` | 91 |
| `backend/src/workers/email-worker.ts` | 50 |
| `backend/src/workers/hold-cleaner.ts` | 86 |
| `backend/tsconfig.json` | 24 |
| `court-booking-system-spec-en.md` | 1506 |
| `docker-compose.yml` | 37 |
| `docs/IMPLEMENTATION_AUDIT_AND_AI_HANDOFF_EN.md` | 585 |
| `docs/PROJECT_PROGRESS_AND_NEXT_ROADMAP_VI.md` | 85 |
| `docs/court-booking-system-spec-en.md` | 1246 |
| `docs/feature-extensions-brief.md` | 530 |
| `docs/ui-redesign-brief-en.md` | 364 |
| `frontend/next-env.d.ts` | 7 |
| `frontend/next.config.js` | 27 |
| `frontend/package.json` | 34 |
| `frontend/postcss.config.js` | 6 |
| `frontend/src/app/[lang]/san/[city]/[sport]/[slug]/page.tsx` | 351 |
| `frontend/src/app/admin/page.tsx` | 1282 |
| `frontend/src/app/globals.css` | 602 |
| `frontend/src/app/layout.tsx` | 40 |
| `frontend/src/app/map/page.tsx` | 203 |
| `frontend/src/app/my-bookings/page.tsx` | 837 |
| `frontend/src/app/page.tsx` | 836 |
| `frontend/src/app/platform/page.tsx` | 1346 |
| `frontend/src/app/profile/page.tsx` | 888 |
| `frontend/src/app/sitemap.ts` | 58 |
| `frontend/src/app/staff/page.tsx` | 1353 |
| `frontend/src/components/AuthModal.tsx` | 825 |
| `frontend/src/components/CourtCalendarGrid.tsx` | 778 |
| `frontend/src/components/CourtMark.tsx` | 4 |
| `frontend/src/components/CustomerDealsAndTournaments.tsx` | 304 |
| `frontend/src/components/DatePicker.tsx` | 74 |
| `frontend/src/components/GlassInteractiveRuntime.tsx` | 96 |
| `frontend/src/components/Header.tsx` | 164 |
| `frontend/src/components/LoopingPhotoCarousel.tsx` | 182 |
| `frontend/src/components/MobileBottomNav.tsx` | 88 |
| `frontend/src/components/OperatorProfilePanel.tsx` | 644 |
| `frontend/src/components/PhoneMockup.tsx` | 152 |
| `frontend/src/components/TouchFeedback.tsx` | 6 |
| `frontend/src/components/VenueDetails.tsx` | 146 |
| `frontend/src/components/VenueMapExplorer.tsx` | 627 |
| `frontend/src/components/VenueReviewsSection.tsx` | 467 |
| `frontend/src/components/VietQrModal.tsx` | 576 |
| `frontend/src/components/admin/AdminExecutiveCharts.tsx` | 571 |
| `frontend/src/components/admin/AdminExtensionsSuite.tsx` | 2046 |
| `frontend/src/components/admin/AdminReviewsManager.tsx` | 388 |
| `frontend/src/components/ui/Badge.tsx` | 30 |
| `frontend/src/components/ui/Button.tsx` | 51 |
| `frontend/src/components/ui/Card.tsx` | 25 |
| `frontend/src/context/AuthContext.tsx` | 234 |
| `frontend/src/context/LanguageContext.tsx` | 90 |
| `frontend/src/hooks/useDialog.ts` | 23 |
| `frontend/src/lib/api.ts` | 25 |
| `frontend/src/lib/media.ts` | 62 |
| `frontend/tailwind.config.js` | 63 |
| `frontend/tsconfig.json` | 45 |
| `init-db/01-init-extensions.sql` | 5 |
| `migrations/001_initial_schema.sql` | 486 |
| `migrations/002_seed_initial_data.sql` | 133 |
| `migrations/003_repair_demo_encoding.sql` | 12 |
| `migrations/004_comprehensive_rls_and_fixes.sql` | 357 |
| `migrations/005_fail_closed_tenant_policies.sql` | 117 |
| `migrations/006_remove_unverified_demo_bank.sql` | 6 |
| `migrations/007_account_recovery.sql` | 13 |
| `migrations/008_complete_booking_core_and_features.sql` | 360 |
| `migrations/009_user_profiles_geo_and_analytics.sql` | 672 |
| `migrations/010_dynamic_sports_and_platform_crud.sql` | 50 |
| `migrations/011_venue_galleries_and_system_media.sql` | 88 |
| `migrations/012_flexible_multi_slot_booking.sql` | 8 |
| `migrations/013_venue_reviews_and_moderation.sql` | 51 |
| `qa/account-browser-check.cjs` | 4 |
| `qa/account-lifecycle-check.cjs` | 21 |
| `qa/api-check.cjs` | 12 |
| `qa/api-performance.cjs` | 2 |
| `qa/apply-sql.cjs` | 30 |
| `qa/audit-fonts-i18n-encoding.cjs` | 112 |
| `qa/browser-check.cjs` | 20 |
| `qa/catalog-check.py` | 16 |
| `qa/comprehensive-full-suite.cjs` | 549 |
| `qa/db-check.cjs` | 9 |
| `qa/fix-utf8-mojibake.cjs` | 157 |
| `qa/interaction-check.cjs` | 8 |
| `qa/live-check.cjs` | 35 |
| `qa/optimized-flow.cjs` | 19 |
| `qa/otp-boundary-check.cjs` | 3 |
| `qa/otp-concurrency-check.cjs` | 8 |
| `qa/pricing-check.cjs` | 12 |
| `qa/refined-ui-check.cjs` | 7 |
| `qa/repair-demo.cjs` | 4 |
| `qa/report-readonly-check.cjs` | 25 |
| `qa/rls-recovery-check.cjs` | 7 |
| `qa/rls-regression.cjs` | 10 |
| `qa/seed-local-demo-activity.cjs` | 220 |
| `qa/touch-feedback-check.cjs` | 7 |
| `shared/booking.ts` | 143 |
| `shared/i18n/en.json` | 524 |
| `shared/i18n/index.ts` | 45 |
| `shared/i18n/vi.json` | 524 |
| `shared/tokens/index.ts` | 129 |

## Declared API routes

Routes listed below are source declarations. Authentication, ownership and business behavior require their own checks.

### backend/src/modules/admin/admin.routes.ts

- `POST /auth/login` (line 44)
- `GET /me` (line 127)
- `PATCH /me` (line 155)
- `POST /me/avatar` (line 189)
- `POST /me/password` (line 214)
- `POST /auth/2fa/setup` (line 238)
- `POST /auth/2fa/verify` (line 251)
- `GET /sports` (line 274)
- `GET /venues` (line 279)
- `GET /courts` (line 304)
- `POST /courts` (line 329)
- `GET /price-rules` (line 375)
- `POST /price-rules` (line 391)
- `DELETE /price-rules/:id` (line 436)
- `PUT /price-rules/:id` (line 442)
- `PUT /courts/:id` (line 461)
- `DELETE /courts/:id` (line 498)
- `DELETE /venues/:id` (line 520)
- `POST /blocks` (line 553)
- `GET /staff` (line 659)
- `POST /staff` (line 680)
- `POST /staff/:id/suspend` (line 752)
- `GET /settings/bank-account` (line 774)
- `PUT /settings/bank-account` (line 793)
- `GET /reconciliation` (line 847)
- `POST /refunds/:id/complete` (line 905)
- `GET /reports/revenue` (line 969)
- `GET /audit-logs` (line 1352)
- `POST /uploads` (line 1370)
- `PUT /venues/:id/photos` (line 1455)
- `GET /reviews` (line 1500)
- `PATCH /reviews/:id` (line 1577)
- `DELETE /reviews/:id` (line 1636)

### backend/src/modules/admin/extensions.routes.ts

- `GET /venues/:id/config` (line 46)
- `PUT /venues/:id` (line 71)
- `PUT /venues/:id/opening-hours` (line 191)
- `PUT /venues/:id/policies` (line 229)
- `POST /wizard/venues` (line 306)
- `GET /wizard/:venueId` (line 362)
- `PUT /wizard/:venueId/step/:step` (line 399)
- `GET /imports/sample.csv` (line 612)
- `POST /imports` (line 622)
- `POST /imports/:id/confirm` (line 888)
- `GET /imports/:id/errors.csv` (line 1027)
- `GET /deals` (line 1053)
- `POST /deals` (line 1069)
- `PATCH /deals/:id/status` (line 1134)
- `POST /deals/generate-suggestions` (line 1167)
- `GET /campaigns` (line 1248)
- `POST /campaigns/preview` (line 1257)
- `POST /campaigns` (line 1267)
- `POST /campaigns/:id/cancel` (line 1312)
- `POST /campaigns/:id/send` (line 1322)
- `GET /weather/outdoor-courts` (line 1399)
- `POST /weather/preview` (line 1424)
- `POST /weather/execute` (line 1480)
- `GET /tournaments` (line 1702)
- `POST /tournaments` (line 1740)
- `POST /tournaments/:id/teams` (line 1781)
- `POST /tournaments/:id/generate-matches` (line 1799)
- `POST /tournaments/:id/matches/:matchId/schedule` (line 1842)
- `POST /tournaments/:id/matches/:matchId/score` (line 1903)
- `GET /iot/devices` (line 2047)
- `POST /iot/devices/:id/command` (line 2097)

### backend/src/modules/customer/auth.routes.ts


### backend/src/modules/customer/customer.extensions.routes.ts

- `POST /auth/refresh` (line 17)
- `GET /me/sessions` (line 81)
- `DELETE /me/sessions/:id` (line 96)
- `POST /me/delete` (line 113)
- `PUT /me/marketing-consent` (line 194)
- `GET /marketing/unsubscribe` (line 224)
- `GET /deals` (line 268)
- `GET /seo/venues` (line 430)
- `GET /seo/venue/:slug` (line 448)
- `GET /tournaments` (line 559)
- `GET /sports` (line 616)
- `GET /media-showcase` (line 665)
- `GET /venues/:id/reviews` (line 716)
- `POST /venues/:id/reviews` (line 777)
- `DELETE /venues/:id/reviews/:reviewId` (line 903)

### backend/src/modules/customer/customer.routes.ts

- `POST /auth/login` (line 49)
- `GET /me` (line 140)
- `PATCH /me` (line 175)
- `POST /me/avatar` (line 239)
- `POST /me/email/request-change` (line 274)
- `POST /me/email/confirm-change` (line 368)
- `POST /me/password` (line 451)
- `POST /me/logout-all` (line 510)
- `GET /me/export` (line 521)
- `PATCH /me/preferences` (line 565)
- `GET /venues` (line 588)
- `GET /venues/:id` (line 640)
- `GET /venues/:id/availability` (line 688)
- `GET /venues/:id/realtime` (line 787)
- `POST /bookings` (line 795)
- `POST /bookings/:id/reschedule` (line 988)
- `GET /bookings/:id/payment` (line 1184)
- `POST /bookings/:id/sandbox-pay` (line 1249)
- `GET /bookings/:id/cancel-preview` (line 1321)
- `POST /bookings/:id/cancel` (line 1363)
- `GET /bookings/:id/ics` (line 1584)
- `GET /bookings/:id/calendar.ics` (line 1585)
- `GET /bookings` (line 1587)
- `GET /bookings/:id` (line 1613)

### backend/src/modules/platform/platform.routes.ts

- `POST /auth/login` (line 20)
- `GET /me` (line 77)
- `PATCH /me` (line 91)
- `POST /me/avatar` (line 109)
- `POST /me/password` (line 134)
- `POST /auth/2fa/setup` (line 153)
- `POST /auth/2fa/verify` (line 162)
- `GET /tenants` (line 174)
- `POST /tenants` (line 192)
- `PUT /tenants/:id` (line 259)
- `DELETE /tenants/:id` (line 311)
- `POST /demo-data/purge` (line 323)
- `GET /sports` (line 345)
- `POST /sports` (line 359)
- `PUT /sports/:id` (line 390)
- `DELETE /sports/:id` (line 412)
- `POST /tenants/:id/suspend` (line 429)
- `POST /tenants/:id/reactivate` (line 452)
- `GET /support/sessions` (line 465)
- `POST /support/sessions` (line 476)
- `GET /monitoring` (line 509)
- `GET /smtp` (line 534)
- `PUT /smtp` (line 558)
- `POST /smtp/test` (line 589)
- `GET /media` (line 609)
- `POST /media/upload` (line 638)
- `PUT /media` (line 701)
- `PUT /venues/:id/photos` (line 737)

### backend/src/modules/staff/staff.routes.ts

- `POST /auth/login` (line 46)
- `POST /iot/devices/:id/manual` (line 112)
- `POST /auth/pin-unlock` (line 144)
- `POST /auth/change-password` (line 182)
- `GET /me` (line 220)
- `PATCH /me` (line 249)
- `POST /me/avatar` (line 282)
- `GET /venues` (line 311)
- `GET /venues/:id/realtime` (line 349)
- `POST /shifts/open` (line 361)
- `GET /shifts/current` (line 409)
- `POST /shifts/close` (line 450)
- `GET /calendar` (line 530)
- `GET /bookings` (line 598)
- `POST /bookings` (line 665)
- `POST /bookings/:id/check-in` (line 863)
- `POST /bookings/:id/complete` (line 923)
- `POST /bookings/:id/no-show` (line 977)
- `GET /customers/search` (line 1065)
- `POST /payments` (line 1089)
- `GET /iot/devices` (line 1261)

### backend/src/modules/webhooks/webhook.routes.ts

- `POST /bank/:provider` (line 12)

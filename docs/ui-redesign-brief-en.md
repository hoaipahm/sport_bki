# UI Redesign Brief: Sports Court Booking Platform (Customer Portal)

**Audience:** AI coding agent.
**Scope:** Visual design (UI/UX) of the **Customer portal** only.
**Out of scope (do NOT touch):** booking logic, API, database, auth, SSE, payments, Staff / Admin / Super Admin portals.
**Stack (per spec):** Next.js + TypeScript. Inspect the repo first. If Tailwind is installed, use Tailwind mapped to the tokens below. Otherwise use plain CSS variables.
**Language rule:** All user-facing text lives in the shared string catalog (vi + en). Never hard-code text. Code, identifiers and comments are English.

---

## 0. Prompt to start with

```
Redesign the Customer portal UI following ui-redesign-brief-en.md.
Goal: replace the current green-gradient + default-serif look with a DARK NEUTRAL look:
charcoal panels, large rounded corners, white headings, gray body text, green accent.
Follow the build order in section 9. Do not change business logic.
Keep vi/en i18n working. After each step run the dev server and verify against the checklist in section 10.
```

---

## 1. Decisions already made (do not re-ask)

| # | Question | Decision |
|---|---|---|
| 1 | Hero mockup source | **Build with HTML/CSS now** as a standalone `PhoneMockup` component. Real screenshots will replace the inner content later without layout changes |
| 2 | Light/dark toggle | **Dark only for now.** Architecture must allow adding light later by overriding tokens under `[data-theme="light"]`. No hex values inside components |
| 3 | Real court photos | **Use real photos when available, otherwise a neutral placeholder** (no stock photos). Banner is described in 5.7 |
| 4 | Other portals | **Unchanged.** Staff, Admin, Super Admin keep their current look and their identifying text labels (spec section 21.2). They may adopt shared tokens in a later task |
| 5 | Spec conflict | Spec section 21 ("Green theme", light) is **superseded for the Customer portal** by this brief. Accessibility rules in spec 21.3 and 21.4 still apply |

---

## 2. Diagnosis of the current UI (Screenshot 1)

| # | Problem | Effect |
|---|---|---|
| 1 | **Web font is not loaded.** All text falls back to the browser default serif (Times-like) | Looks dated. Biggest single issue. Fixing it alone improves the page a lot |
| 2 | Hero is one large flat green gradient block | Heavy, monotone, no focal point, no visual hierarchy |
| 3 | Developer jargon is shown to customers ("PostgreSQL btree_gist", "Server-Sent Events", ".ICS") | Customers do not care; hurts trust and clarity |
| 4 | Hero is text only, no product imagery | Visitor cannot see what the product looks like |
| 5 | All chips, badges and buttons share the same translucent outlined style | No priority between primary and secondary elements |
| 6 | Headline wraps badly ("...Nhanh / Chóng & Tiện Lợi") | Hard to read, unbalanced |
| 7 | Header shares the hero's green, separated only by a faint line | No clear boundary |
| 8 | Abrupt switch from deep green hero to a pure white card | Two unrelated color worlds on one page |
| 9 | Light-green small text on dark green | Fails WCAG AA contrast |

---

## 3. Target style analysis (Screenshot 2)

### 3.1 Layout
- One **large rounded dark panel** (radius about 16 to 24 px) sitting on the page with clear outer margins.
- **Two columns**: images left, text right (roughly 55/45). Stack vertically on mobile.
- **Generous whitespace** (64 to 96 px padding on desktop).
- Left-aligned text, narrow text column (about 40 to 45 characters per line for body).

### 3.2 Color (estimated from the image; verify with an eyedropper)

| Role | Value | Note |
|---|---|---|
| Main panel | about `#25252A` | Charcoal with a slight cool tint. **Not pure black** |
| Inner panel (holds mockups) | about `#2E2E35` | One step lighter than the main panel, creates depth |
| Headings | `#FFFFFF` | Pure white, bold |
| Body text | about `#A1A1AA` | Soft gray |
| Links | Light gray, underlined | No loud color |
| Brand accent | about `#00A862` | Clean, slightly bluish green (Starbucks-like) |

**Color rule:** about 90% neutral dark + white + gray. Green is only for the primary button, icons, small accents and the "confirmed" state. Never fill large areas with green.

### 3.3 Typography
- Headline: very large, bold, tight line-height (about 1.1), broken into meaningful phrases over 3 to 4 lines.
- Body: 16 to 18 px, line-height about 1.7, gray.
- The reference image shows a serif font, probably a fallback. **Do not copy that.** Use a modern sans-serif: **Be Vietnam Pro** (preferred, full Vietnamese support, matches spec 21.4) or Inter.

### 3.4 Imagery
- **Three phone mockups side by side**, each showing one step of the flow, inside a slightly lighter rounded frame, soft shadow.
- Images tell the product story first, text explains second.

### 3.5 Details that make it feel premium
- One consistent set of radii.
- Almost no borders; layers are separated by small differences in background brightness.
- No bright gradients, no glow, no decorative emoji.
- One green accent per area (one button, one badge).

### 3.6 UX principles to apply
1. One message per section (one headline, one paragraph, one visual).
2. Clear hierarchy: headline > description > action.
3. Show the product before explaining it.
4. One primary CTA per screen; secondary actions are outlined or text links.

---

## 4. Design tokens (single source of truth)

Create one token file (for example `styles/tokens.css`, or extend `tailwind.config.ts`). Components use tokens only. **No raw hex values in components.**

```css
:root,
:root[data-theme="dark"] {
  /* Backgrounds */
  --bg-page:        #1B1B1F;
  --bg-panel:       #25252A;
  --bg-panel-2:     #2E2E35;
  --bg-hover:       #34343C;

  /* Text */
  --text-strong:    #FFFFFF;
  --text-body:      #A1A1AA;
  --text-muted:     #7C7C86;
  --text-on-accent: #04210F;   /* dark text on green buttons: better contrast than white */

  /* Accent */
  --accent:         #00A862;
  --accent-hover:   #00C070;
  --accent-pressed: #0B5D3B;
  --accent-soft:    rgba(0, 168, 98, 0.14);

  /* Status (always paired with an icon and a word) */
  --warning:        #F59E0B;
  --danger:         #F87171;
  --info:           #60A5FA;

  /* Lines */
  --border:         rgba(255, 255, 255, 0.08);

  /* Radius */
  --radius-sm: 10px;
  --radius-md: 16px;
  --radius-lg: 24px;
  --radius-full: 999px;

  /* Spacing (4 px scale) */
  --space-1: 4px;  --space-2: 8px;   --space-3: 12px; --space-4: 16px;
  --space-6: 24px; --space-8: 32px;  --space-12: 48px; --space-16: 64px; --space-24: 96px;

  /* Shadow */
  --shadow-card: 0 8px 24px rgba(0, 0, 0, 0.35);

  /* Font */
  --font-sans: "Be Vietnam Pro", Inter, system-ui, -apple-system, "Segoe UI", sans-serif;
}

/* Future light theme: define overrides here later. Do NOT build it now.
:root[data-theme="light"] { ... }
*/
```

**Contrast notes (hand-calculated, re-check with a tool):**
- `--text-body` on `--bg-panel`: about 6:1, passes AA.
- `--accent` as text or icon on `--bg-panel`: about 4.8:1, passes AA.
- **Never put white text on `--accent`** (about 3:1, fails AA for normal text). Use `--text-on-accent`.

### 4.1 Font loading (do this first)

```ts
import { Be_Vietnam_Pro } from 'next/font/google';

export const fontSans = Be_Vietnam_Pro({
  subsets: ['latin', 'vietnamese'],   // 'vietnamese' is REQUIRED
  weight: ['400', '500', '600', '700', '800'],
  display: 'swap',
  variable: '--font-sans',
});
```
Apply `fontSans.variable` on `<html>` and set `body { font-family: var(--font-sans); }`.

### 4.2 Type scale

| Role | Desktop | Mobile | Weight | Line-height |
|---|---|---|---|---|
| Display (hero headline) | 56 px | 36 px | 800 | 1.1 |
| H1 (venue name) | 36 px | 28 px | 700 | 1.2 |
| H2 (section title) | 28 px | 22 px | 700 | 1.25 |
| Body | 16 to 18 px | 16 px | 400 | 1.7 |
| Small / caption | 14 px | 14 px | 500 | 1.5 |
| Badge / label | 12 px, slight uppercase, letter-spacing 0.04em | | 600 | 1 |

No meaningful content below 14 px. Form inputs at 16 px or more (prevents iOS auto-zoom).

---

## 5. Components

### 5.1 Header
- Background `--bg-page`. **No green background.** Height 64 px, `border-bottom: 1px solid var(--border)`, sticky, translucent with `backdrop-filter: blur(12px)` **and a solid fallback color** (Zalo and Facebook in-app browsers).
- Left: logo (rounded square, `--accent-soft` background, green icon) + site name. Hide the tagline on mobile.
- Right: language switch (ghost style, text "VI | EN") + **Login** button (primary).
- The Customer portal has no role label (spec 21.2).

### 5.2 Buttons

| Type | Style |
|---|---|
| Primary | bg `--accent`, text `--text-on-accent`, radius `--radius-full` or `--radius-md`, height 44 px, weight 600, hover `--accent-hover` |
| Secondary | transparent, 1 px border brighter than `--border`, text `--text-strong`, hover `--bg-hover` |
| Ghost | text only, hover `--bg-hover` |
| Danger | only for cancel, delete, refund; always asks for confirmation |
| Disabled | `--bg-panel-2`, text `--text-muted` |

Only **one** primary button should dominate each screen.

### 5.3 Card
- bg `--bg-panel`, radius `--radius-lg`, padding 32 px desktop and 20 px mobile, no border or `--border`, shadow `--shadow-card` (subtle).
- Nested cards use `--bg-panel-2` and `--radius-md`.

### 5.4 Badge / chip
- One main style: bg `--accent-soft`, text `--accent`, pill shape, padding 4 px 12 px.
- Neutral badge (rating, venue type): bg `--bg-panel-2`, text `--text-body`.
- Icon 14 to 16 px, same color as text.

### 5.5 Hero (replace the old hero completely)

```
┌────────────────────────────────────────────────────────────┐
│ panel --bg-panel, radius 24, padding 64                    │
│  ┌──────────────────────┐   Headline (Display, white,      │
│  │ frame --bg-panel-2   │   3 lines)                       │
│  │ [phone][phone][phone]│   2-sentence description (gray)  │
│  │  <PhoneMockup/> x3   │   [Book now]  [See prices]       │
│  └──────────────────────┘                                  │
└────────────────────────────────────────────────────────────┘
```

- Panel sits inside outer margin `--space-6` so it reads as a floating card on the page background.
- Left frame: `--bg-panel-2`, radius `--radius-lg`, contains **three `PhoneMockup` components**.
- Right: headline, description, primary and secondary buttons.
- Mobile: stack vertically, text first. Show 1 to 2 mockups (or a horizontal scroller).

**`PhoneMockup` component (build as a standalone, reusable component):**
- Props: `children` (screen content) and optional `src` (screenshot image).
- Device frame: radius 28 px, 1 px `--border`, soft shadow, aspect ratio about 9:19.
- Default content is a **miniature HTML/CSS UI** of three steps:
  1. Choose court (list of 2 to 3 mini cards)
  2. Choose time (small time grid with a few selected cells)
  3. Pay by QR (square QR placeholder + countdown "09:42")
- The inner mini-UI must use the same tokens. Mark it `aria-hidden="true"`, it is decorative.
- When real screenshots exist later, pass `src` and the component renders `next/image` instead. **Layout must not change.**

### 5.6 Benefit strip (replaces the 4 technical chips)
Remove all four current chips. Use 3 to 4 items in plain customer language (icon + one short line, or small cards):

| Remove | New (vi) | New (en) |
|---|---|---|
| PostgreSQL btree_gist | Không bao giờ trùng lịch | Never double-booked |
| VietQR Tự Động Khớp | Thanh toán QR, xác nhận ngay | Pay by QR, confirmed instantly |
| Giữ Chỗ 10 Phút | Giữ chỗ 10 phút khi thanh toán | Slot held for 10 minutes |
| Vé Lịch .ICS Tức Thì | Thêm vào lịch điện thoại | Add to your phone calendar |

**Rewrite the hero description** (no "Server-Sent Events", no "intermediary wallet"):
- vi: "Xem sân trống theo thời gian thực, chọn giờ và thanh toán bằng mã QR. Tiền chuyển thẳng đến chủ sân."
- en: "See live availability, pick a time and pay by QR. Your money goes straight to the court owner."

**Rewrite the hero headline** (suggested):
- vi: "Đặt sân thể thao trong vài chạm."
- en: "Book a sports court in a few taps."

Put every string into the vi and en catalog files.

### 5.7 Venue info card (below hero)
- One `--bg-panel` card. Order: **court banner** → badges → venue name (H1, white) → info row (address, opening hours, phone) → price block.
- **Court banner:**
  - Aspect ratio 16:9 on mobile, 21:9 on desktop, radius `--radius-md`, `object-fit: cover`, `next/image` with meaningful `alt`.
  - A dark gradient at the bottom so overlaid text stays readable.
  - **If no photo exists:** show a placeholder with `--bg-panel-2` background and a large sport icon in `--text-muted`. **Do not use stock photos.** Venue owners upload real photos via feature A-01.
- Badges: "Tournament standard" (accent-soft) and rating "4.9 · 128 reviews" (neutral).
- Info row: icons `--accent`, text `--text-body`. One item per line on mobile, no awkward wrapping.
- **Price block:** no light-green background. Use a nested `--bg-panel-2` card: small gray label "From", large white price `300.000 đ` with "/ giờ" in gray, same baseline. Primary button "Choose time" next to it.

### 5.8 Court grid states (spec 21.3 logic, dark colors)

| State | Style on dark | Required icon or word |
|---|---|---|
| Free | `--bg-panel-2`, dashed `--accent` border | Word "Trống" |
| Holding | bg `rgba(245,158,11,.15)`, amber text | Clock + minutes left |
| Confirmed | bg `--accent`, text `--text-on-accent` | Check mark |
| Checked in | bg `--accent-pressed`, white text | Person icon |
| Completed | muted dark gray | Faded check |
| Cancelled / no-show | bg `rgba(248,113,113,.15)`, light red text, strikethrough | Word "Hủy" / "Vắng" |
| Blocked / maintenance | gray diagonal stripes | Wrench icon |
| Peak hour | small orange dot in the corner | Word "Giờ vàng" on tap |

Cell height at least 44 px on mobile. **State must never rely on color alone.**

---

## 6. Layout and responsive rules

- Max content width 1200 px, centered. Horizontal padding 16 px (mobile), 24 px (tablet), 32 px (desktop).
- Section spacing 48 px (mobile) and 96 px (desktop).
- Breakpoints 640 and 1024. Two columns only from 1024 up.
- Verify at **360 px**: no horizontal overflow; English strings about 30% longer must not break layout (spec tests I18N-17, UI-04).
- Must work in Zalo and Facebook in-app browsers: provide fallbacks for newer CSS (for example `backdrop-filter`).

## 7. Motion

- Hover and focus transitions 150 to 200 ms `ease-out`.
- Hero panel and mockups: fade in + translate up 12 px once on load.
- Respect `prefers-reduced-motion`: disable all animation.
- No glow, particles or animated gradients.

---

## 8. Do NOT

1. Do not use a green gradient over large areas.
2. Do not show technology names (PostgreSQL, SSE, btree_gist, ICS) in customer UI.
3. Do not allow serif fallback. Verify the font actually loads.
4. Do not use pure `#000` backgrounds.
5. Do not put white text on `--accent`.
6. Do not write raw hex values in components. Tokens only.
7. Do not use color as the only signal for a state.
8. Do not add decorative emoji.
9. Do not rename routes, APIs or data structures.
10. Do not hard-code Vietnamese or English strings.
11. Do not use stock photos for courts.
12. Do not modify Staff, Admin or Super Admin portals.

---

## 9. Build order (each step must leave the app working)

1. **Font:** install Be Vietnam Pro via `next/font` with the `vietnamese` subset and set it globally. Confirm no serif remains.
2. **Tokens:** create the token file (section 4). Set `body` to `--bg-page` and `--text-body`. Add the `data-theme="dark"` attribute on `<html>`.
3. **Primitives:** build `Button`, `Badge`, `Card`. Replace old ones in the Customer portal.
4. **Header:** section 5.1.
5. **`PhoneMockup` + Hero:** remove the old gradient hero. Build section 5.5 and rewrite copy per 5.6 (add keys to both vi and en files).
6. **Benefit strip:** replace the 4 technical chips (5.6).
7. **Venue info card:** court banner with placeholder fallback, badges, info row, price block (5.7).
8. **Court grid and remaining Customer screens** (login, payment, my bookings): move to tokens and dark colors (5.8).
9. **Responsive and accessibility pass** (sections 6 and 10).
10. Report: list all files changed and any remaining usages of old colors or hard-coded hex.

---

## 10. Acceptance checklist

- [ ] No serif text anywhere (check Computed `font-family` in DevTools).
- [ ] Vietnamese diacritics render correctly at all weights (400 to 800).
- [ ] No large green gradient remains.
- [ ] The words "PostgreSQL", "Server-Sent Events", "btree_gist", ".ICS" do not appear in customer UI.
- [ ] One dominant primary button per screen.
- [ ] Hero is two columns on desktop and one column on mobile, with `PhoneMockup` components.
- [ ] `PhoneMockup` can switch to a real screenshot via `src` without layout change.
- [ ] Venue banner shows a neutral placeholder when no photo exists.
- [ ] Contrast for normal text is at least 4.5:1, large text and icons at least 3:1.
- [ ] In grayscale, all court grid states are still distinguishable (UI-03).
- [ ] At 360 px: no horizontal overflow; English strings do not break layout.
- [ ] Tap targets at least 44 px, content text at least 16 px on mobile.
- [ ] vi/en switch works and no raw keys appear (I18N-08).
- [ ] `prefers-reduced-motion` disables animation.
- [ ] No raw hex in components: `grep -rE "#[0-9a-fA-F]{3,6}"` only matches the token file.
- [ ] Adding a `[data-theme="light"]` block of token overrides is the only change needed to support light mode later.
- [ ] Booking, payment and SSE behavior is unchanged.
- [ ] Staff, Admin and Super Admin portals are visually unchanged.

---

## 11. Open items (only ask if blocked)

1. Real court photos: none provided yet, use the placeholder from 5.7.
2. Real app screenshots: none yet, use the HTML/CSS `PhoneMockup` from 5.5.
3. Whether the Staff portal should later get a light theme (counter environments are usually bright). Out of scope for this task.

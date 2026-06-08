# Dr. Scottsdale® — v1

Personal-brand site for **Dr. Carlos Mata** (Dr. Scottsdale®), the headlining
surgeon at Natural Results Plastic Surgery. Designed to scale the personal
brand as a standalone SEO/search property while staying clearly in the same
family as `naturalresultsaz.com`.

This v1 is a **static HTML deployment** so we can iterate visually fast. The
working Next.js scaffolding (Ask Dr. Scottsdale chat + GHL booking widget +
shared component library) lives in `/redesign/dr-scottsdale/` and ships as v2
once the design is locked.

## Visual direction (locked v3, 2026-06-08)

- **Palette**: Dr. Mata's purple foundation (`#0E001F` → `#1A0033` → `#3D0066`
  → `#8B00D4`) with champagne gold (`#D4A853`) leading as the accent. Same
  brand family as NR, with gold-forward weighting + saturated purple glows
  giving Dr. Scottsdale a more confident / social-first feel.
- **Typography**: Bebas Neue (condensed athletic display), Inter (body),
  Italianno (script wordmark callback). Distinct from NR's Cormorant
  Garamond serif system.
- **Components**: Rounded-pill buttons (matches NR's modern luxe aesthetic),
  24px rounded cards, soft luxe shadows. No hard right angles.

## Sections

1. **Hero** — Dr. Mata portrait + brand wordmark + dual CTA + stats strip
2. **Recognized Excellence** — Newsweek per-procedure callouts (Lipo since 2022,
   Facelift + Breast Aug since 2023), Castle Connolly Top 1% since 2018,
   RealSelf + ABPS/FACS + ASPS/ASAPS/WAGS membership strip
3. **Signature Procedures** — Scottsdale Skinny®, Gladiator®, Magic Shot®
   with real photo backgrounds + hover lift
4. **About Dr. Scottsdale** — Portrait + brand voice + credential chips
5. **Real Results** — B&A pairs (Mommy Makeover + Breast Aug) with gallery CTA
6. **Social Proof** — 1M+ follower grid (IG, TikTok, Snapchat, YouTube)
7. **As Featured In** — Men's Health, LA Weekly, USA Today, Yahoo, Voyage Phoenix
8. **Ask Dr. Scottsdale** — AI chat (UI shipped, server-side wiring in v2)
9. **Final CTA** — Booking consultation block
10. **Footer** — Practice address, social, legal

## Assets

All imagery in `/images/` was pulled from the live `naturalresultsaz.com`
production deployment — same surgeon, same procedures, asset continuity
already verified.

- `dr-mata.jpg` — Studio portrait (used in hero + about)
- `sig-scottsdale-skinny.png`, `sig-rapid-recovery.png`, `sig-magic-shot.png`
- `ba-mommy-before.jpg` / `ba-mommy-after.jpg` — Mommy Makeover pair
- `ba-breast-before.jpg` / `ba-breast-after.jpg` — Breast Aug pair
- `press-*.png` — Men's Health, LA Weekly, USA Today, Yahoo, Voyage, Top Docs
- `badge-realself.png`, `badge-abps.png`, `badge-castleconnolly.png`

## Next (v2)

- Wire the floating Ask Dr. Scottsdale chat to a `/api/ask-dr-scottsdale` proxy
  that shares the same retrieval + procedure catalogue as nr-website
- Wire the Book Consult floating CTA to the existing nrps-admin GHL widget
  endpoint (`/api/widget/quote` + `/api/widget/text`)
- Port full B&A gallery from Dr. Scottsdale WP "BA Gallery" media library
- Procedure detail pages for each signature
- Refactor nr-website + dr-scottsdale into a monorepo with a shared
  `packages/ui/` for the chat widget, booking widget, and procedure
  catalogue retrieval — so future doctor #3 ships in days, not weeks

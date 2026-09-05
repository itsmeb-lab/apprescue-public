# AppRescue.ai site upgrade

## HERO_FINAL

> **You already built version 1. Now find out what you can actually trust.**
>
> App Rescue helps you inspect AI-built apps, surface risk, establish verification, and choose a safer path forward — keep, repair, or rebuild — without more blind prompting.

CTA: **Request Private Beta Access**

## MAJOR_SECTIONS

1. Hero — trust-focused headline + private beta CTA
2. The Problem — AI v1 easy / trust & change hard; wasted tokens & hours
3. What App Rescue Does — import/map → surface risk → verification → guide next move (beta honesty note)
4. What You Get — structure map, risk findings, proof baseline, keep/repair/rebuild framing
5. Why Not Another Prompt — blind re-prompting vs App Rescue approach
6. Decision Framing — Keep / Repair / Rebuild
7. Who It’s For — text-only audience fit (no logos)
8. Private Beta — Netlify `beta-signup` form CTA
9. Final CTA + footer

## CHANGED_PATHS

- `index.html` — full page upgrade (inline CSS/JS)
- `favicon.svg` — new SVG favicon (referenced in head)
- `og-image.svg` — new OG/Twitter image (referenced with absolute URL)
- `netlify.toml` — `publish = "."` + lean security/cache headers
- `CHANGELOG_UPGRADE.md` — this file

## Notes

- Netlify Forms preserved: `name="beta-signup"`, hidden `form-name`, honeypot `bot-field`, fields `email` / `built_with` / `biggest_issue`, `data-netlify="true"`, `netlify-honeypot="bot-field"`, fetch POST with urlencoded FormData + success state + `form.submit()` fallback.
- Claim-safe copy only; no fabricated customers, logos, testimonials, or metrics.
- No AppAssessment / AppGuardian / Wilke links; no trackers; no heavy frameworks.

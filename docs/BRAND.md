# Upward — brand guide

**Upward** · *A guide for every stage of the game.*

Forest tone: warm off-white surfaces, deep forest green primary, and three
supporting accents (gold, terracotta, blue). Calm and outdoorsy rather than
neon-sporty — the app reads like a coach's field notebook, not a scoreboard.

## Palette

| Token | Hex | Use |
|---|---|---|
| Primary (forest green) | `#264C34` | Buttons, links, active states |
| Background (warm off-white) | `#F4F2E7` | App background |
| Badge green | `#1A2E1E` | Logo badge, icon background, text/shape on green |
| Accent gold | `#D6BD5C` | Logo triangle, decorative fills, highlights |
| Accent terracotta | `#BE7C65` | Decorative fills |
| Accent blue | `#6A839E` | Decorative fills |

The raw accents are mid-tone, so anywhere they must carry **text or small
chips on the light background** the UI uses deepened variants (defined in
`apps/mobile/src/theme.ts`): game `#A8563C` (terracotta), practice `#4E6A8A`
(blue), home `#2F6B44` (forest), off-season/warn `#8F7420` (gold), danger
`#9C5540` (terracotta).

## Mark

Rounded badge, `#1A2E1E`, corner radius 16/64 of its size; gold upward
triangle ~26×20 at 64px, centered. On green surfaces the badge inverts:
white badge, `#1A2E1E` triangle.

Generated assets (regenerate with the script noted in each file's origin —
`scratchpad/shots/gen-assets.mjs` renders them via headless Chromium):

- `apps/mobile/assets/icon.png` — app icon (full-bleed badge green)
- `apps/mobile/assets/adaptive-icon.png` — Android foreground (triangle only)
- `apps/mobile/assets/splash-icon.png` — badge + wordmark on transparent
- `apps/mobile/assets/favicon.png` — web favicon

## Typography

- **Wordmark & headings**: Sora — wordmark `Sora 800`, letter-spacing −0.5px
  ("Upward", never all-caps); `h1` Sora 800, card titles Sora 700
  (loaded via `@expo-google-fonts/sora`).
- **Tagline**: system font, uppercase, wide letter-spacing (see
  `shared.tagline`).
- **Body/UI**: system font stack.

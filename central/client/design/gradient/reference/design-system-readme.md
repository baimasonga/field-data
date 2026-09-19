# Gradient Design System

> **subtle · beautiful · minimalistic**

Gradient is a design system for a modern software brand. Its personality is quiet: a clean neutral canvas, generous whitespace, one restrained typeface, and a single expressive flourish — the **signature gradient** — used sparingly at brand moments. Everything else recedes so content and light can lead.

The one idea to hold onto: **the system is 95% neutral and 5% gradient.** The gradient is precious. Spend it on the logo, one hero wash, one emphasized word, one primary CTA — never as background decoration on ordinary UI.

---

## Context & provenance

- **Brand brief:** "Gradient design system: subtle, beautiful and minimalistic." This is a **from-scratch brand** — there was no existing product, codebase, Figma file, or logo supplied.
- **Reference material:** `uploads/Gradient design system.md` — a large catalogue of ~70 real design-system analyses (Airbnb → Zapier). It was used **only** as a structural and quality reference for what a great design system contains; **none of those brands were copied.** Gradient's palette, type, gradients, and components are original to this system.
- **What's invented (and flagged):** the **Logo** mark is an original placeholder (a CSS gradient tile), the **fonts** are open-source substitutes, and the **icon set** is Lucide (a substitution). See Caveats.

If you later have the real brand's fonts, logo, or product screens, drop them in and this system upgrades cleanly — tokens and components are the stable layer.

---

## Content fundamentals — how Gradient writes

The voice matches the visuals: **calm, precise, and confident, never loud.** Say less; mean more.

- **Casing:** Sentence case everywhere — headings, buttons, labels, nav. Never Title Case, never ALL CAPS except the tiny `overline` eyebrow (tracked +0.09em).
- **Person:** Address the reader as **"you"**; the product/brand is **"we"** sparingly. "You" is the subject of most sentences.
- **Tone:** Understated and human. Short, declarative sentences. Lead with the verb and the benefit. Trust whitespace instead of exclamation.
- **Length:** Ruthlessly tight. A hero headline is 2–6 words. A sub-headline is one sentence. Button labels are 1–2 words ("Get started", "Start free", "View docs").
- **No hype, no filler:** Avoid "revolutionary", "seamless", "unlock", "supercharge", "delightful". Prefer plain, specific words.
- **No emoji.** Not in UI, not in copy. Meaning is carried by type, space, and the Lucide icon set.
- **Numbers & units:** numerals for data ("3 projects", "20% off"), spelled out only when starting a sentence.
- **Punctuation:** Minimal terminal punctuation on headings and buttons. Use the em dash — like this — for asides.

**Examples of the voice**

- Hero: *"Designed on a gradient."* / *"Ship something beautiful."*
- Sub: *"A calm, considered interface for teams who care about the details."*
- Button: *Get started* · *View pricing* · *Read the docs*
- Empty state: *"Nothing here yet. Create your first project to get going."*
- Error (Toast): *"Upload failed. Check your connection and try again."*
- Success (Toast): *"Saved. Your workspace is up to date."*

---

## Visual foundations

### Color

- **Neutral-first.** A slightly **cool slate** ramp (`--gray-0` → `--gray-1000`, hue ≈ 260, very low chroma) carries almost everything: canvas, surfaces, borders, text. Text ink is `--gray-900` (#20202b) — **never pure black**. Canvas is `--gray-25` (#fcfcfe) — never stark white for large fields (pure white is reserved for lifted cards).
- **One chromatic voltage: Iris.** `--iris-600` (#5d4ee0) is the single accent — primary CTAs, focus rings, links, selection, the brand mark. Used with discipline; if a screen feels colorful, it's wrong.
- **Spectrum hues** (violet, orchid, rose, coral, amber, teal, sky) exist **only** to compose gradients and for data-viz / illustration accents. They are not UI fills.
- **Semantic** colors (success green, warning amber, danger red, info blue) are muted and refined, each with a solid + a light tint pair. They appear only for status.
- **Dark theme** ships as `[data-theme="dark"]` / `.dark`, remapping every semantic token onto a near-black (`--gray-1000` #0c0c11) canvas with translucent-white borders.

### The gradient (the brand's soul)

Gradients are **soft, analogous-to-warm sweeps** — iris → orchid → rose → coral — never neon, never a full rainbow. Named tokens:

- `--gradient-aurora` — the hero sweep (cool iris resolving to warm coral).
- `--gradient-spectrum` — a tighter 3-stop for thin accent rules, underlines, mark fills.
- `--gradient-iris` — a mono-hue gradient for primary CTAs / solid brand surfaces.
- `--gradient-dusk` — the dark-canvas hero (deep indigo → plum).
- `--gradient-mesh` — a multi-point atmospheric wash for full-bleed dark brand panels.
- `--gradient-halo` — a barely-there radial wash for section backgrounds on light canvas (reads as *atmosphere*, not color).

Rule of thumb: **one gradient per view.** If two things on a screen use a gradient, one of them is wrong.

### Type

- **One typeface, one voice:** **Hanken Grotesk** (300–800) carries display, UI, and body. Hierarchy comes from **size + weight + tracking**, not from switching families. **JetBrains Mono** is used only for code, data, IDs, and keycaps.
- **Display tracks tight and negative** (down to −0.03em at 72px); body sits at 0. The only positively-tracked, uppercase style is the `overline` eyebrow (+0.09em).
- Display weight lives at **600** — Gradient resists heavy 700–800 headlines. Weight 500 for subtitles, 400 for body.
- Full scale in `tokens/typography.css`: `display-2xl` (72) → `display-xl` (56) → `display-lg` (44) → `display-md` (34) → `headline` (26) → `title` (20) → `subtitle` (18) → `body-lg/body/body-sm` → `caption` (13) → `overline` (12) → `mono`.

### Space & layout

- **4px base grid** (`--space-*`). Be generous: whitespace is the medium. Section rhythm leans on `--space-16`/`--space-24` (64/96px); card interiors on `--space-6`/`--space-8` (24/32px).
- Containers cap at `--container-xl` (1200px) for marketing, `--container-2xl` (1360px) for app shells. Content is centered with calm margins; layouts are mostly single- or two-column, never dense.
- **Fixed elements** are minimal: a slim sticky top nav (~64px) and the occasional sticky sidebar. No floating clutter.

### Elevation, borders, radius, cards

- **Shadows** are soft, cool-tinted, low-opacity, and layered (`--shadow-xs` → `--shadow-2xl`) — a single soft light from high above. Never harsh or dark.
- The **iris glow** (`--glow-iris`) is chromatic and reserved for gradient/brand elements and primary-CTA hover — used sparingly.
- **Borders** are hairline (1px, `--border-subtle`/`--border-default`). On light canvas, hierarchy is carried by surface lift + hairline, rarely by heavy shadow.
- **Radius** is soft-modern, never bubbly: buttons/inputs `--radius-sm` (8px), cards `--radius-lg` (14px), panels/dialogs `--radius-xl` (20px), pills/avatars full. A brand card uses a 1.5px **aurora gradient border**.
- **Cards**: white (`--color-surface`) on the canvas, hairline border, `--shadow-xs`; `elevated` drops the border for a soft `--shadow-lg`; `flat` is a sunken inset panel; `gradient` gets the aurora border for a single brand moment.

### Motion

- **Subtle and quick.** 120–200ms, ease-out (`ease` / `cubic-bezier(.2,.9,.3,1)`). Fades and small translate/scale nudges; the switch knob gets a tiny spring. **No bounces, no long or flashy animations.** Hover feedback is a gentle color/shadow shift; press nudges 0.5px down. Nothing moves that doesn't need to.

### Transparency & blur

- Used only where it earns its keep: the dialog scrim (`--color-scrim` + a 3px backdrop blur) and dark-surface translucent-white borders. No frosted-glass everywhere.

### Imagery

- Photography (when present) should be **calm and true-to-life** — soft natural light, unsaturated, cool-neutral cast to sit beside the iris accent. Product UI screenshots are framed in `--radius-xl` panels on a surface lift. Avoid heavy filters, high-contrast drama, or warm/vintage grades.

---

## Iconography

- **Icon set: [Lucide](https://lucide.dev)** — a clean, consistent line family at a **2px stroke**, which matches Gradient's understated tone. This is a **chosen substitution** (no proprietary icon set was supplied).
- **Delivery:** the `Icon` component renders **inline SVG** from bundled Lucide path data (see `components/icon/`), so glyphs inherit `currentColor` and `stroke-width`, recolor on any surface (including colored buttons), and work **offline**. ~80 common glyphs ship inlined; browse names at lucide.dev and add more to the map in `Icon.jsx`.
- **Usage:** icons are decorative by default (`aria-hidden`); pass `label` when an icon carries meaning alone. Standardize on Lucide — do **not** mix other icon sets, and **never** use emoji or arbitrary Unicode as icons.
- **Sizing:** icons default to `1em` and follow the text they sit beside; pass `size` to fix them (16–20px is typical in UI).

---

## Components

Reusable React primitives. Import from the compiled bundle: `const { Button, Card, … } = window.GradientDesignSystem_756db6`. Each lives in `components/<group>/` with a `.jsx`, a `.d.ts` (props contract), a `.prompt.md` (what & when), and one `@dsCard` per directory. Components are self-contained (React only; styling via the CSS custom-property tokens).

**Core** — `components/core/`
- **Button** — primary / gradient / secondary / ghost / danger; sizes, loading, icons.
- **IconButton** — icon-only control; ghost / secondary / primary / gradient; round option.
- **Card** — surface container; default / elevated / flat / gradient; padding + interactive.
- **Badge** — status/label pill; neutral / accent / success / warning / danger / info; dot, solid.
- **Tag** — content / filter chip; selectable and removable.

**Icon** — `components/icon/`
- **Icon** — inline Lucide line glyph; inherits color + size.

**Forms** — `components/forms/`
- **Input** — single-line text field; leading/trailing icons, invalid state, sizes.
- **Textarea** — multi-line field.
- **Select** — styled native dropdown with chevron.
- **Checkbox** — with label + indeterminate state.
- **Radio** — mutually-exclusive choice.
- **Switch** — immediate binary toggle.

**Feedback** — `components/feedback/`
- **Dialog** — modal with scrim, animation, Escape / click-out to close.
- **Toast** — transient notification; info / success / warning / danger.
- **Tooltip** — hover/focus hint on any side.

**Navigation** — `components/navigation/`
- **Tabs** — controlled tab bar; underline or pill variant.

**Brand** — `components/brand/`
- **GradientText** — clips a signature gradient into text (one phrase per view).
- **Logo** — the Gradient lockup (full / mark / wordmark, mono). *Placeholder mark — see Caveats.*
- **GradientSurface** — atmospheric brand panel (halo / aurora / dusk / mesh); dark variants flip nested components to the dark palette.

---

## Repository index (manifest)

```
styles.css              Global entry — @import manifest only. Consumers link THIS.
tokens/
  fonts.css             Webfont loading (Google Fonts substitute stack)
  colors.css            Color primitives — gray, iris, spectrum, semantic ramps
  typography.css        Font families, weights, and the type scale
  spacing.css           4px spacing scale + container widths
  radius.css            Corner radii + border widths
  shadows.css           Elevation, iris glow, focus rings
  gradients.css         Signature gradient tokens (aurora, spectrum, iris, dusk, mesh, halo)
  semantic.css          Semantic aliases + [data-theme="dark"] overrides
  base.css              Resets, link colors, and brand utilities (.g-gradient-text, .g-rule …)
guidelines/             Foundation specimen cards (Colors, Type, Spacing, Effects, Brand)
components/<group>/      Reusable primitives (jsx + d.ts + prompt.md + @dsCard)
ui_kits/<product>/       Full-screen product recreations (see below)
templates/<slug>/        Copy-to-start artifacts for consuming projects
thumbnail.html           Homepage tile for the design system
readme.md                This file
SKILL.md                 Agent-Skill front matter for portable use
```

**UI kits** (full-screen recreations, in `ui_kits/`):
- **Marketing** — the Gradient product landing page (hero, features, pricing).
- **App** — the Gradient product app shell (dashboard, projects, settings).

**Templates** (in `templates/`): copy-to-start artifacts that compose the components for consuming projects.

---

## Fonts — substitution notice

No brand fonts were provided, so Gradient loads open-source substitutes via Google Fonts (`tokens/fonts.css`):
- **Hanken Grotesk** — the sans (display + UI + body).
- **JetBrains Mono** — the mono.

These are loaded by URL rather than bundled as `@font-face` binaries, so the compiler reports **0 registered fonts** — that's expected. To productionize, replace the `@import` with self-hosted `@font-face` rules (or swap in the brand's licensed/custom cuts) and update the `--font-*` tokens.

---

## Caveats & how to help me make this perfect

This is a strong, opinionated **from-scratch** interpretation of a three-word brief. A few things are **placeholders I invented** and would love your direction on:

1. **The logo is a placeholder.** The `Logo` mark is an original CSS gradient tile — generic on purpose. **If you have a real Gradient wordmark/mark, send it** and I'll wire it in everywhere (nav, thumbnail, kits).
2. **Fonts are substitutes.** Hanken Grotesk + JetBrains Mono are my picks for the vibe. **If the brand has licensed type, share the files** and I'll register proper `@font-face` rules.
3. **Icons are Lucide** (a substitution). Happy to switch sets if you have a preferred one.
4. **The gradient direction is a choice.** I went iris → orchid → rose → coral. Want it cooler (iris → periwinkle → sky), warmer, or more monochrome? Say the word.
5. **Light-first, dark included.** If Gradient should be dark-first, I'll flip the defaults.

**My ask:** tell me (a) is the *aesthetic direction* right, and (b) send any **real brand assets** (logo, fonts, product screenshots) so I can replace the placeholders and tune the UI kits to your actual product. Then I'll iterate this to pixel-perfect.

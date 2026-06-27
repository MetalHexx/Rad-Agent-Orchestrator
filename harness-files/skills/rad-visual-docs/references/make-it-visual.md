# Make It Visual

Everything you need to create cool visuals from any source content.  Use this to summarize brainstorming sessions, meeting notes, or other textual information. If the user actually wants a UI mockup, use the `generate-mockup` skill instead.

---

## What It Does

Generates screenshot-ready, self-contained HTML (or SVG) visuals from any source content:

| Source | Output |
|---|---|
| The active brainstorming context or document if one has been scribed | Structured visual summary locked goals |
| Ticket / story / epic / bug (issue tracker) | HTML card layout with status, metadata, sections |
| Sprint / dashboard / metrics | HTML stat cards + breakdown tables |
| Doc / meeting notes  | HTML structured summary with section cards |
| Architecture / connection / flow diagram | SVG embedded in HTML |
| "SVG only" request | Standalone `.svg` |

---

## File Mechanics

- **Path (exact filename)**: `~/.radorc/projects/{PROJECT-NAME}/{PROJECT-NAME}-BRAINSTORM.html` — the visual companion to `BRAINSTORMING.md` (one per project; regenerating overwrites it).
  - Use this **exact** name — not `-BRAINSTORM-VISUAL.html` or any other suffix.
  - The dashboard fills its "Brainstorm Visual" slot only from this name; a deviation still shows as a generic visual but won't fill that slot.
  - It's ok if you use another name for a different document -- we're not limited to brainstorming docs in general.
- **Folder creation**: Create `~/.radorc/projects/{PROJECT-NAME}/` if it doesn't exist. Do NOT create subfolders (`phases/`, `tasks/`, `reports/`) — the Orchestrator handles that during project initialization.
- **Project name**: Always `SCREAMING-CASE` (e.g., `MY-NEW-FEATURE`).

---

## Workflow (follow in order)

1. **Identify source.** Usually this will be brainstorming context or a specific document. But if the user references a ticket, sprint, or known doc, consider pulling that in as the source content.
2. **Mode.** Default = **dark**. Use light only if the user says "light mode", "white background", "no dark", or "bright version".
3. **Brand.** If they give a third-party URL → run the brand sampling step. If no brand → use defaults.
4. **Brand sampling (URL given only).** Run colors + fonts + logos + voice (see Brand Sampling section). Show preview and wait for confirmation before generating.
5. **Layout.** Match source type to a layout pattern below.
6. **Data.** Use only real source data — no Lorem Ipsum, no invented labels.
7. **Save.** Write to the output folder; confirm the exact filename; then offer to open it in the dashboard (see *View Scribed Docs in the Dashboard* in the main SKILL.md) — never open it as a `file://` page in a separate browser tab.

---

## HTML Rules

- All CSS in `<style>` — no external files, no CDN (Google Fonts `<link>` is the only allowed external load, and only when a brand font was sampled).
- No JavaScript for layout or primary content.
- Fixed width `1200px` in `.page-wrap` — consistent screenshot size regardless of viewport.
- All text from actual source data only.

---

## Layout Patterns

### Ticket / Story Card

```
┌─────────────────────────────────────────────────────────┐
│  [TICKET-KEY]  [Issue Type]  [Priority]       [Status]  │
│  Summary title — large, prominent                       │
├─────────────────────────────────────────────────────────┤
│  Assignee · Sprint · Epic · Story Points · Reporter     │
├─────────────────────────┬───────────────────────────────┤
│  Description / Goal     │  Key Metadata / Labels        │
├─────────────────────────┴───────────────────────────────┤
│  Acceptance Criteria          │  Notes for Dev          │
│    ✓ AC item 1                │  • Note 1               │
├───────────────────────────────┴─────────────────────────┤
│  Linked Issues / Subtasks (if present)                  │
└─────────────────────────────────────────────────────────┘
```

### Dashboard / Metrics

```
┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐
│  Stat 1  │  │  Stat 2  │  │  Stat 3  │  │  Stat 4  │
│   [n]    │  │   [n]    │  │   [n]    │  │   [n]    │
└──────────┘  └──────────┘  └──────────┘  └──────────┘
┌─────────────────────────────────────────────────────────┐
│  Data table or breakdown section                        │
└─────────────────────────────────────────────────────────┘
```

### Document / Notes Summary

```
┌─────────────────────────────────────────────────────────┐
│  Document Title                         [Date] [Source] │
├──────────────────────────┬──────────────────────────────┤
│  Key Points              │  Action Items / Decisions    │
│  • Point 1               │  ☐ Action 1 — Owner          │
├──────────────────────────┴──────────────────────────────┤
│  Section-by-section breakdown (cards per heading)       │
└─────────────────────────────────────────────────────────┘
```

### Architecture / Connection Diagram

SVG embedded in HTML `<div>`. Color zones: purple = AI products, blue = data sources, green = infra. Solid arrows = active, dashed = planned. Always include a legend.

---

## Design Tokens

### Dark Mode (default)

```css
:root {
  /* Base */
  --base:       #0a0016;   /* page background — deep purple-black, NOT blue-navy */
  --surface:    #130020;   /* cards, panels */
  --elevated:   #1b0030;   /* modals, raised elements */
  --border:     #350055;
  --border-acc: rgba(111, 0, 239, 0.55);

  /* Text */
  --txt1:       #f0e8ff;   /* primary — 17:1 on base ✓ */
  --txt2:       #b4a8c8;   /* secondary */
  --txt3:       #9080aa;   /* muted */

  /* Brand accents */
  --purple:     #6f00ef;
  --purple-lt:  #a855f7;   /* 6.3:1 on card ✓ — use for heading text */
  --cyan:       #00cbff;   /* 10:1 on dark ✓ */
  --amber:      #ffcc36;   /* 14:1 on dark ✓ */
  --orange:     #fa6400;   /* 6:1 on dark ✓ */
}
```

**Dark mode extras:**
- Body background texture: `body::before` radial gradient `rgba(111,0,239,0.14)` + crosshatch `rgba(111,0,239,0.07)`
- Title gradient: `linear-gradient(135deg, #ffffff, #6f00ef, #00cbff)`
- Hover shadow: `box-shadow: 0 8px 28px rgba(111,0,239,0.45)`
- Step/badge glow: `background: rgba(111,0,239,0.18)`, `box-shadow: 0 0 22px rgba(111,0,239,0.65)`

### Light Mode

Triggered by: "light mode", "light theme", "white background", "no dark", "bright version".

```css
:root {
  /* Base */
  --base:       #ffffff;   /* clean white, NOT cream or grey */
  --surface:    #f6f2ff;
  --elevated:   #ede8fa;
  --border:     #d4c8ee;
  --border-acc: rgba(111, 0, 239, 0.45);

  /* Text */
  --txt1:       #0d001a;   /* 15:1 on base ✓ */
  --txt2:       #4a3d63;   /* 7:1 on base ✓ */
  --txt3:       #7a6896;

  /* Brand accents (darkened for AA on white) */
  --purple:     #6f00ef;   /* 9:1 on white ✓ */
  --purple-lt:  #a855f7;
  --cyan:       #0099cc;   /* darkened 20% from brand cyan */
  --amber:      #b38a00;   /* darkened 30% */
  --orange:     #c04b00;   /* darkened for AA */
}
```

**Light mode extras:**
- Cards: `background: var(--surface)` + `border: 1px solid var(--border)`
- Title gradient: `linear-gradient(135deg, #0d001a, #6f00ef, #0099cc)`
- Shadows: `box-shadow: 0 4px 16px rgba(111,0,239,0.15)`

### Typography

```css
/* Font stack */
font-family: "Inter", system-ui, -apple-system, "Segoe UI", Helvetica, Arial, sans-serif;
font-family: "JetBrains Mono", "Fira Code", monospace; /* code blocks only */

/* Scale */
h1:    2rem / 700 weight
h2:    1.5rem / 600 weight   (use --purple-lt on dark, --purple on light)
h3:    1.125rem / 600 weight
body:  0.9rem / 400 weight / 1.6 line-height
label: 0.75rem / 500 weight / uppercase / letter-spacing: 0.08em
```

### Status Badges

**Dark mode:**

| Status | Background | Text |
|---|---|---|
| Done / Closed | `rgba(16,185,129,0.15)` | `#10b981` |
| In Progress | `rgba(59,130,246,0.15)` | `#3b82f6` |
| To Do / Open | `rgba(100,116,139,0.15)` | `#94a3b8` |
| Blocked / Overdue | `rgba(239,68,68,0.15)` | `#ef4444` |
| Review / Testing | `rgba(245,158,11,0.15)` | `#f59e0b` |
| Cancelled | `rgba(100,116,139,0.1)` | `#8896aa` + strikethrough |

**Light mode:**

| Status | Background | Text |
|---|---|---|
| Done / Closed | `#dcfce7` | `#15803d` |
| In Progress | `#dbeafe` | `#1d4ed8` |
| To Do / Open | `#f1f5f9` | `#475569` |
| Blocked / Overdue | `#fee2e2` | `#dc2626` |
| Review / Testing | `#fef3c7` | `#b45309` |
| Cancelled | `#f1f5f9` | `#64748b` + strikethrough |

### Card Component CSS

**Dark:**
```css
background: #130020;
border: 1px solid rgba(111, 0, 239, 0.2);
border-radius: 10px;
padding: 20px 24px;
box-shadow: 0 4px 20px rgba(0,0,0,0.4);
```

**Light:**
```css
background: #ffffff;
border: 1px solid #d4c8ee;
border-radius: 10px;
padding: 20px 24px;
box-shadow: 0 2px 8px rgba(0,0,0,0.06);
```

---

## Design Don'ts

- ❌ Blue-navy base (`#0d0d1a`, `#1a1a2e`) — use purple-black
- ❌ Grey text (`#94a3b8`) on dark — use purple-tinted tokens
- ❌ Pure black `#000000` — use `#0a0016`
- ❌ Unmodified amber/cyan on white — use the darkened light-mode values
- ❌ Non-135deg gradients
- ❌ `#64748b` for text on dark backgrounds — fails AA
- ❌ `#94a3b8` for text on light backgrounds — fails AA
- ❌ Color alone to convey meaning — always pair with a label or icon
- ❌ Text below 11px

---

## Brand Sampling (Third-Party URLs)

When the user gives a website URL and asks for a branded visual:

### Step 1 — Colors

1. Fetch the homepage HTML + linked CSS files.
2. Extract all hex / `rgb()` / `hsl()` values from CSS declarations.
3. Rank by frequency; drop pure white/black/neutral grays.
4. Top 2–4 unique brand-hue values = the palette.

### Step 2 — Fonts

1. Parse all `@font-face` blocks for `font-family` + `src`.
2. Capture `<link href="https://fonts.googleapis.com/css2?family=...">` declarations.
3. Read inline `font-family:` on `body`, `h1`, `h2`, and `--font-*` CSS custom properties.
4. Output top 2 stacks: **headline** (from h1/h2) and **body** (from body).
5. Embed via Google Fonts `<link>` if Google-hosted; otherwise use nearest system font.

### Step 3 — Logo

Scan in order:
1. `<link rel="icon">`, `<link rel="apple-touch-icon">`, `<link rel="mask-icon">`
2. `<meta property="og:logo">` and `og:image`
3. `<img>` / `<svg>` with `class*="logo"`, `id*="logo"`, or `alt` matching `/logo/i` in `<header>` or `<nav>`
4. Light/dark variants: `<picture>` with `<source media="(prefers-color-scheme: dark)">`, or filename patterns like `logo-light.svg` / `logo-dark.svg`

Logo is always opt-in — never embed without user confirmation.

### Step 4 — Voice & Tone

Pull four text sources and distill into a **1–2 sentence style directive**:

| Source | What it reveals |
|---|---|
| Hero headline + subhead | The most curated voice example on the site |
| Primary CTA button copy | Formality dial |
| About / mission paragraph | Person (we / you / third), values vocabulary |
| Nav labels + footer | Plain vs corporate register |

Output example: *"Warm and direct. Short sentences, active voice, second person. Names problems plainly — avoids jargon and hedge words."*

### Step 5 — Contrast Classification (run before preview)

For every sampled color, compute WCAG 2.2 contrast ratio against the target backgrounds:

| Tier | Ratio | Permitted roles |
|---|---|---|
| `TEXT-SAFE` | ≥ 4.5:1 | Body text, labels, captions, badge text |
| `LARGE-TEXT-SAFE` | ≥ 3:1 and < 4.5:1 | Headings ≥ 18px or ≥ 14px bold; UI borders; icon fills |
| `UI-ONLY` | ≥ 3:1 | Non-text UI: borders, dividers, decorative shapes |
| `DECORATION-ONLY` | < 3:1 | Background fills, gradient stops — **never text** |

**Hard rules:**
- `DECORATION-ONLY` must never appear as text — no exceptions.
- If every sampled brand color falls below `TEXT-SAFE`, fall back to default `--txt1` for text.
- Optional: a color within 0.5:1 of `TEXT-SAFE` may be lightened/darkened to hit exactly 4.5:1 — mark it `ADJUSTED` in the preview. Never adjust by more than ±15% lightness.

### Sampling Preview Format

Show this block before generating — wait for user confirmation:

```
Sampled from <url>:
  Colors    #6f00ef [DECORATION-ONLY on dark] · #00cbff [TEXT-SAFE on dark, 10:1]
            #40e8d4 [TEXT-SAFE on dark, 11:1]
  Fonts     Headline: "Sora", sans-serif    Body: "Inter", sans-serif
  Logo      ✓ Light variant found  ✓ Dark variant found
  Voice     Warm and direct. Short sentences, active voice, second
            person. Avoids jargon and hedge words.
  Include logo? (light / dark / both / none) [default: match output mode]
  Proceed? (yes / adjust / skip)
```

---

## Quality Checklist (before saving)

- [ ] AA contrast (4.5:1 text, 3:1 large text / UI) — hard requirement, not a post-hoc check
- [ ] No placeholder text — every element uses real source data
- [ ] Status colors are semantic, not decorative
- [ ] Fixed 1200px width
- [ ] No JS for primary content
- [ ] All CSS in `<style>` block
- [ ] Saved as exactly `{PROJECT-NAME}-BRAINSTORM.html` in the project root — no `-VISUAL`/other suffix

---

## Companion Capabilities

| If the user actually wants… | Use instead |
|---|---|
| A UI wireframe / prototype, not a content visualization | `generate-mockup` skill |

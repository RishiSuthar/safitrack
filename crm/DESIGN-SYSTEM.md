# SafiTrack CRM Design System

Reference for all design tokens, component specs, and patterns.  
Modeled after Attio's visual language: clean, flat, information-dense.

---

## Design Tokens

### Colors (Light)

| Token | Value | Usage |
|---|---|---|
| `--color-primary` | `#2f5fd0` | Primary actions, links, active states |
| `--bg-primary` | `#f8f9fa` | Page background |
| `--bg-secondary` | `#ffffff` | Card/surface background |
| `--bg-tertiary` | `#f1f3f5` | Section backgrounds, zebra rows |
| `--bg-hover` | `rgba(0,0,0,0.03)` | Hover state for items |
| `--bg-active` | `rgba(0,0,0,0.05)` | Active/pressed state |
| `--text-primary` | `#1a1d21` | Headings, body text |
| `--text-secondary` | `#495057` | Secondary labels |
| `--text-muted` | `#868e96` | Meta text, placeholders |
| `--border-color` | `rgba(0,0,0,0.08)` | Default borders |

### Colors (Dark)

| Token | Value |
|---|---|
| `--bg-primary` | `#111318` |
| `--bg-secondary` | `#1a1d24` |
| `--bg-tertiary` | `#22262e` |
| `--bg-hover` | `rgba(255,255,255,0.04)` |
| `--bg-active` | `rgba(255,255,255,0.07)` |
| `--text-primary` | `#e8eaed` |
| `--text-secondary` | `#9ca3af` |
| `--text-muted` | `#6b7280` |

### Typography

| Token | Value | Px | Usage |
|---|---|---|---|
| `--type-xxs` | `0.6875rem` | 11px | Badges, kbd |
| `--type-xs` | `0.75rem` | 12px | Small labels, meta |
| `--type-sm` | `0.8125rem` | 13px | Toolbar buttons, nav items |
| `--type-md` | `0.875rem` | 14px | Default body text |
| `--type-lg` | `1rem` | 16px | Section titles |
| `--type-xl` | `1.125rem` | 18px | Page titles |
| `--type-xxl` | `1.25rem` | 20px | Hero numbers |

Font stack: `'Manrope', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif`

### Spacing (4px grid)

| Token | Value |
|---|---|
| `--space-0` | `0` |
| `--space-1` | `4px` |
| `--space-2` | `8px` |
| `--space-3` | `12px` |
| `--space-4` | `16px` |
| `--space-5` | `20px` |
| `--space-6` | `24px` |
| `--space-7` | `32px` |
| `--space-8` | `40px` |
| `--space-9` | `48px` |

### Border Radius

| Token | Value | Usage |
|---|---|---|
| `--radius-xs` | `4px` | Tags, badges, pills |
| `--radius-sm` | `6px` | Small elements |
| `--radius-md` | `8px` | Cards, dropdowns, inputs |
| `--radius-lg` | `10px` | Large cards, command palette |
| `--radius-xl` | `12px` | Bottom-sheet modals |
| `--radius-full` | `9999px` | Avatars, circular elements |
| `--btn-radius` | `6px` | All buttons, nav items, action items |

### Control Heights

| Token | Value | Usage |
|---|---|---|
| `--control-height-xs` | `28px` | Tags, small badges |
| `--control-height-sm` | `32px` | Nav items, small buttons |
| `--control-height-md` | `36px` | Default buttons, inputs, selects |
| `--control-height-lg` | `40px` | Large buttons |

### Shadows

| Token | Value |
|---|---|
| `--shadow-xs` | `0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-sm` | `0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-md` | `0 2px 8px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04)` |
| `--shadow-lg` | `0 4px 16px rgba(0,0,0,0.08), 0 1px 3px rgba(0,0,0,0.04)` |
| `--shadow-xl` | `0 8px 32px rgba(0,0,0,0.10), 0 2px 6px rgba(0,0,0,0.04)` |

### Transitions

| Token | Value | Usage |
|---|---|---|
| `--transition-fast` | `100ms ease` | Hover states, color changes |
| `--transition-base` | `150ms ease` | Sidebar, menu showing |
| `--transition-medium` | `250ms ease` | Larger animations |

---

## Layout

| Element | Value |
|---|---|
| Header height | `52px` (`--header-height`) |
| Sidebar width | `220px` (`--sidebar-width`) |
| Bottom nav height | `64px` (`--bottom-nav-height`) |
| Desktop breakpoint | `768px` |
| Main content padding | `--space-5` (20px) desktop, `--space-3` (12px) mobile |
| Max modal width | `520px` (desktop), full-width bottom-sheet (mobile) |

---

## Component Specs

### Buttons

- Height: `--control-height-md` (36px)
- Radius: `--btn-radius` (6px)
- Font: `--type-md` (14px), weight 500
- Padding: `0 --space-4` (0 16px)
- **No box-shadow** on any button state
- Hover: background color change only
- Active: `translateY(1px)` only
- Focus-visible: `outline: 2px solid`

Variants:
- `.btn-primary` — `--color-primary` bg, white text
- `.btn-secondary` — transparent bg, `--border-color` border
- `.btn-ghost` — no border, transparent bg
- `.btn-danger` — `--color-danger` bg

### Cards

- Background: `--bg-secondary`
- Border: `1px solid var(--border-color)`
- Radius: `--radius-md` (8px)
- Padding: `--space-4` (16px)
- **No box-shadow**
- Hover: border-color change only (no transform, no shadow)

### Form Inputs

- Height: `--control-height-md` (36px)
- Radius: `--btn-radius` (6px)
- Padding: `0 --space-3`
- Font: `--type-md`
- Border: `1px solid var(--border-color)`
- Focus: `border-color: --color-primary` + `box-shadow: 0 0 0 2px --color-primary-bg`
- Labels: `--type-sm`, `--text-secondary`, weight 600

### Tags / Badges

- Height: `--control-height-xs` (28px)
- Radius: `--radius-xs` (4px) — **not** pill-shaped
- Padding: `0 --space-2`
- Font: `--type-xs` (12px), weight 600

### Nav Items (Sidebar)

- Height: `--control-height-sm` (32px)
- Radius: `--btn-radius` (6px)
- Font: `--type-sm` (13px), weight 500
- Color: `--text-secondary`
- Hover: `--bg-hover`
- Active: `--bg-tertiary`, weight 600, `--text-primary`

### Modals

- Container: `--bg-secondary`, `--radius-xl` (12px), `--shadow-xl`
- Backdrop: `rgba(0,0,0,0.3)`, `blur(2px)`
- Header: flat background (no gradient), `--space-4 --space-5` padding
- Body: `--space-5` padding
- Footer: `--space-3 --space-5` padding, `--space-2` gap
- Mobile: full-width bottom-sheet, `--radius-xl --radius-xl 0 0`

### Dropdowns

- Background: `--bg-secondary`
- Radius: `--radius-md` (8px)
- Shadow: `--shadow-lg`
- Item height: `--control-height-md` (36px)
- Hover: `--bg-hover`
- Transform: `translateY(-4px)` → `translateY(0)` on show

### Toast Notifications

- Background: `--bg-secondary`
- Border: `1px solid var(--border-color)`
- Radius: `--btn-radius` (6px)
- Shadow: `--shadow-md`
- Padding: `--space-3 --space-4`

---

## Design Principles

1. **Flat over decorated** — No gradients on controls. No decorative box-shadows. Color changes only for hover.
2. **Tight radii** — 6px default (buttons, inputs, nav). 8px for cards. 4px for tags. Never > 12px except circles.
3. **Consistent heights** — 28 / 32 / 36 / 40px scale. Everything aligns.
4. **Subtle shadows** — Most elements have no shadow. Only floating elements (dropdowns, modals, toasts) get shadow.
5. **Information density** — 14px base font, 52px header, tight spacing. Every pixel earns its place.
6. **No motion theatrics** — No `scale()` on hover, no `translateY(-2px)` float effects, no bouncy animations. Just `translateY(1px)` on active press.

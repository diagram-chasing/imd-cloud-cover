# Tailwind refactor conventions — imd-meteograms

Convert Svelte component `<style>` CSS into Tailwind v4.1 utility classes in the markup.
The refactor must be **behavior-neutral and pixel-faithful**, with ONE sanctioned exception:
font sizes snap to the default Tailwind type scale (see mapping below).

Tokens live in `src/routes/layout.css` and are ALREADY set up. **Never edit layout.css** —
the orchestrator owns it. Everything you need is listed here.

## Hard rules

1. Do NOT change markup structure, element order, aria-* attributes, event handlers,
   `bind:`, `transition:`/`in:`/`out:` directives, or any `<script>` logic.
2. **No arbitrary values for colors or fonts** in classes. Colors must come from the token
   utilities below (or standard `white` / `transparent` / `current`, incl. opacity forms
   like `bg-white/12`). Font sizes must be default `text-xs…text-9xl` steps. Never write
   `text-[11px]`, `text-[#fff]`, `bg-[#0b1d3a]`, `[font-family:...]`, `text-(--foo)`.
3. Arbitrary values ARE fine for geometry & effects: `w-[min(88vw,340px)]`,
   `p-[clamp(8px,1.4vw,18px)]`, `z-[11]`, `tracking-[0.08em]`, `h-[max(88svh,440px)]`,
   `bg-[url('data:image/svg+xml,…')]`, `[image-rendering:pixelated]`,
   `[shape-rendering:crispEdges]`, `duration-120`, etc. Prefer exact fidelity over
   rounding geometry: 7px gap stays `gap-[7px]` (do NOT snap to `gap-2`). Use the standard
   spacing scale only when it is exact (4px=`1`, 6px=`1.5`, 8px=`2`, 10px=`2.5`, 12px=`3`,
   14px=`3.5`, 16px=`4`, 20px=`5`, 24px=`6`, 32px=`8`, 56px=`14`, 64px=`16`).
4. Delete the `<style>` block once converted. A minimal residual `<style>` is allowed ONLY for:
   - `:global(...)` bridge rules that style a child component's internals,
   - `@keyframes` not covered by the shared animate tokens (Svelte scopes keyframe names —
     never reference a component-local keyframe from a Tailwind class; keep both the
     `@keyframes` and its `animation:` property in the residual style),
   - genuinely inexpressible or unreadable-as-arbitrary values (rare; e.g. gnarly
     multi-shadows) — use your judgment,
   - the PixelMap debug HUD (`.dbg…` rules): leave that whole cluster untouched, it is
     dev-only chrome deliberately styled off-palette in real monospace.
   Residual CSS must reference colors via `var(--color-*)` / `var(--ink)` tokens, never literals.
5. The prose comments in the style blocks are load-bearing documentation. Preserve them:
   move each next to the markup it describes as an HTML comment (condense sensibly).
6. Before dropping/renaming a class, grep the component's script for `querySelector`,
   `classList`, or selector strings using it. Keeping the original semantic class name as
   the first token of a long class list (e.g. `class="streak-dock absolute …"`) is
   encouraged where comments reference it — it's free once the CSS is gone.
7. Colors in JS/TS (canvas `fillStyle`, Pixi hex numbers, d3) are NOT CSS — leave them.
   SVG `<text>` sized in viewBox units is geometry, not typography — if its size was in
   CSS, move it to a `font-size="46"` presentation attribute, don't use `text-*`.

## Color map (CSS literal → utility suffix)

| literal | token utility |
|---|---|
| `#fff` / `#ffffff` | `white`; `rgba(255,255,255,α)` → `white/NN` |
| `#0b1d3a`, `rgba(11,29,58,α)` | `ink`, `ink/NN` — but use `navy`/`navy/NN` where the value must NOT flip when a parent overrides `--ink` (map backdrop, sky text shadows) |
| `rgba(8,24,49,α)` | `night-sky/NN` |
| `#fdfbf4`, `rgba(253,251,244,α)` | `paper`, `paper/NN` |
| `#f2a65a` | `focus` |
| `#f2c14e`, `rgba(242,193,78,α)` | `sun-gold`, `sun-gold/NN` |
| `#d8e8f4` | `cloud-block` (alias `mist-100`) |
| `#e7eef5` | `muted` |
| `#43536e` | `muted-foreground` |
| `#ffd7cf` | `error-tint` |
| `#b8860b` | `record-gold` |
| `#2e7cc4` | `day-sea` |
| `#eef4fb` | `mist-50` |
| `#cfe0f2` | `mist-200` |
| `#cddcec` | `mist-300` |
| `#c5cbd6` | `steel-300` |
| `#b9c2d0` | `steel-400` |
| `#aeb6c4` | `steel-500` |
| `#a4adbe` | `steel-600` |
| `#8a93a6` | `steel-700` |

These work in every color namespace: `bg-ink`, `text-paper`, `border-ink`, `fill-sun-gold`,
`stroke-steel-300`, `outline-focus`, `shadow-ink/30`, `decoration-*`, etc.
Opacity modifiers accept any integer (`/12`, `/18`, `/55`).

## Fonts

- `font-family: var(--font-display)` / `var(--font-pixel)` / `var(--font-body)` → **DELETE**.
  The whole app is Ships Whistle via `html { font-sans }`; these declarations are no-ops.
  Also delete `[font-family:var(--font-display)]` from any existing class strings.
- `'Ships Whistle Rough'` → class `font-rough`.
- Real monospace exists only in the PixelMap debug HUD → stays in residual CSS.

## Type scale (px → default Tailwind step)

| px | class |
|---|---|
| 8, 9, 10, 11, 12, 12.5 | `text-xs` |
| 13, 14 | `text-sm` |
| 15, 16 | `text-base` |
| 17, 18 | `text-lg` |
| 19–21 | `text-xl` |
| 22–25 | `text-2xl` |
| 26–31 | `text-3xl` |
| 32–40 | `text-4xl` |
| 41–52 | `text-5xl` |
| 53–66 | `text-6xl` |
| 67–80 | `text-7xl` |

`clamp(A, …, B)` → map A as base, B under `md:` (e.g. `clamp(42px,8vw,76px)` →
`text-5xl md:text-7xl`; `clamp(17px,2.2vw,20px)` → `text-lg md:text-xl`).

Line-height: `text-*` sets its own leading, so:
- if the original rule declared line-height, map it: 1–1.09 → `leading-none`,
  1.1–1.3 → `leading-tight`, 1.31–1.45 → `leading-snug`, 1.46–1.55 → `leading-normal`,
  1.56–1.85 → `leading-relaxed`, >1.85 → `leading-loose`; `line-height: 1` exactly → `leading-none`.
- if it did NOT and the text can wrap to multiple lines, add `leading-relaxed`
  (matches the inherited body 1.6). Single-line labels: leave the default.

Letter-spacing: `0.025em` → `tracking-wide`, `0.05em` → `tracking-wider`,
`0.1em` → `tracking-widest`, `-0.025em` → `tracking-tight`; anything else keeps the exact
value: `tracking-[0.08em]`, `tracking-[0.06em]`, `tracking-[0.02em]`, `tracking-[0.14em]`.

## Shadows

- `text-shadow: 1px 1px 0 rgba(11,29,58,0.9)` → **`text-shadow-sky`** (shared utility,
  already defined; stays navy even where `--ink` is locally flipped to white).
- Other single shadows: offsets in brackets + color via the color utility form:
  `shadow-[2px_2px_0] shadow-ink/30`, `text-shadow-[1px_1px_0] text-shadow-navy/60`,
  `drop-shadow-[1px_1px_0] drop-shadow-navy/60`.
- Multi-shadows: one arbitrary value with token vars and `color-mix`, e.g.
  `shadow-[0_0_0_2px_white,1px_1px_0_2px_color-mix(in_srgb,var(--color-navy)_90%,transparent)]`.
  If that's unreadable, residual CSS with token vars is acceptable.
- `inset` box shadows: `shadow-[inset_0_0_0_1.5px] shadow-white/45` etc.

## Gradients

Simple 2–3 stop → `bg-linear-to-t from-… via-… to-…` with `from-…%` stop positions.
More stops → arbitrary `bg-[linear-gradient(to_top,…)]` where every color is
`color-mix(in_srgb,var(--color-night-sky)_60%,transparent)`-style token references —
no raw hex/rgba inside.

## Variants

- `@media (max-width: 767px)` → `max-md:` · `(min-width: 768px)` → `md:` ·
  `(min-width: 768px) and (max-width: 1023px)` → `md:max-lg:` (these match exactly).
- `@media (prefers-reduced-motion: reduce)` → `motion-reduce:` (e.g. `motion-reduce:animate-none`).
- Night mode: a custom `night:` variant exists (`.night` on `<html>`), replacing
  `:global(.night) .x { … }` rules → `night:bg-night-sky` etc.
- DROP component `:focus-visible` rules that duplicate the global one in layout.css
  (`outline: 2px solid var(--focus); outline-offset: 2px`) — the global rule already
  applies. Keep only focus-visible styling that differs from it.
- Descendant-modifier pairs like `.legend.horizontal .band {…}` express as conditionals on
  the child: `class={['flex items-center', horizontal ? 'gap-[5px] px-[7px] py-1' : 'gap-2 py-[3px] pr-1.5 pl-1']}`.

## Animations

Shared tokens (in layout.css): `animate-shore-drift` (2.4s steps(1) bg-position tile drift),
`animate-shore-dip` (1.8s ease-in-out, dips 2px at 50%), `animate-bob` (5s ease-in-out
alternate, to translateY(2px)), `animate-balloon-bob` (2.6s ease-in-out alternate,
0→3px). Inline `style="animation-duration/delay: …"` overrides still win — keep them.
Any other keyframe: keep in residual `<style>` (rule 4).

## Svelte idioms

- Conditional classes: Svelte 5 class arrays — `class={['base…', cond && 'extra…']}`.
  Replace `class:on={x}` etc. accordingly. Static strings stay plain `class="…"`.
- Local CSS-var overrides: `--ink: #ffffff` → class `[--ink:var(--color-ink-on-dark)]`.
- `.sr-only` custom rule → Tailwind `sr-only`. `text-wrap: balance/pretty` →
  `text-balance`/`text-pretty`. `scroll-margin-top:16px` → `scroll-mt-4`.
  `touch-action:none` → `touch-none`. `pointer-events` → `pointer-events-none/auto`.
- `transition: opacity .12s, background-color .12s` →
  `transition-[opacity,background-color] duration-120` (map each; `transition-opacity`,
  `transition-colors` when they match).

## Per-file verification (do this before finishing)

1. `pnpm exec svelte-check --tsconfig ./tsconfig.json 2>&1 | grep -A2 <YourFile>` —
   no NEW errors/warnings (especially "Unused CSS selector").
2. `pnpm exec prettier --write <files>` (sorts the class lists).
3. `grep -nE '#[0-9a-fA-F]{3}|rgba?\(|font-family|text-\[[0-9]' <file>` — any hit must be
   JS/canvas code, the debug HUD, or a token-var-only residual rule.
4. Do NOT run the dev server or take screenshots — the orchestrator does visual checks.

Report back: files done, plus a list of any spot where exact fidelity wasn't possible and why.

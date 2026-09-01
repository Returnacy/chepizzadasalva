/**
 * Per-brand colour, derived from one token.
 *
 * A brand states ONE value, `VITE_BRAND_PRIMARY` (`#RRGGBB`). Everything else is
 * computed from it:
 *
 *   --brand-blue / --primary          the primary itself
 *   --brand-dark / --secondary        primary, 28 points of lightness darker
 *   --brand-surface-from / -to        the page-background gradient
 *   --brand-tint, --brand-tint-border info panels, icon circles, their borders
 *   --brand-accent, -strong, --ink    links, small icons, text on the tints
 *
 * `VITE_BRAND_PRIMARY_DARK` overrides the second one when the client's brand
 * book already names both.
 *
 * Applied at runtime from main.tsx, like the document title, rather than
 * compiled into the CSS: one built bundle serves every brand and the Cloudflare
 * project's env is the only thing that differs. Unset or malformed means this
 * file touches nothing — index.css holds Che Pizza's palette, and the live site
 * must not depend on an env var existing.
 *
 * Still deliberately NOT parameterised, and this is the line: the neutral scale,
 * the cream ground (`--brand-cream`), the destructive red, the categorical chart
 * palette, and the blue/green/yellow/red colour SETS that carry meaning — role
 * badges, campaign channels, the three feature icons on the auth hero, CRM
 * filter chips. Recolouring one member of a set to the brand hue destroys the
 * set. Those stay Tailwind's stock colours for every client, on purpose.
 */

const ENV: any = (import.meta as any).env || {};

/** How much lightness `--brand-dark` loses relative to the primary. Che Pizza's
 *  own pair (#5C8EC7 → #27496D) is 57% → 29%, i.e. 28 points. */
const DARK_SHIFT = 28;

/**
 * The hue drift Tailwind's own ramp has from its palest to its darkest step
 * (blue-50 214°, indigo-100 226°, blue-600 221°, blue-800 226°). The tints being
 * replaced were picked off that ramp, so the derived ones copy its shape rather
 * than sitting flat on a single hue.
 */
const SURFACE_TO_HUE_SHIFT = 12;
const ACCENT_HUE_SHIFT = 7;
const INK_HUE_SHIFT = 12;

/**
 * Minimum contrast against white for anything carrying text or a thin glyph.
 *
 * The three targets are deliberately spaced. With one shared target the warm
 * hues collapse: an orange accent and accent-strong both get darkened until
 * they touch 4.5:1 and land on the SAME hex, so the two link tiers stop being
 * two tiers. Cool hues never hit the floor and keep their natural separation.
 */
const ACCENT_MIN_CONTRAST = 4.5;
const ACCENT_STRONG_MIN_CONTRAST = 5.5;
const INK_MIN_CONTRAST = 7;

type Hsl = { h: number; s: number; l: number };
type Rgb = { r: number; g: number; b: number };

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

function parseHex(value: unknown): Rgb | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function toHsl({ r, g, b }: Rgb): Hsl {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;
  const d = max - min;

  if (d === 0) return { h: 0, s: 0, l: l * 100 };

  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h: number;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  return { h: h * 360, s: s * 100, l: l * 100 };
}

function toRgb({ h, s, l }: Hsl): Rgb {
  const hn = (((h % 360) + 360) % 360) / 360;
  const sn = clamp(s, 0, 100) / 100;
  const ln = clamp(l, 0, 100) / 100;
  if (sn === 0) {
    const v = Math.round(ln * 255);
    return { r: v, g: v, b: v };
  }
  const q = ln < 0.5 ? ln * (1 + sn) : ln + sn - ln * sn;
  const p = 2 * ln - q;
  const channel = (t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  return {
    r: Math.round(channel(hn + 1 / 3) * 255),
    g: Math.round(channel(hn) * 255),
    b: Math.round(channel(hn - 1 / 3) * 255),
  };
}

/** The `H S% L%` triplet index.css stores, so `hsl(var(--x))` keeps working. */
function toVar({ h, s, l }: Hsl): string {
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}

/** The tint variables hold plain hex, so a Tailwind arbitrary value can read
 *  them directly as a colour. (Written without an example class on purpose:
 *  Tailwind scans this file and would emit a utility for one found in a comment.) */
function toHex(hsl: Hsl): string {
  const { r, g, b } = toRgb(hsl);
  return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}

/** Never below 12%: `--brand-dark` carries white text (the loyalty card, the
 *  active tab), and a shade darker than that stops reading as a colour. */
function darken({ h, s, l }: Hsl): Hsl {
  return { h, s, l: Math.max(12, l - DARK_SHIFT) };
}

function relativeLuminance({ r, g, b }: Rgb): number {
  const channel = (v: number): number => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrastAgainstWhite(hsl: Hsl): number {
  return 1.05 / (relativeLuminance(toRgb(hsl)) + 0.05);
}

/**
 * Darken until the colour is legible on white.
 *
 * This is the part a naive "keep the hue, copy Tailwind's lightness ladder"
 * derivation gets wrong, and it gets it wrong in the direction that matters
 * here. Tailwind's blue-600 sits at 53% lightness and clears 4.5:1 because blue
 * is a dark-appearing hue; the same 53% at an orange or yellow hue lands near
 * 2.5:1 — a link nobody with average eyesight can read. Warm brands therefore
 * get a visibly deeper accent than cool ones. That is the correct answer, not a
 * bug: the target is legibility, not a matching lightness number.
 */
function darkenUntilLegible(hsl: Hsl, minContrast: number): Hsl {
  let candidate = hsl;
  while (candidate.l > 15 && contrastAgainstWhite(candidate) < minContrast) {
    candidate = { ...candidate, l: candidate.l - 1 };
  }
  return candidate;
}

/**
 * Override the brand colour variables for this build's brand.
 *
 * A no-op when `VITE_BRAND_PRIMARY` is unset or malformed: this repo is Che
 * Pizza's deployment, so the values already in index.css are the right answer
 * and the live site must not depend on an env var being present.
 */
export function applyBrandTheme(root: HTMLElement = document.documentElement): void {
  const primaryRgb = parseHex(ENV.VITE_BRAND_PRIMARY);
  if (!primaryRgb) return;

  const primary = toHsl(primaryRgb);
  const darkRgb = parseHex(ENV.VITE_BRAND_PRIMARY_DARK);
  const dark = darkRgb ? toHsl(darkRgb) : darken(primary);

  root.style.setProperty('--brand-blue', toVar(primary));
  root.style.setProperty('--brand-dark', toVar(dark));
  // The shadcn semantic pair follows the brand pair: index.css already defines
  // them as the same two colours.
  root.style.setProperty('--primary', toVar(primary));
  root.style.setProperty('--secondary', toVar(dark));

  const { h, s } = primary;

  // Pale steps need MORE saturation than the primary, not the same: at 93–97%
  // lightness a muted primary's own saturation washes out to plain grey, and a
  // grey page background is not a brand — it is a bug that looks deliberate.
  const tintSat = clamp(s * 1.4, 45, 100);
  // Mid and dark steps stay near the primary's saturation so the accent still
  // reads as the same colour family, only deeper.
  const accentSat = clamp(s * 1.2, 45, 95);

  const surfaceFrom: Hsl = { h, s: tintSat, l: 97 };
  const surfaceTo: Hsl = { h: h + SURFACE_TO_HUE_SHIFT, s: tintSat, l: 94 };
  const tint: Hsl = { h, s: tintSat, l: 93 };
  const tintBorder: Hsl = { h, s: tintSat, l: 87 };

  const accent = darkenUntilLegible(
    { h: h + ACCENT_HUE_SHIFT, s: accentSat, l: 53 },
    ACCENT_MIN_CONTRAST,
  );
  const accentStrong = darkenUntilLegible(
    { h: h + ACCENT_HUE_SHIFT, s: accentSat, l: 48 },
    ACCENT_STRONG_MIN_CONTRAST,
  );
  const ink = darkenUntilLegible(
    { h: h + INK_HUE_SHIFT, s: clamp(s * 1.1, 40, 85), l: 40 },
    INK_MIN_CONTRAST,
  );

  root.style.setProperty('--brand-surface-from', toHex(surfaceFrom));
  root.style.setProperty('--brand-surface-to', toHex(surfaceTo));
  root.style.setProperty('--brand-tint', toHex(tint));
  root.style.setProperty('--brand-tint-border', toHex(tintBorder));
  root.style.setProperty('--brand-accent', toHex(accent));
  root.style.setProperty('--brand-accent-strong', toHex(accentStrong));
  root.style.setProperty('--brand-ink', toHex(ink));
}

/**
 * Per-brand colour — one token, not a theming engine.
 *
 * The SPA has exactly one colour that is anybody's brand: the blue that
 * index.css calls `--brand-blue`, plus the darker shade `--brand-dark` used for
 * hovers, the loyalty-card gradient and the active tab. Everything else stays
 * identical for every client on purpose: `--brand-cream` is the paper the app is
 * printed on, `--brand-red` is the destructive colour, the chart palette is
 * categorical, and the neutral scale is shadcn's. Letting a client pick those
 * buys nothing and costs a broken layout.
 *
 * So a brand states ONE value, `VITE_BRAND_PRIMARY` (`#RRGGBB`), and the dark
 * shade is derived from it. `VITE_BRAND_PRIMARY_DARK` overrides the derivation
 * when the client's brand book already names both.
 *
 * Applied at runtime from main.tsx, like the document title, rather than
 * compiled into the CSS: one built bundle then serves every brand, and the
 * Cloudflare project's env is the only thing that differs.
 *
 * KNOWN LIMIT — read before promising a client "your colours". Roughly sixty
 * call sites still use Tailwind's stock `blue-*`/`indigo-*` (the page gradient
 * `from-blue-50 to-indigo-100`, info tints, legal-page links). They were written
 * to match Che Pizza's blue and they do NOT follow this token. A brand whose
 * primary is far from blue gets its own buttons and cards on a faintly blue
 * page. Routing those through a token means touching every one of them, which
 * is a bigger, riskier change than this one — and a decision to take with
 * Enrico, not silently.
 */

const ENV: any = (import.meta as any).env || {};

/** How much lightness `--brand-dark` loses relative to the primary. Che Pizza's
 *  own pair (#5C8EC7 → #27496D) is 57% → 29%, i.e. 28 points. */
const DARK_SHIFT = 28;

type Hsl = { h: number; s: number; l: number };

function parseHex(value: unknown): { r: number; g: number; b: number } | null {
  if (typeof value !== 'string') return null;
  const match = /^#?([0-9a-f]{6})$/i.exec(value.trim());
  if (!match) return null;
  const int = parseInt(match[1], 16);
  return { r: (int >> 16) & 255, g: (int >> 8) & 255, b: int & 255 };
}

function toHsl({ r, g, b }: { r: number; g: number; b: number }): Hsl {
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

/** The `H S% L%` triplet index.css stores, so `hsl(var(--x))` keeps working. */
function toVar({ h, s, l }: Hsl): string {
  return `${round(h)} ${round(s)}% ${round(l)}%`;
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Never below 12%: `--brand-dark` carries white text (the loyalty card, the
 *  active tab), and a shade darker than that stops reading as a colour. */
function darken({ h, s, l }: Hsl): Hsl {
  return { h, s, l: Math.max(12, l - DARK_SHIFT) };
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
}

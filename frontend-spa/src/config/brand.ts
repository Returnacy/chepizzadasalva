/**
 * Per-brand configuration for the customer SPA.
 *
 * One Cloudflare Pages project per brand, same code, different build-time env.
 * Everything a client sees that is not their loyalty data belongs here, so
 * standing up a new brand never means editing a component.
 *
 * The defaults are Che Pizza's, deliberately: this repo IS Che Pizza's
 * deployment, and a missing var must not blank the live site. A new brand
 * therefore has to set every value — `pnpm check:brand` fails the build if the
 * legal pages still contain placeholders.
 */
const ENV: any = (import.meta as any).env || {};

function str(name: string, fallback: string): string {
  const value = ENV[name];
  return typeof value === 'string' && value.trim().length > 0 ? value.trim() : fallback;
}

export const BRAND = {
  /** Short display name, used in the nav bar and page headings. */
  name: str('VITE_BRAND_NAME', 'Che Pizza'),
  /** Longer name for hero/auth screens; falls back to the short one. */
  fullName: str('VITE_BRAND_FULL_NAME', str('VITE_BRAND_NAME', 'Che Pizza da Salva')),
  /** Registered company name, for the legal pages. */
  legalName: str('VITE_BRAND_LEGAL_NAME', 'Che Pizza! Di Stella Salvatore'),
  /** Registered office, for the legal pages. */
  legalAddress: str('VITE_BRAND_LEGAL_ADDRESS', 'via Firenze 25, 35010 Villafranca Padovana (PD)'),
  /** Contact address shown to customers for privacy/ToS requests. */
  contactEmail: str('VITE_BRAND_CONTACT_EMAIL', 'salvatore@chepizzadasalva.it'),
  /** Codice fiscale of the company running the programme (legal pages). */
  legalTaxCode: str('VITE_BRAND_LEGAL_TAX_CODE', 'STLSVT02M20G224Y'),
  /** Partita IVA of the company running the programme (legal pages). */
  legalVat: str('VITE_BRAND_LEGAL_VAT', '05639230282'),
  /** Optional absolute URL for the loyalty logo; empty → bundled default. */
  logoUrl: str('VITE_BRAND_LOGO_URL', ''),
  /** Browser tab title. */
  documentTitle: str('VITE_BRAND_DOCUMENT_TITLE', str('VITE_BRAND_NAME', 'Che Pizza') + ' — Fidelity'),
} as const;

/** PizzeriaManager instance for THIS client (chiusura / inventario handoff). */
export const PM_URL: string = str('VITE_PM_URL', 'https://statistich3.chepizzadasalva.it').replace(/\/$/, '');

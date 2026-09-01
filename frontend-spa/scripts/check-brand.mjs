#!/usr/bin/env node
/**
 * Build-time guard on per-brand configuration.
 *
 * Three failure modes it exists to prevent:
 *
 *  1. Shipping a client's site with placeholders still in it
 *     ({{RAGIONE_SOCIALE}}, TODO, XXX). Legal text must come from the client;
 *     it is never invented, and it must never reach a customer half-filled.
 *
 *  2. Shipping a client's site with ANOTHER client's legal identity. The
 *     defaults in src/config/brand.ts are Che Pizza's, because this repo is
 *     Che Pizza's deployment — which means a new brand that sets only
 *     VITE_BRAND_NAME would silently publish Che Pizza's company name, VAT
 *     number and privacy contact under its own logo. That is the dangerous
 *     case, and it is the one this check is really for.
 *
 *  3. Shipping a client's site still wearing Che Pizza's face or pointing at
 *     Che Pizza's data: the bundled Che Pizza logo (the fallback when
 *     VITE_BRAND_LOGO_URL is empty), Che Pizza's blue (the fallback when
 *     VITE_BRAND_PRIMARY is unset), a chepizzadasalva.it host, or Che Pizza's
 *     brand/business ids — servicesHttp.ts falls back to the Taggi businessId,
 *     so an unset VITE_BUSINESS_ID makes a client's SPA read Che Pizza's
 *     counter.
 *
 * Runs as `prebuild`, so `pnpm build` cannot skip it. Cloudflare Pages passes
 * its project env into the build, so the same check runs there.
 */

const PLACEHOLDER = /\{\{|\}\}|TODO|CHANGEME|XXX|LOREM/i;
const HEX_COLOUR = /^#[0-9a-fA-F]{6}$/;

// Che Pizza's values, duplicated here on purpose: this file has to notice when
// a *different* brand is still carrying them.
const CHE_PIZZA_DEFAULTS = {
  VITE_BRAND_NAME: 'Che Pizza',
  VITE_BRAND_LEGAL_NAME: 'Che Pizza! Di Stella Salvatore',
  VITE_BRAND_LEGAL_ADDRESS: 'via Firenze 25, 35010 Villafranca Padovana (PD)',
  VITE_BRAND_CONTACT_EMAIL: 'salvatore@chepizzadasalva.it',
  VITE_BRAND_LEGAL_TAX_CODE: 'STLSVT02M20G224Y',
  VITE_BRAND_LEGAL_VAT: '05639230282',
  VITE_BRAND_PRIMARY: '#5C8EC7',
};

// Anything of Che Pizza's that can travel inside a *different* variable than
// the one it belongs to: a copied PM URL, a backend host, an id left in place.
// Substring match, case-insensitive, over every VITE_* of a non-Che-Pizza build.
const CHE_PIZZA_MARKERS = [
  ['chepizzadasalva', 'a Che Pizza host/address'],
  ['385d4ebb-4c4b-46e9-8701-0d71bfd7ce47', "Che Pizza's brandId"],
  ['af941888-ec4c-458e-b905-21673241af3e', "Che Pizza's Taggi businessId"],
  ['f103ce67-ad79-4bf6-99ca-1d632caf7786', "Che Pizza's Lissaro businessId"],
];

// Everything a brand other than Che Pizza must state for itself.
const REQUIRED_FOR_NEW_BRAND = [
  'VITE_BRAND_NAME',
  'VITE_BRAND_LEGAL_NAME',
  'VITE_BRAND_LEGAL_ADDRESS',
  'VITE_BRAND_CONTACT_EMAIL',
  'VITE_BRAND_LEGAL_TAX_CODE',
  'VITE_BRAND_LEGAL_VAT',
  // Without these two the client's site wears Che Pizza's logo and Che Pizza's
  // blue: both fall back silently, neither is visible in a diff of the env.
  'VITE_BRAND_LOGO_URL',
  'VITE_BRAND_PRIMARY',
  'VITE_BUSINESS_ID',
  'VITE_USER_SERVICE_URL',
  'VITE_BUSINESS_SERVICE_URL',
  'VITE_PM_URL',
];

const env = process.env;
const errors = [];

// 1. No placeholders anywhere in the brand config.
for (const [key, value] of Object.entries(env)) {
  if (!key.startsWith('VITE_')) continue;
  if (typeof value === 'string' && PLACEHOLDER.test(value)) {
    errors.push(`${key} still contains a placeholder: "${value}"`);
  }
}

// 2. Colours, for any brand: a malformed hex is not a build error in the app —
// applyBrandTheme just ignores it — so the site would come up in Che Pizza's
// blue without a word. Fail here instead.
for (const key of ['VITE_BRAND_PRIMARY', 'VITE_BRAND_PRIMARY_DARK']) {
  const value = (env[key] ?? '').trim();
  if (value !== '' && !HEX_COLOUR.test(value)) {
    errors.push(`${key} must be a #RRGGBB hex colour, got "${value}"`);
  }
}

// 3. If this is not Che Pizza's build, nothing may fall back to Che Pizza's.
const brandName = (env.VITE_BRAND_NAME ?? '').trim();
const isChePizza = brandName === '' || brandName === CHE_PIZZA_DEFAULTS.VITE_BRAND_NAME;

if (!isChePizza) {
  for (const key of REQUIRED_FOR_NEW_BRAND) {
    const value = (env[key] ?? '').trim();
    if (value === '') {
      errors.push(`${key} is required for brand "${brandName}" (would fall back to Che Pizza's value)`);
      continue;
    }
    const inherited = CHE_PIZZA_DEFAULTS[key];
    if (inherited && value.toLowerCase() === inherited.toLowerCase()) {
      errors.push(`${key} is still Che Pizza's value ("${value}") while building brand "${brandName}"`);
    }
  }

  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('VITE_') || typeof value !== 'string') continue;
    const haystack = value.toLowerCase();
    for (const [marker, what] of CHE_PIZZA_MARKERS) {
      if (haystack.includes(marker)) {
        errors.push(`${key} still carries ${what} ("${value}") while building brand "${brandName}"`);
      }
    }
  }
}

if (errors.length > 0) {
  console.error('\n✖ Brand configuration check failed:\n');
  for (const e of errors) console.error(`   - ${e}`);
  console.error('\n  See PROVISION-BRAND.md → "SPA per brand".');
  console.error('  Legal text (company name, address, VAT, contact) must be supplied by the client.\n');
  process.exit(1);
}

console.log(`✔ Brand configuration OK (${isChePizza ? 'Che Pizza (defaults)' : brandName})`);

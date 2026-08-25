#!/usr/bin/env node
/**
 * Build-time guard on per-brand configuration.
 *
 * Two failure modes it exists to prevent:
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
 * Runs as `prebuild`, so `pnpm build` cannot skip it. Cloudflare Pages passes
 * its project env into the build, so the same check runs there.
 */

const PLACEHOLDER = /\{\{|\}\}|TODO|CHANGEME|XXX|LOREM/i;

// Che Pizza's values, duplicated here on purpose: this file has to notice when
// a *different* brand is still carrying them.
const CHE_PIZZA_DEFAULTS = {
  VITE_BRAND_NAME: 'Che Pizza',
  VITE_BRAND_LEGAL_NAME: 'Che Pizza! Di Stella Salvatore',
  VITE_BRAND_CONTACT_EMAIL: 'salvatore@chepizzadasalva.it',
  VITE_BRAND_LEGAL_TAX_CODE: 'STLSVT02M20G224Y',
  VITE_BRAND_LEGAL_VAT: '05639230282',
};

// Everything a brand other than Che Pizza must state for itself.
const REQUIRED_FOR_NEW_BRAND = [
  'VITE_BRAND_NAME',
  'VITE_BRAND_LEGAL_NAME',
  'VITE_BRAND_LEGAL_ADDRESS',
  'VITE_BRAND_CONTACT_EMAIL',
  'VITE_BRAND_LEGAL_TAX_CODE',
  'VITE_BRAND_LEGAL_VAT',
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

// 2. If this is not Che Pizza's build, nothing may fall back to Che Pizza's.
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
    if (inherited && value === inherited) {
      errors.push(`${key} is still Che Pizza's value ("${value}") while building brand "${brandName}"`);
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

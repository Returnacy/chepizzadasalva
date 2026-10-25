// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const SCRIPT = fileURLToPath(new URL('./check-brand.mjs', import.meta.url));

// Same format as PizzeriaOS/clients/<slug>/pages.env (one var per line, every
// value double-quoted). Invented brand: no client's data lives in this repo.
const BRAND_PAGES_ENV = `
VITE_BRAND_NAME="Pizzeria Prova"
VITE_BRAND_FULL_NAME="Pizzeria Prova"
VITE_BRAND_DOCUMENT_TITLE="Pizzeria Prova — Fidelity"
VITE_BRAND_LOGO_URL="https://prova.example.com/assets/logo.webp"
VITE_BRAND_PRIMARY="#4E6497"
VITE_BRAND_LEGAL_NAME="Prova di Mario Rossi"
VITE_BRAND_LEGAL_ADDRESS="Via Roma 1, 35100 Padova (PD)"
VITE_BRAND_LEGAL_TAX_CODE="RSSMRA80A01G224K"
VITE_BRAND_LEGAL_VAT="01234567890"
VITE_BRAND_CONTACT_EMAIL="privacy@prova.example.com"
VITE_BRAND_ID="11111111-2222-4333-8444-555555555555"
VITE_BUSINESS_ID="66666666-7777-4888-9999-000000000000"
VITE_USER_SERVICE_URL="https://user.returnacy.app"
VITE_BUSINESS_SERVICE_URL="https://prova.business.returnacy.app"
VITE_PM_URL="https://pizzeriamanager-prova-production.up.railway.app"
VITE_FRONTEND_BASE_URL="https://prova.returnacy.app"
`;

function parsePagesEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split('\n')) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m) out[m[1]] = m[2].replace(/^(["'])(.*)\1$/, '$2');
  }
  return out;
}

const BRAND = parsePagesEnv(BRAND_PAGES_ENV);

// Clean env: nothing VITE_* / CF_* inherited from the shell running the tests.
function run(env: Record<string, string>) {
  const r = spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH ?? '', ...env }, encoding: 'utf8' });
  return { status: r.status, out: r.stdout + r.stderr };
}

const cf = (url: string, branch: string) => ({ CF_PAGES: '1', CF_PAGES_URL: url, CF_PAGES_BRANCH: branch });

describe('check-brand.mjs', () => {
  it('local build, no env: Che Pizza defaults pass', () => {
    const r = run({});
    expect(r.status).toBe(0);
    expect(r.out).toContain('Che Pizza (defaults)');
  });

  it('local build, complete brand env: passes', () => {
    const r = run(BRAND);
    expect(r.status).toBe(0);
    expect(r.out).toContain('(Pizzeria Prova)');
  });

  it('local build, brand env without VITE_BRAND_ID: fails naming it', () => {
    const { VITE_BRAND_ID: _omit, ...rest } = BRAND;
    const r = run(rest);
    expect(r.status).toBe(1);
    expect(r.out).toContain('VITE_BRAND_ID');
  });

  it('client project preview, no brand env: fails with project, branch, Preview and the remedy', () => {
    const r = run(cf('https://feat-x.returnacy-sudest.pages.dev', 'feat/x'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('returnacy-sudest');
    expect(r.out).toContain('feat/x');
    expect(r.out).toContain('Preview');
    expect(r.out).toContain('pages.env');
  });

  it('client project production, no brand env: fails and says Production', () => {
    const r = run(cf('https://returnacy-sudest.pages.dev', 'main'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('"returnacy-sudest"');
    expect(r.out).toContain('Production deployment');
  });

  it('client project, hash deployment URL, no brand env: project still parsed, fails', () => {
    const r = run(cf('https://3f2a9c1b.returnacy-quieora.pages.dev', 'main'));
    expect(r.status).toBe(1);
    expect(r.out).toContain('"returnacy-quieora"');
  });

  it('client project with the complete brand env: passes', () => {
    const r = run({ ...BRAND, ...cf('https://feat-x.returnacy-sudest.pages.dev', 'feat/x') });
    expect(r.status).toBe(0);
    expect(r.out).toContain('(Pizzeria Prova)');
  });

  it("Che Pizza's project, no env: passes on defaults", () => {
    const r = run(cf('https://feat-x.che-pizza-da-salva.pages.dev', 'feat/x'));
    expect(r.status).toBe(0);
    expect(r.out).toContain('Che Pizza (defaults)');
  });

  it("Che Pizza's project carrying a client's brand: fails", () => {
    const r = run({ ...BRAND, ...cf('https://che-pizza-da-salva.pages.dev', 'main') });
    expect(r.status).toBe(1);
    expect(r.out).toContain('is Che Pizza\'s, but VITE_BRAND_NAME is "Pizzeria Prova"');
  });

  it('CF_PAGES set but no usable CF_PAGES_URL: fails closed', () => {
    const r = run({ CF_PAGES: '1' });
    expect(r.status).toBe(1);
    expect(r.out).toContain('not a *.pages.dev URL');
  });

  // The real file a client's Pages project imports, when this machine has it.
  const SUDEST = '/Volumes/manzDisk/ManzDisk_Coding/PizzeriaOS/clients/sudest/pages.env';
  it.skipIf(!existsSync(SUDEST))('Sud Est pages.env passes locally and on returnacy-sudest', () => {
    const sudest = parsePagesEnv(readFileSync(SUDEST, 'utf8'));
    expect(run(sudest).status).toBe(0);
    const r = run({ ...sudest, ...cf('https://feat-x.returnacy-sudest.pages.dev', 'feat/x') });
    expect(r.status).toBe(0);
    expect(r.out).toContain('(Pizzeria Sud Est)');
  });
});

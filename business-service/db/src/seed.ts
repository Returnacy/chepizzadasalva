/**
 * Provisioning seed for a business-service deployment.
 *
 * There was no seed for this service at all, which is why standing up a brand
 * meant hand-writing INSERTs against a live database (see
 * MULTI_LOCATION_ROLLOUT.md, where Lissaro was created exactly that way).
 *
 * Everything is parameterised — no Che Pizza id appears in this file — and
 * every write is an upsert, so re-running it is safe and it can be used to
 * add a second location to an existing brand.
 *
 * Run:
 *   ALLOW_SEED=true DATABASE_URL=... \
 *   BRAND_ID=... BRAND_NAME=... BRAND_EMAIL=... BRAND_PHONE=... BRAND_ADDRESS=... \
 *   BUSINESS_ID=... BUSINESS_NAME=... BUSINESS_ADDRESS=... \
 *   PRIZES='[{"name":"Pizza omaggio","pointsRequired":15}]' \
 *   pnpm --filter @business-service/db seed
 *
 * See PROVISION-BRAND.md for the full runbook.
 */
import { prisma } from './prismaClient.js';

// This workspace deliberately ships without @types/node (see
// repository.prisma.ts, which reads env the same way), so reach the runtime
// globals through globalThis rather than adding a dependency for a script.
const env = ((globalThis as any)?.process?.env ?? {}) as Record<string, string | undefined>;
const log: { log: (...a: any[]) => void; warn: (...a: any[]) => void; error: (...a: any[]) => void } =
  (globalThis as any).console;
const exit = (code: number) => (globalThis as any)?.process?.exit?.(code);

type PrizeInput = { name: string; pointsRequired: number; isPromotional?: boolean };

function required(name: string): string {
  const value = env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var ${name} (see PROVISION-BRAND.md)`);
  }
  return value.trim();
}

function optional(name: string, fallback: string): string {
  const value = env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function parsePrizes(): PrizeInput[] {
  const raw = env.PRIZES;
  if (!raw || raw.trim().length === 0) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error('PRIZES is not valid JSON (expected [{"name":"...","pointsRequired":15}])');
  }
  if (!Array.isArray(parsed)) throw new Error('PRIZES must be a JSON array');
  return parsed.map((item: any, index: number) => {
    const name = typeof item?.name === 'string' ? item.name.trim() : '';
    const points = Number(item?.pointsRequired);
    if (!name) throw new Error(`PRIZES[${index}].name is required`);
    if (!Number.isInteger(points) || points <= 0) {
      throw new Error(`PRIZES[${index}].pointsRequired must be a positive integer`);
    }
    return { name, pointsRequired: points, isPromotional: item?.isPromotional === true };
  });
}

async function main() {
  if (env.ALLOW_SEED !== 'true') {
    log.log('[business-service][db] Seed disabled (set ALLOW_SEED=true to enable)');
    return;
  }

  const brandId = required('BRAND_ID');
  const businessId = required('BUSINESS_ID');
  const brandName = required('BRAND_NAME');
  const businessName = optional('BUSINESS_NAME', brandName);

  // Brand.email and Brand.phone are UNIQUE in the schema, so two brands in the
  // same database cannot share them. Locations legitimately can (Business has
  // no unique constraint on either) — sibling pizzerias share a phone number.
  const brandEmail = required('BRAND_EMAIL');
  const brandPhone = required('BRAND_PHONE');
  const brandAddress = optional('BRAND_ADDRESS', 'N/A');
  const businessEmail = optional('BUSINESS_EMAIL', brandEmail);
  const businessPhone = optional('BUSINESS_PHONE', brandPhone);
  const businessAddress = optional('BUSINESS_ADDRESS', brandAddress);

  // LOCATION is the franchise-safe default: each location keeps its own wallet.
  // BRAND is the family-owned, shared-wallet case (Che Pizza). Getting this
  // wrong is visible to customers, so it is explicit rather than inferred.
  const walletScopeRaw = optional('BRAND_WALLET_SCOPE', 'LOCATION').toUpperCase();
  if (walletScopeRaw !== 'LOCATION' && walletScopeRaw !== 'BRAND') {
    throw new Error(`BRAND_WALLET_SCOPE must be LOCATION or BRAND (got "${walletScopeRaw}")`);
  }
  const walletScope = walletScopeRaw as 'LOCATION' | 'BRAND';

  const prizes = parsePrizes();

  log.log(`[business-service][db] Seeding brand ${brandName} (${brandId}), wallet scope ${walletScope}`);

  const brand = await prisma.brand.upsert({
    where: { id: brandId },
    update: { name: brandName, address: brandAddress, walletScope },
    create: {
      id: brandId,
      name: brandName,
      email: brandEmail,
      phone: brandPhone,
      address: brandAddress,
      walletScope,
    },
  });
  log.log(`  - Brand ${brand.id} (${brand.name})`);

  const business = await prisma.business.upsert({
    where: { id: businessId },
    update: { name: businessName, address: businessAddress, brandId: brand.id },
    create: {
      id: businessId,
      brandId: brand.id,
      name: businessName,
      email: businessEmail,
      phone: businessPhone,
      address: businessAddress,
    },
  });
  log.log(`  - Business ${business.id} (${business.name})`);

  // Prizes have no natural unique key, so match on (brandId, businessId, name)
  // to stay idempotent instead of stacking duplicates on every run.
  for (const prize of prizes) {
    const existing = await prisma.prize.findFirst({
      where: { brandId: brand.id, businessId: business.id, name: prize.name },
    });
    if (existing) {
      await prisma.prize.update({
        where: { id: existing.id },
        data: { pointsRequired: prize.pointsRequired, isPromotional: prize.isPromotional ?? false },
      });
      log.log(`  - Prize "${prize.name}" updated (${prize.pointsRequired} stamps)`);
    } else {
      await prisma.prize.create({
        data: {
          // Prize.id has @default(uuid()) — let the DB mint it.
          brandId: brand.id,
          businessId: business.id,
          name: prize.name,
          pointsRequired: prize.pointsRequired,
          isPromotional: prize.isPromotional ?? false,
        },
      });
      log.log(`  - Prize "${prize.name}" created (${prize.pointsRequired} stamps)`);
    }
  }

  if (prizes.length === 0) {
    log.warn('  ! No PRIZES provided: the loyalty card will have no reward to progress toward.');
  }

  log.log('[business-service][db] Seed complete.');
  log.log(`  Set DEFAULT_BRAND_ID=${brand.id} and DEFAULT_BUSINESS_ID=${business.id} on the service.`);
}

main()
  .catch((e) => { log.error(e); exit(1); })
  .finally(async () => { await prisma.$disconnect(); });

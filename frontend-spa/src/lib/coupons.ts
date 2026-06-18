// Single source of truth for "is this coupon usable right now?" — a coupon is
// active only if it's neither redeemed nor expired. Staff scanner and the
// customer UI must agree on this, otherwise staff can surface (and redeem) a
// coupon the customer can't even see. Keep both callers on this helper.
export function isCouponActive(c: any, now: number = Date.now()): boolean {
  if (!c) return false;
  if (c.isRedeemed) return false;
  const exp = c.expiredAt ? new Date(c.expiredAt).getTime() : null;
  if (exp !== null && exp <= now) return false;
  return true;
}

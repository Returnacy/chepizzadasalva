import { businessHttp } from '../lib/servicesHttp';

// ---- Types ----
export interface AnalyticsEnvelope<T> { message: string; data: T }
export interface CoreAnalyticsDTO {
  totalUsers: number;
  returnacyRate: number; // percentage
  totalCouponsRedeemed: number;
  weekTotalCouponsRedeemed: number;
  weekTotalStamps: number;
  weekNewUsers: number;
  monthTotalStamps: number;
  monthTotalCouponsRedeemed: number;
  averageUserFrequency: number;
  subscriptionPrice?: number;
}

export interface DailyTransactionsDTO { dailyTransactions: number[]; dailyStamps: number[] }

// ---- Mappers ----
export interface OverviewMetrics {
  totalUsers: number;
  couponsRedeemed: number;
  averageNPS: number; // placeholder until backend supports
  totalFeedback: number; // placeholder
  weeklyStamps: number;
  weeklyNewUsers: number;
}

export interface RepeatRateMetrics { repeatRate: number; totalUsers: number; returningUsers: number }
export interface FrequencyMetrics { averageFrequency: number; totalCustomers: number }
export interface EconomicMetrics { totalStamps: number; totalCouponsRedeemed: number }

export function toOverview(dto: CoreAnalyticsDTO): OverviewMetrics {
  return {
    totalUsers: dto.totalUsers || 0,
    couponsRedeemed: dto.totalCouponsRedeemed || 0,
    averageNPS: 0,
    totalFeedback: 0,
    weeklyStamps: dto.weekTotalStamps || 0,
    weeklyNewUsers: dto.weekNewUsers || 0,
  };
}

export function toRepeatRate(dto: CoreAnalyticsDTO): RepeatRateMetrics {
  const returning = dto.totalUsers ? Math.round((dto.returnacyRate || 0) * 100 / dto.totalUsers) : 0;
  return { repeatRate: returning, returningUsers: dto.returnacyRate || 0, totalUsers: dto.totalUsers || 0 };
}

export function toFrequency(dto: CoreAnalyticsDTO): FrequencyMetrics {
  return { averageFrequency: dto.averageUserFrequency || 0, totalCustomers: dto.totalUsers || 0 };
}

export function toEconomic(dto: CoreAnalyticsDTO): EconomicMetrics {
  return { totalStamps: dto.monthTotalStamps || 0, totalCouponsRedeemed: dto.monthTotalCouponsRedeemed || 0 };
}

// ---- API Calls ----
// `businessId` scopes to one location; omit it to get the brand-wide aggregate
// (server sums across all of the brand's locations under a BRAND wallet).
// `undefined` means "Tutte le sedi"; the explicit string selects one location.
export async function fetchCoreAnalytics(businessId?: string) {
  const q = businessId ? `?businessId=${encodeURIComponent(businessId)}` : '';
  const env = await businessHttp.get<AnalyticsEnvelope<CoreAnalyticsDTO>>(`/api/v1/analytics${q}`);
  return env.data;
}

export async function fetchDailyTransactions(days: number, businessId?: string) {
  const q = businessId ? `&businessId=${encodeURIComponent(businessId)}` : '';
  const env = await businessHttp.get<AnalyticsEnvelope<DailyTransactionsDTO>>(`/api/v1/analytics/daily-transactions?days=${days}${q}`);
  return env.data;
}

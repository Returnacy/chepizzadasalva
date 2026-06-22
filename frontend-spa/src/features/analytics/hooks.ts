import { useQuery } from '@tanstack/react-query';
import { fetchCoreAnalytics, fetchDailyTransactions, toOverview, toRepeatRate, toFrequency, toEconomic } from '../../api/analytics';

// `businessId` undefined => brand-wide aggregate ("Tutte le sedi"); a string
// scopes every derived metric to that one location. It is part of the query
// key so switching location refetches instead of serving stale data.
export function useCoreAnalytics(businessId?: string) {
  return useQuery({
    queryKey: ['analytics:core', businessId ?? 'all'],
    queryFn: () => fetchCoreAnalytics(businessId),
  });
}

export function useOverviewMetrics(businessId?: string) {
  const q = useCoreAnalytics(businessId);
  return { ...q, data: q.data ? toOverview(q.data) : undefined };
}

export function useRepeatRateMetrics(businessId?: string) {
  const q = useCoreAnalytics(businessId);
  return { ...q, data: q.data ? toRepeatRate(q.data) : undefined };
}

export function useFrequencyMetrics(businessId?: string) {
  const q = useCoreAnalytics(businessId);
  return { ...q, data: q.data ? toFrequency(q.data) : undefined };
}

export function useEconomicMetrics(businessId?: string) {
  const q = useCoreAnalytics(businessId);
  return { ...q, data: q.data ? toEconomic(q.data) : undefined };
}

export function useDailyTransactions(days: number, enabled = true, businessId?: string) {
  return useQuery({
    queryKey: ['analytics:daily-transactions', days, businessId ?? 'all'],
    queryFn: () => fetchDailyTransactions(days, businessId),
    enabled,
  });
}

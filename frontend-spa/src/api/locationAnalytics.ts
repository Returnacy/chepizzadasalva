import { businessHttp } from '../lib/servicesHttp';

// Typed clients for the per-location analytics endpoints (business-service).
// All read-only; brand-wide aggregation happens server-side.

interface Env<T> { message: string; data: T }

export interface LocationRef { id: string; name: string }
export interface LocationMetric {
  businessId: string;
  name: string;
  stamps: number;
  couponsRedeemed: number;
  newCustomers: number;
  activeCustomers: number;
}
export interface DailyLocRow { date: string; businessId: string; count: number }
export interface RetentionRow {
  businessId: string;
  name: string;
  total: number;
  active: number;
  atRisk: number;
  lost: number;
}
export interface FunnelRow {
  businessId: string;
  name: string;
  stamps: number;
  earned: number;
  redeemed: number;
  expired: number;
}
export interface CrossRow { earnedBusinessId: string; redeemedBusinessId: string; count: number }
export interface HeatCell { dow: number; hour: number; count: number }

export async function fetchLocations(): Promise<LocationRef[]> {
  return (await businessHttp.get<Env<LocationRef[]>>(`/api/v1/analytics/locations`)).data;
}

export async function fetchByLocation(days: number): Promise<LocationMetric[]> {
  return (await businessHttp.get<Env<LocationMetric[]>>(`/api/v1/analytics/by-location?days=${days}`)).data;
}

export async function fetchDailyByLocation(days: number): Promise<{ rows: DailyLocRow[]; locations: LocationRef[] }> {
  return (await businessHttp.get<Env<{ rows: DailyLocRow[]; locations: LocationRef[] }>>(`/api/v1/analytics/daily-by-location?days=${days}`)).data;
}

export async function fetchAcquisition(days: number): Promise<{ rows: DailyLocRow[]; locations: LocationRef[] }> {
  return (await businessHttp.get<Env<{ rows: DailyLocRow[]; locations: LocationRef[] }>>(`/api/v1/analytics/acquisition?days=${days}`)).data;
}

export async function fetchCrossLocation(days: number): Promise<{ matrix: CrossRow[]; locations: LocationRef[] }> {
  return (await businessHttp.get<Env<{ matrix: CrossRow[]; locations: LocationRef[] }>>(`/api/v1/analytics/cross-location?days=${days}`)).data;
}

export async function fetchRetention(days: number): Promise<RetentionRow[]> {
  return (await businessHttp.get<Env<RetentionRow[]>>(`/api/v1/analytics/retention?days=${days}`)).data;
}

export async function fetchRewardFunnel(days: number): Promise<FunnelRow[]> {
  return (await businessHttp.get<Env<FunnelRow[]>>(`/api/v1/analytics/reward-funnel?days=${days}`)).data;
}

export async function fetchStampHeatmap(days: number, businessId?: string): Promise<HeatCell[]> {
  const q = businessId ? `&businessId=${encodeURIComponent(businessId)}` : '';
  return (await businessHttp.get<Env<HeatCell[]>>(`/api/v1/analytics/stamp-heatmap?days=${days}${q}`)).data;
}

// Shared palette so a location keeps the same colour across every chart.
const LOCATION_COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#8b5cf6', '#ef4444', '#06b6d4', '#ec4899', '#14b8a6'];
export const colorForIndex = (idx: number): string => LOCATION_COLORS[((idx % LOCATION_COLORS.length) + LOCATION_COLORS.length) % LOCATION_COLORS.length];

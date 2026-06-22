import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import { MapPin } from 'lucide-react';
import { fetchDailyByLocation, colorForIndex } from '../../../api/locationAnalytics';

interface Props { days: number; isMobile: boolean }

// UTC date keys for the last N days, matching the server's 'YYYY-MM-DD' grouping.
function utcDateKeys(days: number): string[] {
  const keys: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return keys;
}

// Group A (A2) — daily stamps split per location as a stacked bar chart. Shown
// on the owner dashboard when the "Tutte le sedi" aggregate is selected.
export function LocationStampsChart({ days, isMobile }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics:daily-by-location', days],
    queryFn: () => fetchDailyByLocation(days),
  });

  if (error) return null;

  const locations = data?.locations ?? [];
  const rows = data?.rows ?? [];

  // Pivot { date, businessId, count } rows into one record per day keyed by name.
  const nameById = new Map(locations.map((l) => [l.id, l.name]));
  const byDate = new Map<string, Record<string, number>>();
  for (const r of rows) {
    const bucket = byDate.get(r.date) ?? {};
    const name = nameById.get(r.businessId) ?? r.businessId;
    bucket[name] = (bucket[name] ?? 0) + r.count;
    byDate.set(r.date, bucket);
  }
  const chartData = utcDateKeys(days).map((key) => {
    const label = new Date(key + 'T00:00:00Z').toLocaleDateString('it-IT', { month: 'short', day: 'numeric' });
    const rec: Record<string, any> = { date: label };
    for (const l of locations) rec[l.name] = byDate.get(key)?.[l.name] ?? 0;
    return rec;
  });

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle className="flex items-center"><MapPin className="w-5 h-5 mr-2" />Timbri per sede</CardTitle>
        <CardDescription>Timbri giornalieri suddivisi per pizzeria</CardDescription>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="h-80 flex items-center justify-center"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-blue"></div></div>
        ) : (
          <ResponsiveContainer width="100%" height={isMobile ? 300 : 400}>
            <BarChart data={chartData} margin={{ top: 0, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={isMobile ? 10 : 12} angle={isMobile ? -45 : 0} textAnchor={isMobile ? 'end' : 'middle'} height={isMobile ? 60 : 30} />
              <YAxis fontSize={isMobile ? 10 : 12} allowDecimals={false} domain={[0, 'dataMax']} />
              <Tooltip />
              <Legend />
              {locations.map((l, idx) => (
                <Bar key={l.id} dataKey={l.name} stackId="stamps" fill={colorForIndex(idx)} name={l.name} />
              ))}
            </BarChart>
          </ResponsiveContainer>
        )}
      </CardContent>
    </Card>
  );
}

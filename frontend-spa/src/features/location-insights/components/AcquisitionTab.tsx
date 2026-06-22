import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import { fetchAcquisition, colorForIndex } from '../../../api/locationAnalytics';
import { PanelLoading, PanelError, PanelEmpty } from '../shared';

interface Props { days: number }

function utcDateKeys(days: number): string[] {
  const keys: string[] = [];
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  for (let i = days - 1; i >= 0; i--) {
    keys.push(new Date(today.getTime() - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10));
  }
  return keys;
}

// B2 — new customers acquired per location, by first-stamp date.
export function AcquisitionTab({ days }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights:acquisition', days],
    queryFn: () => fetchAcquisition(days),
  });

  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={(error as any)?.message} />;
  if (!data) return <PanelEmpty text="Nessun dato disponibile." />;

  const { rows, locations } = data;
  const nameById = new Map(locations.map((l) => [l.id, l.name]));

  // Pivot to a stacked daily series + per-location totals.
  const byDate = new Map<string, Record<string, number>>();
  const totals = new Map<string, number>();
  for (const r of rows) {
    const name = nameById.get(r.businessId) ?? r.businessId;
    const bucket = byDate.get(r.date) ?? {};
    bucket[name] = (bucket[name] ?? 0) + r.count;
    byDate.set(r.date, bucket);
    totals.set(name, (totals.get(name) ?? 0) + r.count);
  }
  const chartData = utcDateKeys(days).map((key) => {
    const rec: Record<string, any> = { date: new Date(key + 'T00:00:00Z').toLocaleDateString('it-IT', { month: 'short', day: 'numeric' }) };
    for (const l of locations) rec[l.name] = byDate.get(key)?.[l.name] ?? 0;
    return rec;
  });

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {locations.map((l, idx) => (
          <Card key={l.id}>
            <CardContent className="p-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-gray-600 text-sm font-medium">{l.name}</p>
                  <p className="text-3xl font-bold text-gray-900">{totals.get(l.name) ?? 0}</p>
                  <p className="text-xs text-gray-500 mt-1">Nuovi clienti ({days}gg)</p>
                </div>
                <span className="w-4 h-4 rounded-full" style={{ backgroundColor: colorForIndex(idx) }} />
              </div>
            </CardContent>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Acquisizione clienti per sede</CardTitle>
          <CardDescription>Nuovi clienti per giorno, attribuiti alla sede del primo timbro</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={chartData} margin={{ top: 0, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="date" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Legend />
              {locations.map((l, idx) => (
                <Bar key={l.id} dataKey={l.name} stackId="acq" fill={colorForIndex(idx)} />
              ))}
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-500 mt-3">
            Nota: la registrazione avviene tramite un unico indirizzo condiviso, quindi non distingue la sede.
            Questo grafico usa la sede del <strong>primo timbro</strong> come indicatore di dove il cliente è stato acquisito.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

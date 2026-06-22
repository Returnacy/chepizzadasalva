import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import { fetchRetention } from '../../../api/locationAnalytics';
import { PanelLoading, PanelError, PanelEmpty, pct } from '../shared';

interface Props { days: number }

// B4 — per-location retention buckets by recency of last stamp.
export function RetentionTab({ days }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights:retention', days],
    queryFn: () => fetchRetention(days),
  });

  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={(error as any)?.message} />;
  if (!data || data.length === 0) return <PanelEmpty text="Nessun dato disponibile." />;

  const chartData = data.map((l) => ({
    name: l.name,
    Attivi: l.active,
    'A rischio': l.atRisk,
    Persi: l.lost,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Fidelizzazione per sede</CardTitle>
          <CardDescription>
            Attivi (ultimi {days}gg) · A rischio ({days}–{days * 2}gg) · Persi (oltre {days * 2}gg)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={chartData} margin={{ top: 0, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Attivi" stackId="r" fill="#10b981" />
              <Bar dataKey="A rischio" stackId="r" fill="#f59e0b" />
              <Bar dataKey="Persi" stackId="r" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Dettaglio</CardTitle>
          <CardDescription>I clienti "a rischio" sono i candidati ideali per una campagna di recupero.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-2 px-3">Sede</th>
                  <th className="py-2 px-3 text-right">Totale clienti</th>
                  <th className="py-2 px-3 text-right">Attivi</th>
                  <th className="py-2 px-3 text-right">A rischio</th>
                  <th className="py-2 px-3 text-right">Persi</th>
                  <th className="py-2 px-3 text-right">% Attivi</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((l) => (
                  <tr key={l.businessId}>
                    <td className="py-2 px-3 font-medium text-gray-900">{l.name}</td>
                    <td className="py-2 px-3 text-right">{l.total}</td>
                    <td className="py-2 px-3 text-right text-green-600">{l.active}</td>
                    <td className="py-2 px-3 text-right text-amber-600 font-semibold">{l.atRisk}</td>
                    <td className="py-2 px-3 text-right text-red-600">{l.lost}</td>
                    <td className="py-2 px-3 text-right">{pct(l.active, l.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

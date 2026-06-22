import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import { fetchRewardFunnel } from '../../../api/locationAnalytics';
import { PanelLoading, PanelError, PanelEmpty, pct } from '../shared';

interface Props { days: number }

// B5 — reward funnel per location: stamps -> coupons earned -> redeemed,
// plus coupons that expired unredeemed (breakage).
export function RewardFunnelTab({ days }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights:reward-funnel', days],
    queryFn: () => fetchRewardFunnel(days),
  });

  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={(error as any)?.message} />;
  if (!data || data.length === 0) return <PanelEmpty text="Nessun dato disponibile." />;

  const chartData = data.map((l) => ({
    name: l.name,
    Timbri: l.stamps,
    'Premi sbloccati': l.earned,
    Riscattati: l.redeemed,
    Scaduti: l.expired,
  }));

  const totals = data.reduce(
    (acc, l) => ({ stamps: acc.stamps + l.stamps, earned: acc.earned + l.earned, redeemed: acc.redeemed + l.redeemed, expired: acc.expired + l.expired }),
    { stamps: 0, earned: 0, redeemed: 0, expired: 0 },
  );

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Imbuto premi per sede</CardTitle>
          <CardDescription>Timbri → premi sbloccati → riscattati / scaduti — ultimi {days} giorni</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={340}>
            <BarChart data={chartData} margin={{ top: 0, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Timbri" fill="#f59e0b" />
              <Bar dataKey="Premi sbloccati" fill="#8b5cf6" />
              <Bar dataKey="Riscattati" fill="#10b981" />
              <Bar dataKey="Scaduti" fill="#ef4444" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tassi di conversione</CardTitle>
          <CardDescription>Riscatto = riscattati / sbloccati · Scadenza = scaduti / sbloccati</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-2 px-3">Sede</th>
                  <th className="py-2 px-3 text-right">Timbri</th>
                  <th className="py-2 px-3 text-right">Premi sbloccati</th>
                  <th className="py-2 px-3 text-right">Riscattati</th>
                  <th className="py-2 px-3 text-right">Scaduti</th>
                  <th className="py-2 px-3 text-right">% Riscatto</th>
                  <th className="py-2 px-3 text-right">% Scadenza</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((l) => (
                  <tr key={l.businessId}>
                    <td className="py-2 px-3 font-medium text-gray-900">{l.name}</td>
                    <td className="py-2 px-3 text-right">{l.stamps}</td>
                    <td className="py-2 px-3 text-right">{l.earned}</td>
                    <td className="py-2 px-3 text-right text-green-600">{l.redeemed}</td>
                    <td className="py-2 px-3 text-right text-red-600">{l.expired}</td>
                    <td className="py-2 px-3 text-right">{pct(l.redeemed, l.earned)}</td>
                    <td className="py-2 px-3 text-right">{pct(l.expired, l.earned)}</td>
                  </tr>
                ))}
                <tr className="border-t-2 border-gray-200 font-semibold">
                  <td className="py-2 px-3 text-gray-900">Totale</td>
                  <td className="py-2 px-3 text-right">{totals.stamps}</td>
                  <td className="py-2 px-3 text-right">{totals.earned}</td>
                  <td className="py-2 px-3 text-right text-green-600">{totals.redeemed}</td>
                  <td className="py-2 px-3 text-right text-red-600">{totals.expired}</td>
                  <td className="py-2 px-3 text-right">{pct(totals.redeemed, totals.earned)}</td>
                  <td className="py-2 px-3 text-right">{pct(totals.expired, totals.earned)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

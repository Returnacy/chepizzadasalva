import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { ResponsiveContainer, BarChart, CartesianGrid, XAxis, YAxis, Tooltip, Legend, Bar } from 'recharts';
import { fetchByLocation } from '../../../api/locationAnalytics';
import { PanelLoading, PanelError, PanelEmpty } from '../shared';

interface Props { days: number }

// B1 — side-by-side comparison of the brand's locations.
export function ComparisonTab({ days }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights:by-location', days],
    queryFn: () => fetchByLocation(days),
  });

  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={(error as any)?.message} />;
  if (!data || data.length === 0) return <PanelEmpty text="Nessun dato disponibile." />;

  const chartData = data.map((l) => ({
    name: l.name,
    Timbri: l.stamps,
    'Clienti attivi': l.activeCustomers,
    'Nuovi clienti': l.newCustomers,
    'Premi riscattati': l.couponsRedeemed,
  }));

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Confronto sedi</CardTitle>
          <CardDescription>Metriche per pizzeria — ultimi {days} giorni</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={360}>
            <BarChart data={chartData} margin={{ top: 0, right: 20, left: 10, bottom: 10 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="name" fontSize={12} />
              <YAxis fontSize={12} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="Timbri" fill="#f59e0b" />
              <Bar dataKey="Clienti attivi" fill="#3b82f6" />
              <Bar dataKey="Nuovi clienti" fill="#06b6d4" />
              <Bar dataKey="Premi riscattati" fill="#10b981" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Tabella dettaglio</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-gray-200 text-left text-gray-600">
                  <th className="py-2 px-3">Sede</th>
                  <th className="py-2 px-3 text-right">Timbri</th>
                  <th className="py-2 px-3 text-right">Clienti attivi</th>
                  <th className="py-2 px-3 text-right">Nuovi clienti</th>
                  <th className="py-2 px-3 text-right">Premi riscattati</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {data.map((l) => (
                  <tr key={l.businessId}>
                    <td className="py-2 px-3 font-medium text-gray-900">{l.name}</td>
                    <td className="py-2 px-3 text-right">{l.stamps}</td>
                    <td className="py-2 px-3 text-right">{l.activeCustomers}</td>
                    <td className="py-2 px-3 text-right">{l.newCustomers}</td>
                    <td className="py-2 px-3 text-right">{l.couponsRedeemed}</td>
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

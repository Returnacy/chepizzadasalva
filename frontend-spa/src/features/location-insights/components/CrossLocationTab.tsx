import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { fetchCrossLocation } from '../../../api/locationAnalytics';
import { PanelLoading, PanelError, PanelEmpty, pct } from '../shared';

interface Props { days: number }

// B3 — cross-location wallet flow: where coupons were earned vs. redeemed.
// Only meaningful under the shared (BRAND) wallet, which lets a customer earn
// at one pizzeria and redeem at another.
export function CrossLocationTab({ days }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights:cross-location', days],
    queryFn: () => fetchCrossLocation(days),
  });

  if (isLoading) return <PanelLoading />;
  if (error) return <PanelError message={(error as any)?.message} />;
  if (!data) return <PanelEmpty text="Nessun dato disponibile." />;

  const { matrix, locations } = data;
  const countFor = (earnedId: string, redeemedId: string): number =>
    matrix.find((m) => m.earnedBusinessId === earnedId && m.redeemedBusinessId === redeemedId)?.count ?? 0;

  const total = matrix.reduce((s, m) => s + m.count, 0);
  const cross = matrix.filter((m) => m.earnedBusinessId !== m.redeemedBusinessId).reduce((s, m) => s + m.count, 0);

  if (total === 0) return <PanelEmpty text={`Nessun premio riscattato negli ultimi ${days} giorni.`} />;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card><CardContent className="p-6"><p className="text-gray-600 text-sm font-medium">Premi riscattati</p><p className="text-3xl font-bold text-gray-900">{total}</p></CardContent></Card>
        <Card><CardContent className="p-6"><p className="text-gray-600 text-sm font-medium">Riscatti incrociati</p><p className="text-3xl font-bold text-gray-900">{cross}</p><p className="text-xs text-gray-500 mt-1">Guadagnati in una sede, riscattati in un'altra</p></CardContent></Card>
        <Card><CardContent className="p-6"><p className="text-gray-600 text-sm font-medium">Quota incrociata</p><p className="text-3xl font-bold text-gray-900">{pct(cross, total)}</p></CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Matrice guadagnati → riscattati</CardTitle>
          <CardDescription>Righe = sede di guadagno · Colonne = sede di riscatto · ultimi {days} giorni</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full text-sm border-collapse">
              <thead>
                <tr className="text-left text-gray-600">
                  <th className="py-2 px-3 border-b border-gray-200">Guadagnato \ Riscattato</th>
                  {locations.map((c) => (
                    <th key={c.id} className="py-2 px-3 border-b border-gray-200 text-right">{c.name}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {locations.map((row) => (
                  <tr key={row.id} className="divide-x divide-gray-100">
                    <td className="py-2 px-3 font-medium text-gray-900 border-b border-gray-100">{row.name}</td>
                    {locations.map((col) => {
                      const v = countFor(row.id, col.id);
                      const isCross = row.id !== col.id;
                      return (
                        <td
                          key={col.id}
                          className={`py-2 px-3 text-right border-b border-gray-100 ${isCross && v > 0 ? 'bg-amber-50 font-semibold text-amber-700' : 'text-gray-700'}`}
                        >
                          {v}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Le celle evidenziate mostrano il traffico incrociato fra le sedi reso possibile dal portafoglio condiviso.
            I riscatti precedenti all'introduzione del tracciamento per sede sono attribuiti alla sede di guadagno.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}

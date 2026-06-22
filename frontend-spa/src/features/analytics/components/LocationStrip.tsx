import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Stamp, UserPlus, Gift, Users } from 'lucide-react';
import { fetchByLocation, colorForIndex } from '../../../api/locationAnalytics';

interface Props { days: number }

// Group A — KPI strip comparing the brand's locations side by side. Rendered on
// the owner dashboard only when more than one location exists.
export function LocationStrip({ days }: Props) {
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics:by-location', days],
    queryFn: () => fetchByLocation(days),
  });

  if (isLoading) {
    return (
      <Card className="mb-8">
        <CardContent className="p-6 flex items-center justify-center h-32">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-brand-blue"></div>
        </CardContent>
      </Card>
    );
  }
  if (error || !data) return null;

  return (
    <Card className="mb-8">
      <CardHeader>
        <CardTitle>Confronto sedi</CardTitle>
        <CardDescription>Attività per pizzeria negli ultimi {days} giorni</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {data.map((loc, idx) => (
            <div key={loc.businessId} className="border rounded-lg p-4" style={{ borderTopColor: colorForIndex(idx), borderTopWidth: 3 }}>
              <div className="flex items-center justify-between mb-3">
                <span className="font-semibold text-gray-900">{loc.name}</span>
                <span className="w-3 h-3 rounded-full" style={{ backgroundColor: colorForIndex(idx) }} />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Metric icon={Stamp} label="Timbri" value={loc.stamps} cls="text-orange-600" />
                <Metric icon={UserPlus} label="Nuovi clienti" value={loc.newCustomers} cls="text-cyan-600" />
                <Metric icon={Gift} label="Premi riscattati" value={loc.couponsRedeemed} cls="text-green-600" />
                <Metric icon={Users} label="Clienti attivi" value={loc.activeCustomers} cls="text-blue-600" />
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

function Metric({ icon: Icon, label, value, cls }: { icon: any; label: string; value: number; cls: string }) {
  return (
    <div className="flex items-center space-x-2">
      <Icon className={`w-4 h-4 ${cls}`} />
      <div>
        <div className="text-lg font-bold text-gray-900 leading-none">{value}</div>
        <div className="text-xs text-gray-500">{label}</div>
      </div>
    </div>
  );
}

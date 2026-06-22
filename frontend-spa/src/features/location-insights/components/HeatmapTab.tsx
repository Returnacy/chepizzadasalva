import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '../../../components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../../components/ui/select';
import { fetchStampHeatmap, fetchLocations } from '../../../api/locationAnalytics';
import { PanelLoading, PanelError } from '../shared';

interface Props { days: number }

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Gio', 'Ven', 'Sab', 'Dom']; // ISODOW 1..7
const HOURS = Array.from({ length: 24 }, (_, h) => h);

// B6 — stamp activity heatmap by weekday x hour (Europe/Rome local time).
export function HeatmapTab({ days }: Props) {
  const [locationId, setLocationId] = useState('all');
  const businessId = locationId === 'all' ? undefined : locationId;

  const { data: locations = [] } = useQuery({ queryKey: ['insights:locations'], queryFn: fetchLocations });
  const { data, isLoading, error } = useQuery({
    queryKey: ['insights:heatmap', days, locationId],
    queryFn: () => fetchStampHeatmap(days, businessId),
  });

  // Build a 7x24 lookup and find the max for colour scaling.
  const cell = new Map<string, number>();
  let max = 0;
  for (const c of data ?? []) {
    cell.set(`${c.dow}-${c.hour}`, c.count);
    if (c.count > max) max = c.count;
  }
  const intensity = (count: number): string => {
    if (count <= 0) return '#f3f4f6';
    const alpha = 0.12 + 0.88 * (count / (max || 1));
    return `rgba(37, 99, 235, ${alpha.toFixed(3)})`;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <CardTitle>Orari di affluenza</CardTitle>
            <CardDescription>Timbri per giorno della settimana e ora (ora locale) — ultimi {days} giorni</CardDescription>
          </div>
          {locations.length > 1 && (
            <Select value={locationId} onValueChange={setLocationId}>
              <SelectTrigger className="w-56" aria-label="Filtra sede"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="all">Tutte le sedi</SelectItem>
                {locations.map((l) => (
                  <SelectItem key={l.id} value={l.id}>{l.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <PanelLoading />
        ) : error ? (
          <PanelError message={(error as any)?.message} />
        ) : (
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full">
              {/* Hour header */}
              <div className="flex">
                <div className="w-10 flex-shrink-0" />
                {HOURS.map((h) => (
                  <div key={h} className="flex-1 text-center text-[10px] text-gray-400" style={{ minWidth: 22 }}>{h}</div>
                ))}
              </div>
              {/* Rows per weekday */}
              {DAY_LABELS.map((label, i) => {
                const dow = i + 1;
                return (
                  <div key={dow} className="flex items-center">
                    <div className="w-10 flex-shrink-0 text-xs text-gray-600 pr-1 text-right">{label}</div>
                    {HOURS.map((h) => {
                      const count = cell.get(`${dow}-${h}`) ?? 0;
                      return (
                        <div
                          key={h}
                          className="flex-1 m-[1px] rounded-sm"
                          style={{ minWidth: 20, height: 22, backgroundColor: intensity(count) }}
                          title={`${label} ${h}:00 — ${count} timbri`}
                        />
                      );
                    })}
                  </div>
                );
              })}
            </div>
            <p className="text-xs text-gray-500 mt-3">Colore più intenso = più timbri. Passa il mouse su una cella per il dettaglio.</p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

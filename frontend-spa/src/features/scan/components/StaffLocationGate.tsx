// @ts-nocheck
// Staff "which location today" gate, shown only for BRAND-scoped (shared-wallet)
// brands with more than one location. Renders a persistent badge of the chosen
// location and a blocking picker when no choice has been made for the day.
// The chosen location id is read by getBusinessId() and rides on every stamp.
import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { businessHttp } from '../../../lib/servicesHttp';
import { getSelectedLocation, setSelectedLocation } from '../../../lib/staffLocation';

type Loc = { id: string; name: string; address?: string };

export function StaffLocationGate() {
  const { data } = useQuery({
    queryKey: ['brand-locations'],
    queryFn: async () =>
      businessHttp.get<{ walletScope: string; locations: Loc[] }>('/api/v1/brand/locations'),
    staleTime: 5 * 60 * 1000,
  });

  const walletScope = data?.walletScope;
  const locations: Loc[] = data?.locations ?? [];
  const multi = walletScope === 'BRAND' && locations.length > 1;

  const [selected, setSelected] = useState(getSelectedLocation());
  const [pickerOpen, setPickerOpen] = useState(false);

  // Prompt when multi-location and there's no valid selection for today.
  useEffect(() => {
    if (multi && !getSelectedLocation()) setPickerOpen(true);
  }, [multi]);

  if (!multi) return null;

  function choose(loc: Loc) {
    setSelectedLocation(loc.id, loc.name);
    setSelected({ id: loc.id, name: loc.name });
    setPickerOpen(false);
  }

  return (
    <>
      {/* Persistent location badge so a wrong pick can't go unnoticed. */}
      <div className="flex items-center justify-center gap-2 mb-4 text-sm">
        <span className="inline-flex items-center gap-2 rounded-full bg-amber-100 text-amber-900 px-3 py-1 font-medium">
          📍 Stai timbrando per: {selected?.name || '—'}
        </span>
        <button className="text-amber-700 underline" onClick={() => setPickerOpen(true)}>
          Cambia
        </button>
      </div>

      {/* Blocking picker (no dismiss until a location is chosen). */}
      {pickerOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
            <h2 className="text-lg font-bold mb-1">In quale sede lavori oggi?</h2>
            <p className="text-sm text-gray-600 mb-4">Ogni timbro verrà attribuito a questa sede.</p>
            <div className="space-y-2">
              {locations.map((loc) => (
                <button
                  key={loc.id}
                  onClick={() => choose(loc)}
                  className={`w-full text-left rounded-md border px-4 py-3 hover:bg-amber-50 ${
                    selected?.id === loc.id ? 'border-amber-500 bg-amber-50' : 'border-gray-200'
                  }`}
                >
                  <div className="font-medium">{loc.name}</div>
                  {loc.address && <div className="text-xs text-gray-500">{loc.address}</div>}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </>
  );
}

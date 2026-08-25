// @ts-nocheck
// "Chiusura / Inventario" handoff logic, shared by the main navigation entry.
// Mints a short-lived PizzeriaManager SSO token (/api/v1/auth/pm-handoff) and
// redirects to PM's /sso landing with the token in the URL fragment plus the
// location the staff member is closing for. Resolves the location from the
// per-day staff pick; for single-location brands it uses the only location; for
// multi-location brands with no pick yet it prompts with the same location list.
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useToast } from '../../../hooks/use-toast';
import { useAuth } from '../../../hooks/use-auth';
import { hasAnyRole } from '../../../lib/authz';
import { userHttp, businessHttp } from '../../../lib/servicesHttp';
import { getSelectedLocation, setSelectedLocation } from '../../../lib/staffLocation';
import { PM_URL } from '../../../config/brand';

type Loc = { id: string; name: string; address?: string };

export function useChiusuraHandoff() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [pending, setPending] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  const allowed = hasAnyRole(user as any, ['staff']);

  // Same query (key + endpoint) as StaffLocationGate, so it dedupes/shares cache.
  const { data } = useQuery({
    queryKey: ['brand-locations'],
    queryFn: () =>
      businessHttp.get<{ walletScope: string; locations: Loc[] }>('/api/v1/brand/locations'),
    staleTime: 5 * 60 * 1000,
    enabled: allowed,
  });

  const locations: Loc[] = data?.locations ?? [];

  async function mint(businessId: string, name: string) {
    try {
      setPending(true);
      // The location now goes in the request body so user-service can validate
      // it against the brand and put it in the token. The `loc` fragment stays
      // for backwards compatibility, but PizzeriaManager prefers the claim —
      // see user-service/docs/SSO-PM-CONTRACT.md §4.
      const res = await userHttp.post<{ token: string; expiresIn: number }>('/api/v1/auth/pm-handoff', { businessId });
      const url = `${PM_URL}/sso#token=${res.token}&loc=${businessId}&locName=${encodeURIComponent(name || '')}`;
      window.location.href = url; // navigation away — no need to clear pending
    } catch (e) {
      setPending(false);
      toast({
        title: 'Errore',
        description: 'Non riesco ad aprire Pizzeria Manager. Riprova.',
        variant: 'destructive',
      });
    }
  }

  function open() {
    if (pending) return;
    const sel = getSelectedLocation();
    if (sel?.id) return void mint(sel.id, sel.name);
    // Single-location brand: no daily pick is ever prompted — use the only one.
    if (locations.length === 1) return void mint(locations[0].id, locations[0].name);
    // Multi-location, no pick yet: prompt with the same location list.
    if (locations.length > 1) return void setPickerOpen(true);
    // Locations not loaded yet: nothing sensible to do — ask to retry.
    toast({ title: 'Un attimo…', description: 'Sto caricando le sedi, riprova tra poco.' });
  }

  function chooseLocation(loc: Loc) {
    setSelectedLocation(loc.id, loc.name);
    setPickerOpen(false);
    void mint(loc.id, loc.name);
  }

  // Location picker for multi-location brands without a pick today.
  const picker = pickerOpen ? (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-6 shadow-xl">
        <h2 className="text-lg font-bold mb-1">Per quale sede stai chiudendo?</h2>
        <p className="text-sm text-gray-600 mb-4">La chiusura verrà attribuita a questa sede.</p>
        <div className="space-y-2">
          {locations.map((loc) => (
            <button
              key={loc.id}
              onClick={() => chooseLocation(loc)}
              className="w-full text-left rounded-md border border-gray-200 px-4 py-3 hover:bg-amber-50"
            >
              <div className="font-medium">{loc.name}</div>
              {loc.address && <div className="text-xs text-gray-500">{loc.address}</div>}
            </button>
          ))}
        </div>
        <button
          className="mt-4 text-sm text-gray-500 underline"
          onClick={() => setPickerOpen(false)}
        >
          Annulla
        </button>
      </div>
    </div>
  ) : null;

  return { allowed, pending, open, picker };
}

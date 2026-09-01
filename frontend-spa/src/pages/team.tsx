// @ts-nocheck
// Squadra: role management for the team (BRAND_MANAGER + ADMIN only).
// Opens directly on the member list (compact cards, no table). Tapping an
// editable member's role chip opens a bottom-sheet to reassign the role or
// remove them from the team. "Aggiungi membro" searches brand customers and
// promotes the chosen one via the same PATCH.
import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { UserPlus, Search, Pencil, Trash2, Loader2, X } from 'lucide-react';
import { Card } from '../components/ui/card';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '../components/ui/sheet';
import { useToast } from '../hooks/use-toast';
import { useAuth } from '../hooks/use-auth';
import { getHighestRole, getTenantContext } from '../lib/authz';
import { userHttp } from '../lib/servicesHttp';

type TeamRole = 'STAFF' | 'MANAGER' | 'BRAND_MANAGER' | 'ADMIN';

type Member = {
  userId: string;
  email: string;
  name: string;
  surname: string;
  role: TeamRole;
  businessId: string;
};

type Candidate = { userId: string; email: string; name: string; surname: string };

const ROLE_LABELS: Record<TeamRole, string> = {
  STAFF: 'Staff',
  MANAGER: 'Manager',
  BRAND_MANAGER: 'Brand Manager',
  ADMIN: 'Admin',
};

const ROLE_CHIP: Record<TeamRole, string> = {
  STAFF: 'bg-blue-100 text-blue-800',
  MANAGER: 'bg-green-100 text-green-800',
  BRAND_MANAGER: 'bg-purple-100 text-purple-800',
  ADMIN: 'bg-red-100 text-red-800',
};

const CHIP_BASE = 'inline-flex items-center gap-1 rounded-full px-3 py-1 text-xs font-semibold';

function assignableRoles(callerRole: string | null): TeamRole[] {
  if (callerRole === 'admin') return ['STAFF', 'MANAGER', 'BRAND_MANAGER'];
  return ['STAFF', 'MANAGER']; // brand_manager
}

function displayName(p: { name?: string; surname?: string; email?: string }): string {
  const full = [p.name, p.surname].filter((s) => s && s.trim()).join(' ').trim();
  return full || p.email || 'Utente';
}

export default function TeamPage() {
  const { user } = useAuth();
  const ctx = getTenantContext();
  const callerRole = getHighestRole(user as any, ctx); // 'brand_manager' | 'admin' (lowercased)
  const callerId = (user as any)?.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [searchOpen, setSearchOpen] = useState(false);
  const [q, setQ] = useState('');
  const [debouncedQ, setDebouncedQ] = useState('');
  // Sheet target: an existing member (isNew=false) or a searched candidate (isNew=true)
  const [sheetTarget, setSheetTarget] = useState(null as null | {
    userId: string;
    displayName: string;
    currentRole: TeamRole | null;
    isNew: boolean;
  });

  // Debounce the search input (~300ms); only ≥3 chars hits the backend.
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  const teamQuery = useQuery({
    queryKey: ['team'],
    queryFn: () => userHttp.get<{ members: Member[] }>('/api/v1/team'),
    staleTime: 30_000,
  });

  const searchQuery = useQuery({
    queryKey: ['team-search', debouncedQ],
    queryFn: () =>
      userHttp.get<{ users: Candidate[] }>(`/api/v1/team/search?q=${encodeURIComponent(debouncedQ)}`),
    enabled: searchOpen && debouncedQ.length >= 3,
    staleTime: 15_000,
  });

  const patchMutation = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: TeamRole | 'USER'; mode: string; name?: string }) =>
      userHttp.patch<{ member: Member }>(`/api/v1/team/${userId}`, { role }),
    onSuccess: (_data, vars) => {
      queryClient.invalidateQueries({ queryKey: ['team'] });
      setSheetTarget(null);
      if (vars.mode === 'remove') {
        toast({ title: 'Membro rimosso', description: "L'utente resta un cliente." });
      } else if (vars.mode === 'add') {
        // Clear the search so the fresh member shows up in the list.
        setQ('');
        setDebouncedQ('');
        setSearchOpen(false);
        toast({ title: 'Membro aggiunto', description: `${vars.name || 'Il cliente'} fa ora parte del team.` });
      } else {
        toast({ title: 'Ruolo aggiornato' });
      }
    },
    onError: (error: any) => {
      toast({
        title: 'Operazione non riuscita',
        description: error?.message || 'Riprova più tardi.',
        variant: 'destructive',
      });
    },
  });

  const members = teamQuery.data?.members ?? [];
  const candidates = searchQuery.data?.users ?? [];
  const roleOptions = assignableRoles(callerRole);

  function canEditMember(m: Member): boolean {
    if (m.userId === callerId) return false;
    if (m.role === 'ADMIN') return false; // never settable by anyone
    if (callerRole === 'brand_manager' && m.role === 'BRAND_MANAGER') return false;
    return true;
  }

  function openMemberSheet(m: Member) {
    setSheetTarget({ userId: m.userId, displayName: displayName(m), currentRole: m.role, isNew: false });
  }

  function openCandidateSheet(c: Candidate) {
    setSheetTarget({ userId: c.userId, displayName: displayName(c), currentRole: null, isNew: true });
  }

  function chooseRole(role: TeamRole) {
    if (!sheetTarget) return;
    patchMutation.mutate({
      userId: sheetTarget.userId,
      role,
      mode: sheetTarget.isNew ? 'add' : 'update',
      name: sheetTarget.displayName,
    });
  }

  function handleRemove() {
    if (!sheetTarget) return;
    const ok = window.confirm(`Rimuovere ${sheetTarget.displayName} dal team? Resterà un cliente.`);
    if (!ok) return;
    patchMutation.mutate({ userId: sheetTarget.userId, role: 'USER', mode: 'remove' });
  }

  return (
    <div className="max-w-2xl mx-auto p-6 min-h-screen">
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-gray-900 mb-2">Squadra</h1>
        <p className="text-gray-600">Gestisci i ruoli del tuo team.</p>
      </div>

      {/* Add member */}
      <div className="mb-6">
        {!searchOpen ? (
          <Button onClick={() => setSearchOpen(true)} className="flex items-center gap-2">
            <UserPlus className="w-4 h-4" />
            Aggiungi membro
          </Button>
        ) : (
          <Card className="p-4">
            <div className="flex items-center gap-2 mb-3">
              <div className="flex-1 relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400 w-4 h-4" />
                <Input
                  autoFocus
                  placeholder="Cerca per nome o email…"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  className="pl-10"
                />
              </div>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchOpen(false);
                  setQ('');
                  setDebouncedQ('');
                }}
              >
                <X className="w-5 h-5" />
              </Button>
            </div>

            {debouncedQ.length < 3 ? (
              <p className="text-sm text-gray-500 px-1">Digita almeno 3 caratteri per cercare.</p>
            ) : searchQuery.isLoading ? (
              <div className="flex items-center gap-2 text-sm text-gray-500 px-1">
                <Loader2 className="w-4 h-4 animate-spin" /> Ricerca…
              </div>
            ) : candidates.length === 0 ? (
              <p className="text-sm text-gray-500 px-1">Nessun cliente trovato</p>
            ) : (
              <div className="space-y-2">
                {candidates.map((c) => (
                  <button
                    key={c.userId}
                    onClick={() => openCandidateSheet(c)}
                    className="w-full text-left rounded-md border border-gray-200 px-4 py-3 hover:bg-gray-50 transition-colors"
                  >
                    <div className="font-medium text-gray-900">{displayName(c)}</div>
                    <div className="text-sm text-gray-500">{c.email}</div>
                  </button>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      {/* Team list */}
      {teamQuery.isLoading ? (
        <div className="flex items-center justify-center py-12 text-gray-500">
          <Loader2 className="w-6 h-6 animate-spin" />
        </div>
      ) : members.length === 0 ? (
        <div className="text-center py-12 text-gray-600">
          Nessun membro nel team. Aggiungi il primo!
        </div>
      ) : (
        <div className="space-y-3">
          {members.map((m) => {
            const isSelf = m.userId === callerId;
            const editable = canEditMember(m);
            return (
              <Card key={m.userId} className="p-4 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="font-medium text-gray-900 truncate">
                    {displayName(m)}
                    {isSelf && <span className="text-gray-400 font-normal"> (tu)</span>}
                  </div>
                  <div className="text-sm text-gray-500 truncate">{m.email}</div>
                </div>
                {editable ? (
                  <button
                    onClick={() => openMemberSheet(m)}
                    className={`${CHIP_BASE} ${ROLE_CHIP[m.role]} shrink-0 hover:opacity-80 transition-opacity`}
                    aria-label={`Modifica ruolo di ${displayName(m)}`}
                  >
                    {ROLE_LABELS[m.role]}
                    <Pencil className="w-3 h-3 opacity-70" />
                  </button>
                ) : (
                  <span className={`${CHIP_BASE} ${ROLE_CHIP[m.role]} shrink-0`}>
                    {ROLE_LABELS[m.role]}
                  </span>
                )}
              </Card>
            );
          })}
        </div>
      )}

      {/* Role sheet */}
      <Sheet open={!!sheetTarget} onOpenChange={(o) => { if (!o) setSheetTarget(null); }}>
        <SheetContent side="bottom" className="rounded-t-3xl">
          <SheetHeader className="pb-4 text-left">
            <SheetTitle>{sheetTarget?.isNew ? 'Aggiungi al team' : 'Modifica ruolo'}</SheetTitle>
            <SheetDescription>{sheetTarget?.displayName}</SheetDescription>
          </SheetHeader>

          <div className="space-y-2 pb-6">
            {roleOptions.map((r) => {
              const highlight = sheetTarget?.isNew ? r === 'STAFF' : r === sheetTarget?.currentRole;
              return (
                <button
                  key={r}
                  onClick={() => chooseRole(r)}
                  disabled={patchMutation.isPending}
                  className={`w-full rounded-md border px-4 py-3 flex items-center justify-between transition-colors disabled:opacity-60 ${
                    highlight ? 'border-brand-blue bg-[var(--brand-surface-from)]' : 'border-gray-200 hover:bg-gray-50'
                  }`}
                >
                  <span className="font-medium text-gray-900">{ROLE_LABELS[r]}</span>
                  <span className={`${CHIP_BASE} ${ROLE_CHIP[r]}`}>{ROLE_LABELS[r]}</span>
                </button>
              );
            })}

            {!sheetTarget?.isNew && (
              <button
                onClick={handleRemove}
                disabled={patchMutation.isPending}
                className="w-full rounded-md border border-red-200 text-red-700 px-4 py-3 flex items-center gap-2 hover:bg-red-50 transition-colors disabled:opacity-60"
              >
                <Trash2 className="w-4 h-4" />
                Rimuovi dal team
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

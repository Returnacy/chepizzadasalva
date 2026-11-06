// @ts-nocheck
// Refactored Scan QR page into feature components
import { useState, useEffect, useCallback, useRef } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUser, addStamps as addStampsLegacy, getPrizeProgression, getUserCoupons, getCouponByCode, redeemCoupon as redeemCouponLegacy, type ApplyStampsResult } from '../lib/legacy-api-adapter';
import { useToast } from '../hooks/use-toast';
import { useLocation, Link } from 'wouter';
import { ModeSelector } from '../features/scan/components/ModeSelector';
import { StaffLocationGate } from '../features/scan/components/StaffLocationGate';
import { CameraScannerCard } from '../features/scan/components/CameraScannerCard';
import { ManualInput } from '../features/scan/components/ManualInput';
import { CouponResult } from '../features/scan/components/CouponResult';
import { UserResult } from '../features/scan/components/UserResult';
import { Button } from '../components/ui/button';
import type { CouponType } from '../types/coupon';
import { isCouponActive } from '../lib/coupons';
import { useAuth } from '../hooks/use-auth';
import { getRolesForContext } from '../lib/authz';
import type { ScanPath } from '../lib/posthog';

const DEFAULT_CYCLE_SIZE = 15;

// How the customer/coupon on screen got here, for analytics, when it came in
// through the URL: the CRM tags its link with 'crm'. Camera/manual scans stay
// in-page and set the path from the scanner mode instead.
function scanPathFromUrl(): ScanPath | undefined {
  const via = new URLSearchParams(window.location.search).get('via');
  return via === 'crm' || via === 'qr_camera' || via === 'qr_manual' ? via : undefined;
}

// A `customer` param is a user id, or a legacy serialized object carrying one.
function customerIdFromParam(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.startsWith('{')) {
      const legacy = JSON.parse(decoded);
      const legacyId = legacy.id || legacy.userId;
      if (legacyId) return String(legacyId);
    }
    return decoded;
  } catch {
    return value;
  }
}

function toScannedCoupon(coupon: CouponType): CouponType {
  return {
    ...coupon,
    id: coupon.id ?? coupon.code,
    qrCode: coupon.qrCode ?? coupon.code,
  };
}

function normalizeScannedUser(rawUser: any, options: { userId: string; fallback?: any; progression?: { stampsLastPrize?: number; stampsNextPrize?: number; nextPrizeName?: string } }) {
  const fallback = options?.fallback ?? {};
  const profile = rawUser?.profile ?? fallback.profile ?? {};
  const nameParts = [profile.name, profile.surname].filter((p: any) => typeof p === 'string' && p.trim() !== '');
  const emailCandidate = rawUser?.email ?? fallback.email;
  const derivedFallbackName = typeof emailCandidate === 'string' ? emailCandidate.split('@')[0] : undefined;
  const fallbackName = typeof fallback?.name === 'string' && fallback.name.trim().length > 0 ? fallback.name : derivedFallbackName;
  const name = (nameParts.length ? nameParts.join(' ').trim() : fallbackName) || 'Utente';

  const email = rawUser?.email ?? fallback.email ?? undefined;
  const phone = rawUser?.phone ?? fallback.phone ?? undefined;

  const validStamps = Number(rawUser?.stamps?.validStamps ?? rawUser?.stamps ?? fallback.validStamps ?? fallback.stamps ?? 0) || 0;
  const usedStamps = Number(rawUser?.stamps?.usedStamps ?? fallback.usedStamps ?? 0) || 0;
  const totalStamps = Number(rawUser?.stamps?.totalStamps ?? fallback.totalStamps ?? validStamps + usedStamps) || 0;

  const couponsData = rawUser?.coupons ?? {};
  const validCoupons = Number(couponsData.validCoupons ?? fallback.validCoupons ?? 0) || 0;
  const usedCoupons = Number(couponsData.usedCoupons ?? fallback.usedCoupons ?? 0) || 0;
  const totalCoupons = Number(couponsData.totalCoupons ?? fallback.totalCoupons ?? validCoupons + usedCoupons) || 0;

  const lastPrizeRaw = options?.progression?.stampsLastPrize ?? rawUser?.nextPrize?.stampsLastPrize ?? fallback.stampsLastPrize ?? 0;
  const nextPrizeRaw = options?.progression?.stampsNextPrize ?? rawUser?.nextPrize?.stampsNextPrize ?? fallback.stampsNextPrize ?? (lastPrizeRaw + DEFAULT_CYCLE_SIZE);

  let stampsLastPrize = Number(lastPrizeRaw);
  if (!Number.isFinite(stampsLastPrize) || stampsLastPrize < 0) {
    stampsLastPrize = 0;
  }

  // Resolve the next-prize target. Trust the upstream value only when it
  // points to a sane forward target — above validStamps and within one
  // CYCLE_SIZE of the user's current position. Otherwise re-anchor to the
  // next CYCLE_SIZE boundary above validStamps.
  //
  // Why: chepizza returns stampsLastPrize == stampsNextPrize for users past
  // the only configured prize. legacy-api-adapter.getPrizeProgression bumps
  // stampsNextPrize by CYCLE_SIZE in that case so callers always see a
  // forward target — but for a user mid-cycle (validStamps low after a
  // coupon redemption) that bump points one full cycle past their actual
  // position, producing "1 / 30" instead of "1 / 15". The cycleBase
  // normalization below used to mask this; this anchoring makes the intent
  // explicit and matches the customer.tsx logic.
  let stampsNextPrize = Number(nextPrizeRaw);
  const candidateForward = Number.isFinite(stampsNextPrize)
    && stampsNextPrize > validStamps
    && stampsNextPrize - validStamps <= DEFAULT_CYCLE_SIZE;
  if (!candidateForward) {
    const positionInCycle = validStamps % DEFAULT_CYCLE_SIZE;
    stampsNextPrize = validStamps + (positionInCycle === 0 ? DEFAULT_CYCLE_SIZE : DEFAULT_CYCLE_SIZE - positionInCycle);
    stampsLastPrize = Math.max(0, stampsNextPrize - DEFAULT_CYCLE_SIZE);
  }

  const cycleSize = Math.max(1, stampsNextPrize - stampsLastPrize);
  const cycleBase = Math.max(0, validStamps - (validStamps % cycleSize));
  const normalizedLastPrize = Math.max(0, Math.min(stampsLastPrize, cycleBase));
  const normalizedNextPrize = normalizedLastPrize + cycleSize;
  const currentProgress = Math.max(0, validStamps - normalizedLastPrize);
  const progressInCycle = cycleSize > 0 ? (currentProgress % cycleSize) : 0;
  const stampsToNext = Math.max(0, cycleSize - progressInCycle);

  const nextPrizeName = options?.progression?.nextPrizeName
    ?? rawUser?.nextPrize?.name
    ?? fallback.nextPrizeName
    ?? 'Prossimo premio';

  return {
    id: String(options.userId),
    name,
    email,
    phone,
    stamps: validStamps,
  validStamps,
  totalStamps,
  totalCoupons,
  validCoupons,
  totalNeededStamps: cycleSize,
  stampsLastPrize: normalizedLastPrize,
  stampsNextPrize: normalizedNextPrize,
    stampsCycleSize: cycleSize,
    stampsProgress: progressInCycle,
    stampsToNext,
    nextPrizeName,
  };
}

export default function ScanQRPage() {
  const [location, navigate] = useLocation();
  const [qrInput, setQrInput] = useState('');
  const [scannedUser, setScannedUser] = useState(null as any);
  const [scannedCoupon, setScannedCoupon] = useState(null as CouponType | null);
  const [firstValidCouponCode, setFirstValidCouponCode] = useState(null as string | null);
  const [scanMode, setScanMode] = useState('camera' as 'camera' | 'manual');
  const [stampCounter, setStampCounter] = useState(1);
  const [fromCRM, setFromCRM] = useState(false);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  // Honoring an expired coupon is a manager-level override.
  const isManager = getRolesForContext(user as any).some((r) => r === 'manager' || r === 'admin');

  // Extract query params (supports legacy serialized object)
  const [userIdParam, setUserIdParam] = useState(null as string | null);
  const [couponParam, setCouponParam] = useState(null as string | null);
  const [resolvingScan, setResolvingScan] = useState(false);
  // Synchronous guard: the camera can fire twice before a re-render lands.
  const scanInFlightRef = useRef(false);
  // Analytics path of the customer/coupon on screen (see scanPathFromUrl).
  const scanPathRef = useRef(undefined as ScanPath | undefined);
  // Bumped on every new customer/coupon/reset so late answers for the previous one are dropped.
  const loadSeqRef = useRef(0);
  // The scanner stops after each read; remounting it restarts the camera after a read that led nowhere.
  const [scannerKey, setScannerKey] = useState(0);
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const rawCustomer = urlParams.get('customer');
    const rawCoupon = urlParams.get('coupon');
    const comingFromCRM = !!rawCustomer || !!rawCoupon;

    setFromCRM(comingFromCRM);
    if (comingFromCRM) scanPathRef.current = scanPathFromUrl();
    // Do not force manual mode if we already have a customer id; keep camera unless explicitly no params
    if (!comingFromCRM) {
      setScanMode('camera');
    }

    if (!comingFromCRM) {
      setUserIdParam(null);
      setCouponParam(null);
      return;
    }

    setUserIdParam(null);
    setCouponParam(null);

    if (rawCoupon) {
      try {
        const decoded = decodeURIComponent(rawCoupon);
        setCouponParam(decoded);
      } catch {
        setCouponParam(rawCoupon);
      }
    }

    if (rawCustomer) {
      setUserIdParam(customerIdFromParam(rawCustomer));
    }
  }, [location]);

  // Query user only if userId param provided
  const userQuery = useQuery({
    queryKey: ['scanQrUser', userIdParam],
    queryFn: () => getUser(userIdParam!),
    enabled: !!userIdParam,
    staleTime: 30_000,
    // The page no longer reloads after applying stamps; a focus refetch would
    // repaint the customer from user-service counters that may still be syncing.
    refetchOnWindowFocus: false,
  });

  // Show a customer: the user-service record we already have, then their
  // coupons and prize progression from chepizza-business.
  const loadCustomer = useCallback((userId: string, data: any) => {
    const seq = ++loadSeqRef.current;
    const userIdForProgress = String(data?.id || data?.userId || userId);
    const baseUser = normalizeScannedUser(data, { userId: userIdForProgress });

    setScannedCoupon(null);
    setScannedUser(baseUser);
    setFirstValidCouponCode(null);
    setStampCounter(1);

    // Phase 2.6 removed the chepizza coupon fan-out from the user-service
    // response, so `data.coupons.coupons` is always empty here. Fetch coupons
    // directly from chepizza-business (same pattern as customer.tsx) so the
    // "Visualizza Coupon Disponibile" one-click redeem shortcut reappears when
    // freshly-added stamps have earned a coupon.
    (async () => {
      try {
        const coupons = await getUserCoupons(userIdForProgress);
        if (seq !== loadSeqRef.current) return;
        // Only surface coupons the customer can actually use (unredeemed AND
        // unexpired) — same rule as customer.tsx, so staff don't see/redeem a
        // coupon that's expired and hidden from the customer.
        const firstValid = (coupons ?? []).find((c: any) => c && c.code && isCouponActive(c));
        setFirstValidCouponCode(firstValid ? String(firstValid.code) : null);
      } catch {
        if (seq !== loadSeqRef.current) return;
        setFirstValidCouponCode(null);
      }
    })();

    (async () => {
      try {
        const progression = await getPrizeProgression(userIdForProgress);
        if (seq !== loadSeqRef.current) return;
        // Only the thresholds come from here; counts stay whatever is on screen,
        // which may already include stamps applied meanwhile.
        setScannedUser((prev: any) => normalizeScannedUser(null, {
          userId: userIdForProgress,
          fallback: prev ?? baseUser,
          progression,
        }));
      } catch {
        if (seq !== loadSeqRef.current) return;
        setScannedUser((prev: any) => prev ?? baseUser);
      }
    })();
  }, []);

  const showCoupon = useCallback((coupon: CouponType) => {
    loadSeqRef.current++;
    setScannedUser(null);
    setFirstValidCouponCode(null);
    setScannedCoupon(toScannedCoupon(coupon));
  }, []);

  // Customer opened from the CRM link (/scan-qr?customer=…&via=crm)
  useEffect(() => {
    if (!userQuery.data || !userIdParam) return;
    loadCustomer(userIdParam, userQuery.data);
  }, [userQuery.data, userIdParam, loadCustomer]);

  useEffect(() => {
    if (!couponParam) return;
    let cancelled = false;
    setResolvingScan(true);
    const code = couponParam.trim();
    if (!code) {
      setScannedCoupon(null);
      setFirstValidCouponCode(null);
      setScannedUser(null);
      setResolvingScan(false);
      navigate('/scan-qr', { replace: true });
      return;
    }
    (async () => {
      try {
        const coupon = await getCouponByCode(code);
        if (!coupon) {
          if (!cancelled) {
            setScannedCoupon(null);
            setFirstValidCouponCode(null);
            setScannedUser(null);
            toast({
              title: 'Coupon non trovato',
              description: 'Nessun coupon valido corrisponde al codice inserito.',
              variant: 'destructive',
            });
            navigate('/scan-qr', { replace: true });
          }
          return;
        }
        if (cancelled) return;
        showCoupon(coupon);
      } catch (error: any) {
        if (cancelled) return;
          const message = error?.message ?? 'Impossibile verificare il coupon. Riprova.';
        setScannedCoupon(null);
        setFirstValidCouponCode(null);
    setScannedUser(null);
        toast({
          title: 'Errore nel recupero del coupon',
          description: message,
          variant: 'destructive',
        });
        navigate('/scan-qr', { replace: true });
      } finally {
        if (!cancelled) setResolvingScan(false);
      }
    })();
    return () => {
      cancelled = true;
      setResolvingScan(false);
    };
  }, [couponParam, navigate, toast, showCoupon]);

  useEffect(() => {
    if (!couponParam) {
      setScannedCoupon(null);
      setResolvingScan(false);
      setFirstValidCouponCode(null);
    }
  }, [couponParam]);

  // Removed manual fetchUser in favor of React Query getUser

  const addStampsMutation = useMutation({
    mutationFn: async ({ userId, stamps }: { userId: string; stamps: number }) => {
      // Use backend base via http client (api.fidelity.chepizzadasalva.it)
      const badIds = new Set(['', 'undefined', 'null', 'NaN']);
      if (userId === undefined || userId === null || badIds.has(String(userId).trim())) {
        throw new Error('User ID mancante per aggiunta timbri');
      }
      const endpointUserId = String(userId).trim();
      return addStampsLegacy(endpointUserId, Number(stamps), scanPathRef.current);
    },
    onSuccess: (result: ApplyStampsResult) => {
      // Redraw from the apply response itself: no reload, no extra user fetch.
      setScannedUser((prev: any) => prev && normalizeScannedUser({ stamps: { validStamps: result.validStamps } }, {
        userId: prev.id,
        fallback: prev,
        progression: result.nextPrize
          ? {
              stampsLastPrize: result.nextPrize.stampsLastPrize,
              stampsNextPrize: result.nextPrize.stampsNextPrize,
              nextPrizeName: result.nextPrize.name ?? prev.nextPrizeName,
            }
          : undefined,
      }));
      if (result.createdCoupon?.code) {
        setFirstValidCouponCode(String(result.createdCoupon.code));
      }
      setStampCounter(1);
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/overview"] });
      toast({
        title: "Timbri aggiornati",
        description: result.createdCoupon
          ? `Nuovo coupon guadagnato! 🎉`
          : `Totale timbri: ${result.validStamps}`,
      });
    },
  onError: (error: any) => {
      console.error('[addStamps][onError]', error);
      toast({
        title: "Errore nell'aggiungere i timbri",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const redeemCouponMutation = useMutation({
    mutationFn: async ({ coupon, override }: { coupon: CouponType; override?: boolean }) => {
      const targetId = coupon?.id ?? null;
      if (!targetId) {
        throw new Error('Impossibile riscattare il coupon senza un identificativo valido.');
      }
      await redeemCouponLegacy(targetId, { override, path: scanPathRef.current });
      return { code: coupon.code ?? coupon.qrCode ?? String(targetId), isRedeemed: true, redeemedAt: new Date().toISOString() };
    },
    onSuccess: (redeemedCoupon: { code: string; isRedeemed: boolean; redeemedAt?: string }, variables: { coupon: CouponType; override?: boolean }) => {
      setScannedCoupon((prev: CouponType | null) => {
        if (!prev) return prev;
        return {
          ...prev,
          isRedeemed: true,
          redeemedAt: redeemedCoupon.redeemedAt ? new Date(redeemedCoupon.redeemedAt) : new Date(),
        };
      });
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/overview"] });
      
      toast({
        title: variables.coupon.prize?.name ? `Coupon riscattato: ${variables.coupon.prize.name}` : "Coupon riscattato!",
        description: "Il coupon è stato utilizzato con successo. Buon appetito! 🍕",
      });
    },
  onError: (error: any, variables: { coupon: CouponType; override?: boolean }) => {
      const code = error?.body?.error ?? null;

      // Already redeemed — never overridable.
      if (code === 'ALREADY_REDEEMED') {
        toast({ title: 'Coupon già utilizzato', description: 'Questo coupon è già stato riscattato.', variant: 'destructive' });
        return;
      }

      // Expired — block by default; a manager can explicitly honor it.
      if (code === 'COUPON_EXPIRED' && !variables?.override) {
        const expDate = error?.body?.expiredAt ? new Date(error.body.expiredAt).toLocaleDateString('it-IT') : null;
        if (!isManager) {
          toast({
            title: 'Coupon scaduto',
            description: `Coupon scaduto${expDate ? ` il ${expDate}` : ''}. Chiedi a un responsabile per convalidarlo.`,
            variant: 'destructive',
          });
          return;
        }
        const ok = window.confirm(`Coupon scaduto${expDate ? ` il ${expDate}` : ''}. Convalidare comunque?`);
        if (ok) {
          redeemCouponMutation.mutate({ coupon: variables.coupon, override: true });
        }
        return;
      }

      const errorMessage = error?.message || "Errore durante il riscatto del coupon.";
      const requiresEmailVerification = error?.requiresEmailVerification;
      toast({
        title: requiresEmailVerification ? "Verifica Email Richiesta" : "Errore nel riscatto",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleRedeemCoupon = () => {
    if (!scannedCoupon) return;
    if (!scannedCoupon.id) {
      toast({
        title: 'Coupon non valido',
        description: 'Il coupon selezionato non contiene un identificativo valido.',
        variant: 'destructive',
      });
      return;
    }
    redeemCouponMutation.mutate({ coupon: scannedCoupon, override: false });
  };

  const handleScan = useCallback(async (qrCode?: string) => {
    const raw = (qrCode || qrInput).trim();
    if (!raw) {
      toast({
        title: "Codice QR non valido",
        description: "Riprova a scansionare il codice QR.",
        variant: "destructive",
      });
      return;
    }
    if (scanInFlightRef.current) return;
    scanInFlightRef.current = true;
    setResolvingScan(true);
    const via: ScanPath = scanMode === 'manual' ? 'qr_manual' : 'qr_camera';
    let shown = false;

    try {
      // A full scan-qr URL (customer or coupon) says what it is; a bare code doesn't.
      let code = raw;
      let kind: 'customer' | 'coupon' | null = null;
      if (/scan-qr\?(customer|coupon)=/.test(raw)) {
        try {
          const url = new URL(raw, window.location.origin);
          const customer = url.searchParams.get('customer');
          const coupon = url.searchParams.get('coupon');
          if (customer) {
            kind = 'customer';
            code = customerIdFromParam(customer);
          } else if (coupon) {
            kind = 'coupon';
            code = coupon.trim();
          }
        } catch {
          // Not parseable: fall through and classify the raw text.
        }
      }

      // Attempt to classify: try fetching user; if success treat as user else coupon
      if (kind !== 'coupon') {
        let user: any = null;
        try {
          user = await getUser(code); // throws if not a user
        } catch {
          user = null;
        }
        if (user) {
          scanPathRef.current = via;
          loadCustomer(code, user);
          shown = true;
          return;
        }
        if (kind === 'customer') {
          toast({
            title: 'Cliente non trovato',
            description: 'Il QR non corrisponde a nessun cliente.',
            variant: 'destructive',
          });
          return;
        }
      }

      try {
        const coupon = await getCouponByCode(code);
        if (!coupon) {
          toast({
            title: 'Coupon non trovato',
            description: 'Verifica il codice inserito e riprova.',
            variant: 'destructive',
          });
          return;
        }
        scanPathRef.current = via;
        showCoupon(coupon);
        shown = true;
      } catch (error: any) {
        toast({
          title: 'Errore nel recupero del coupon',
          description: error?.message ?? 'Impossibile verificare il coupon. Riprova.',
          variant: 'destructive',
        });
      }
    } finally {
      scanInFlightRef.current = false;
      setResolvingScan(false);
      if (!shown && qrCode) setScannerKey((k: number) => k + 1);
    }
  }, [qrInput, scanMode, toast, loadCustomer, showCoupon]);

  const onQRScanned = useCallback((result: string) => {
    handleScan(result);
  }, [handleScan]);

  const onScanError = useCallback((error: string) => {
    toast({
      title: "Errore Scansione",
      description: error,
      variant: "destructive",
    });
  }, [toast]);

  const addStamps = () => {
    console.log('[addStamps][handler] clicked', { scannedUser, stampCounter });
    if (!scannedUser) {
      console.log('[addStamps][handler] aborted: no scannedUser');
      return;
    }
    const uidRaw = scannedUser.id || scannedUser.userId;
    const uid = String(uidRaw ?? '').trim();
    if (!uid) {
      console.warn('[addStamps][handler] aborted: missing user id', scannedUser);
      toast({ title: "ID utente mancante", description: "Seleziona o scansiona un utente valido prima di aggiungere timbri.", variant: "destructive" });
      return;
    }
    const badIds = new Set(['undefined', 'null', 'NaN']);
    if (badIds.has(uid)) {
      console.warn('[addStamps][handler] aborted: user id is invalid literal', { uid, scannedUser });
      toast({ title: "ID utente non valido", description: "Il codice utente non è valido (undefined/null/NaN).", variant: "destructive" });
      return;
    }
    addStampsMutation.mutate({ userId: uid, stamps: stampCounter });
  };

  const incrementStamps = () => {
    setStampCounter((prev: number) => Math.min(prev + 1, 50)); // Max 50 stamps
  };

  const decrementStamps = () => {
    setStampCounter((prev: number) => Math.max(prev - 1, 1)); // Stamps can only be added
  };

  const reset = () => {
    loadSeqRef.current++;
    setQrInput("");
    setScannedUser(null);
    setScannedCoupon(null);
    setFirstValidCouponCode(null);
    setStampCounter(1);
    setFromCRM(false);
    setScanMode('camera');
    setResolvingScan(false);
    // Remove any CRM query params and stay on scan page
    if (window.location.search) {
      navigate('/scan-qr', { replace: true });
    }
  };

  const viewAvailableCoupon = async () => {
    if (!firstValidCouponCode) return;
    try {
      const coupon = await getCouponByCode(firstValidCouponCode);
      if (!coupon) {
        toast({
          title: 'Coupon non trovato',
          description: 'Nessun coupon valido corrisponde al codice inserito.',
          variant: 'destructive',
        });
        return;
      }
      showCoupon(coupon);
    } catch (error: any) {
      toast({
        title: 'Errore nel recupero del coupon',
        description: error?.message ?? 'Impossibile verificare il coupon. Riprova.',
        variant: 'destructive',
      });
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-6 min-h-screen">
      {/* Staff location gate (BRAND-scoped multi-location only): badge + daily picker */}
      <StaffLocationGate />

      {/* Top actions */}
      <div className="flex items-center justify-between mb-6">
        {fromCRM && (
          <Link href="/crm">
            <Button variant="outline">
              Vai al CRM
            </Button>
          </Link>
        )}

        {(!!scannedUser || !!scannedCoupon) && (
          <Button variant="outline" onClick={reset}>Scansiona altro cliente</Button>
        )}
      </div>

      {/* Header */}
      {!fromCRM && (
        <div className="text-center mb-8">
          <h1 className="text-3xl font-bold text-gray-900 mb-2">Scanner QR Cliente</h1>
          <p className="text-gray-600">Scansiona il QR del cliente per aggiungere timbri</p>
        </div>
      )}

      {!scannedUser && !scannedCoupon ? (
        <div className="space-y-6">
          {/* Mode Selector */}
          <ModeSelector mode={scanMode} onChange={setScanMode} />

  {scanMode === 'camera'
            ? <CameraScannerCard key={scannerKey} onScan={onQRScanned} onError={onScanError} />
            : <ManualInput value={qrInput} onChange={setQrInput} onSubmit={() => handleScan()} loading={resolvingScan} />}
        </div>
      ) : scannedCoupon ? (
        <CouponResult coupon={scannedCoupon} onRedeem={handleRedeemCoupon} loading={redeemCouponMutation.isPending} onReset={reset} />
      ) : (
        scannedUser && (
          <div className="space-y-4">
            <UserResult user={scannedUser} stampCounter={stampCounter} onInc={incrementStamps} onDec={decrementStamps} onApply={addStamps} applying={addStampsMutation.isPending} onReset={reset} />
            {firstValidCouponCode && (
              <div className="text-center">
                <Button
                  variant="outline"
                  onClick={viewAvailableCoupon}
                >
                  Visualizza Coupon Disponibile
                </Button>
              </div>
            )}
          </div>
        )
      )}
    </div>
  );
}
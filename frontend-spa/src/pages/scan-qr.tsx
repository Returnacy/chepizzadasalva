// @ts-nocheck
// Refactored Scan QR page into feature components
import { useState, useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { getUser, addStamps as addStampsLegacy, getPrizeProgression, getCouponByCode, redeemCoupon as redeemCouponLegacy } from '../lib/legacy-api-adapter';
import { useToast } from '../hooks/use-toast';
import { useLocation, Link } from 'wouter';
import { ModeSelector } from '../features/scan/components/ModeSelector';
import { CameraScannerCard } from '../features/scan/components/CameraScannerCard';
import { ManualInput } from '../features/scan/components/ManualInput';
import { CouponResult } from '../features/scan/components/CouponResult';
import { UserResult } from '../features/scan/components/UserResult';
import { Button } from '../components/ui/button';
import type { CouponType } from '../types/coupon';

const DEFAULT_CYCLE_SIZE = 15;

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

  let stampsNextPrize = Number(nextPrizeRaw);
  if (!Number.isFinite(stampsNextPrize) || stampsNextPrize <= stampsLastPrize) {
    stampsNextPrize = stampsLastPrize + DEFAULT_CYCLE_SIZE;
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

  // Extract query params (supports legacy serialized object)
  const [userIdParam, setUserIdParam] = useState(null as string | null);
  const [couponParam, setCouponParam] = useState(null as string | null);
  const [resolvingScan, setResolvingScan] = useState(false);
  useEffect(() => {
    const urlParams = new URLSearchParams(window.location.search);
    const rawCustomer = urlParams.get('customer');
    const rawCoupon = urlParams.get('coupon');
    const comingFromCRM = !!rawCustomer || !!rawCoupon;

    setFromCRM(comingFromCRM);
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
      try {
        const decoded = decodeURIComponent(rawCustomer);
        if (decoded.startsWith('{')) {
          const legacy = JSON.parse(decoded);
          const legacyId = legacy.id || legacy.userId;
          if (legacyId) {
            setUserIdParam(String(legacyId));
            return;
          }
        }
        setUserIdParam(decoded);
      } catch {
        setUserIdParam(rawCustomer);
      }
    }
  }, [location]);

  // Query user only if userId param provided
  const userQuery = useQuery({
    queryKey: ['scanQrUser', userIdParam],
    queryFn: () => getUser(userIdParam!),
    enabled: !!userIdParam,
    staleTime: 30_000,
  });

  // Map query data to scannedUser when from CRM (don't overwrite if a QR scan already set a user)
  useEffect(() => {
    if (!userQuery.data || !userIdParam) return;
    let cancelled = false;
    const data: any = userQuery.data as any;
    const userIdForProgress = String(data.id || data.userId || userIdParam);
    const baseUser = normalizeScannedUser(data, { userId: userIdForProgress });

    setScannedCoupon(null);
    setScannedUser(baseUser);

    try {
      const couponsArr = data.coupons?.coupons || [];
      const firstValid = couponsArr.find((c: any) => c && c.code && (c.isRedeemed === false || c.isRedeemed === undefined));
      setFirstValidCouponCode(firstValid ? String(firstValid.code) : null);
    } catch {
      setFirstValidCouponCode(null);
    }

    (async () => {
      try {
        const progression = await getPrizeProgression(userIdForProgress);
        if (cancelled) return;
        setScannedUser((prev: any) => normalizeScannedUser(data, {
          userId: userIdForProgress,
          fallback: prev ?? baseUser,
          progression,
        }));
      } catch {
        if (cancelled) return;
        setScannedUser((prev: any) => prev ?? baseUser);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [userQuery.data, userIdParam]);

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
        setScannedUser(null);
        setFirstValidCouponCode(null);
        setScannedCoupon({
          ...coupon,
          id: coupon.id ?? coupon.code,
          qrCode: coupon.qrCode ?? coupon.code,
        });
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
  }, [couponParam, navigate, toast]);

  useEffect(() => {
    if (!couponParam) {
      setScannedCoupon(null);
      setResolvingScan(false);
      setFirstValidCouponCode(null);
    }
  }, [couponParam]);

  // Removed manual fetchUser in favor of React Query getUser

  // Removed legacy lookup endpoints; QR code now drives direct redirect

  const addStampsMutation = useMutation({
    mutationFn: async ({ userId, stamps }: { userId: string; stamps: number }) => {
      // Use backend base via http client (api.fidelity.chepizzadasalva.it)
      console.log('[addStamps][mutationFn] invoked', { userId, stamps, type: typeof userId });
      const badIds = new Set(['', 'undefined', 'null', 'NaN']);
      if (userId === undefined || userId === null || badIds.has(String(userId).trim())) {
        console.error('[addStamps][mutationFn] abort: invalid userId', userId);
        throw new Error('User ID mancante per aggiunta timbri');
      }
      const endpointUserId = String(userId).trim();
      const updated = await addStampsLegacy(endpointUserId, Number(stamps));
      window.location.reload(); // Reload to refresh user data
      console.log('[addStamps][mutationFn] response', updated);
      return updated;
    },
    onSuccess: (updatedUser: any) => {
      const prevState: any = scannedUser;
      const preservedId = prevState?.id ?? String(updatedUser?.id ?? updatedUser?.userId ?? '');
      const previousStampCount = Math.max(0, prevState?.validStamps ?? prevState?.stamps ?? 0);
      const normalized = normalizeScannedUser(updatedUser ?? {}, {
        userId: preservedId,
        fallback: prevState,
        progression: {
          stampsLastPrize: updatedUser?.nextPrize?.stampsLastPrize ?? prevState?.stampsLastPrize,
          stampsNextPrize: updatedUser?.nextPrize?.stampsNextPrize ?? prevState?.stampsNextPrize,
          nextPrizeName: updatedUser?.nextPrize?.name ?? prevState?.nextPrizeName,
        },
      });
      const newStampCount = Math.max(0, normalized?.validStamps ?? normalized?.stamps ?? previousStampCount);
      const cycleSize = Math.max(1, normalized?.stampsCycleSize ?? normalized?.totalNeededStamps ?? DEFAULT_CYCLE_SIZE);

      setScannedUser(normalized);
      queryClient.invalidateQueries({ queryKey: ["/api/analytics/overview"] });
      const newCoupons = Math.floor(newStampCount / cycleSize) - Math.floor(previousStampCount / cycleSize);
      toast({
        title: "Timbri aggiornati",
        description: newCoupons > 0
          ? `${newCoupons} nuovo coupon guadagnato! 🎉`
          : `Totale timbri: ${newStampCount}`,
      });
      console.log('[addStamps][onSuccess]', { previousStampCount, newStampCount, updatedUser });
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
    mutationFn: async (coupon: CouponType) => {
      const targetId = coupon?.id ?? null;
      if (!targetId) {
        throw new Error('Impossibile riscattare il coupon senza un identificativo valido.');
      }
      await redeemCouponLegacy(targetId);
      return { code: coupon.code ?? coupon.qrCode ?? String(targetId), isRedeemed: true, redeemedAt: new Date().toISOString() };
    },
    onSuccess: (redeemedCoupon: { code: string; isRedeemed: boolean; redeemedAt?: string }) => {
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
        title: "Pizza gratuita riscattata!",
        description: "Il coupon è stato utilizzato con successo. Buon appetito! 🍕",
      });
    },
  onError: (error: any) => {
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
    redeemCouponMutation.mutate(scannedCoupon);
  };

  const handleScan = async (qrCode?: string) => {
    const raw = qrCode || qrInput.trim();
    if (!raw) {
      toast({
        title: "Codice QR non valido",
        description: "Riprova a scansionare il codice QR.",
        variant: "destructive",
      });
      return;
    }
    if (resolvingScan) return;
    setResolvingScan(true);

    try {
      // If already a full scan-qr URL (customer or coupon), normalize and go
      if (/scan-qr\?(customer|coupon)=/.test(raw)) {
        const base = (import.meta as any).env?.VITE_FRONTEND_BASE_URL || window.location.origin;
        try {
          const url = new URL(raw, base);
          window.location.href = url.toString();
        } catch {
          window.location.href = raw;
        }
        return;
      }

      // Attempt to classify: try fetching user; if success treat as user else coupon
      let isUser = false;
      try {
        await getUser(raw); // throws if not a user
        isUser = true;
      } catch (e) {
        isUser = false;
      }
      if (!isUser) {
        try {
          const coupon = await getCouponByCode(raw);
          if (!coupon) {
            toast({
              title: 'Coupon non trovato',
              description: 'Verifica il codice inserito e riprova.',
              variant: 'destructive',
            });
            return;
          }
        } catch (error: any) {
          toast({
            title: 'Errore nel recupero del coupon',
            description: error?.message ?? 'Impossibile verificare il coupon. Riprova.',
            variant: 'destructive',
          });
          return;
        }
      }
      const base = (import.meta as any).env?.VITE_FRONTEND_BASE_URL || window.location.origin;
      const paramName = isUser ? 'customer' : 'coupon';
      const target = `${base.replace(/\/$/, '')}/scan-qr?${paramName}=${encodeURIComponent(raw)}`;
      window.location.href = target;
    } finally {
      setResolvingScan(false);
    }
  };

  const onQRScanned = (result: string) => {
    handleScan(result);
  };

  const onScanError = (error: string) => {
    toast({
      title: "Errore Scansione",
      description: error,
      variant: "destructive",
    });
  };

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
    if (stampCounter === 0) {
      console.log('[addStamps][handler] aborted: stampCounter is 0');
      return;
    }
    addStampsMutation.mutate({ userId: uid, stamps: stampCounter });
  };

  const incrementStamps = () => {
    setStampCounter((prev: number) => Math.min(prev + 1, 50)); // Max 50 stamps
  };

  const decrementStamps = () => {
    setStampCounter((prev: number) => Math.max(prev - 1, -20)); // Allow up to -20 for corrections
  };

  const reset = () => {
    setQrInput("");
    setScannedUser(null);
    setScannedCoupon(null);
    setFromCRM(false);
    setScanMode('camera');
    setResolvingScan(false);
    // Remove any query params and stay on scan page
    navigate('/scan-qr', { replace: true });
  };

  return (
    <div className="max-w-2xl mx-auto p-6 min-h-screen">
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
            ? <CameraScannerCard onScan={onQRScanned} onError={onScanError} />
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
                  onClick={() => {
                    const base = (import.meta as any).env?.VITE_FRONTEND_BASE_URL || window.location.origin;
                    const target = `${base.replace(/\/$/, '')}/scan-qr?coupon=${encodeURIComponent(firstValidCouponCode)}`;
                    window.location.href = target;
                  }}
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
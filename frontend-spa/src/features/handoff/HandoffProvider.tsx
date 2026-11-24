import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../hooks/use-auth';
import { toast } from '../../hooks/use-toast';
import { ToastAction } from '../../components/ui/toast';
import { queryClient } from '../../lib/queryClient';
import { tokenService } from '../../lib/token-service';
import {
  getPendingHandoff,
  resetHandoffInFlight,
  runHandoff,
  type HandoffFailure,
  type HandoffSource,
} from './handoff';

type HandoffContextValue = { start: (target: string, source: HandoffSource) => void };

const HandoffContext = createContext(null as HandoffContextValue | null);

export function useHandoff(): HandoffContextValue {
  const ctx = useContext(HandoffContext);
  if (!ctx) throw new Error('useHandoff must be used within a HandoffProvider');
  return ctx;
}

// Same rule as TermsConsentDialog: until terms and privacy are accepted the
// customer cannot use the app, so a pending handoff waits for that too.
function hasAcceptedTerms(user: any): boolean {
  const ua = user?.userAgreement;
  return !!ua?.termsOfService && !!ua?.privacyPolicy;
}

function notifyFailure(reason: HandoffFailure, source: HandoffSource, retry: () => void) {
  switch (reason) {
    case 'UNKNOWN_HANDOFF_TARGET':
      // From a link: an old or unknown target, nothing the customer can do —
      // they simply carry on to their page. From the card, a click must
      // never do nothing.
      if (source === 'card') {
        toast({ title: 'Servizio non disponibile', description: 'Riprova più tardi.' });
      }
      return;
    case 'FORBIDDEN':
      toast({
        title: 'Accesso non consentito',
        description: 'Con questo account non è possibile proseguire verso il servizio richiesto.',
      });
      return;
    case 'UNAUTHENTICATED':
      // Session gone: back to the normal login.
      tokenService.clearAccessToken();
      tokenService.clearRefreshToken();
      queryClient.setQueryData(['/me'], null);
      return;
    default:
      toast({
        title: 'Collegamento non riuscito',
        description: 'Non siamo riusciti a portarti a destinazione. Controlla la connessione e riprova.',
        action: (
          <ToastAction altText="Riprova" onClick={retry}>
            Riprova
          </ToastAction>
        ),
      });
  }
}

/**
 * Where "this customer is now authenticated" turns into "take them to the
 * handoff target" instead of their card. Every way in — password login,
 * registration, Google, a reload with a live session — ends with useAuth()
 * holding a user; this is the one place that reacts to it. (use-auth skips its
 * post-login hard redirect while a handoff is pending, so the two do not race.)
 *
 * The server decides who may go where: no role check here.
 */
export function HandoffProvider({ children }: { children: ReactNode }) {
  const { user, isLoading } = useAuth();
  const [busy, setBusy] = useState(false);

  const start = useCallback(
    async (target: string, source: HandoffSource) => {
      setBusy(true);
      const result = await runHandoff(target, source);
      if (!result || result.ok) return; // already running, or leaving the page
      setBusy(false);
      notifyFailure(result.reason, source, () => void start(target, source));
    },
    [],
  );

  const ready = !!user && !isLoading && hasAcceptedTerms(user);
  const pendingTarget = ready ? getPendingHandoff() : null;

  useEffect(() => {
    if (pendingTarget) void start(pendingTarget, 'link');
  }, [pendingTarget, start]);

  // Back button from the other service may restore this page from bfcache,
  // frozen mid-handoff: give it back to the customer.
  useEffect(() => {
    const onPageShow = (e: PageTransitionEvent) => {
      if (!e.persisted) return;
      resetHandoffInFlight();
      setBusy(false);
    };
    window.addEventListener('pageshow', onPageShow);
    return () => window.removeEventListener('pageshow', onPageShow);
  }, []);

  return (
    <HandoffContext.Provider value={{ start }}>
      {children}
      {(busy || pendingTarget) && (
        <div
          role="status"
          aria-live="polite"
          className="fixed inset-0 z-[100] flex flex-col items-center justify-center gap-4 bg-[hsl(var(--brand-dark))] px-6 text-center text-white"
        >
          <Loader2 className="h-8 w-8 animate-spin text-white/80" aria-hidden />
          <p className="text-base font-semibold [text-wrap:balance]">Ti stiamo portando a destinazione…</p>
        </div>
      )}
    </HandoffContext.Provider>
  );
}

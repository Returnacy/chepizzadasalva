import { useState, useEffect } from 'react';
import { useLocation, Link } from 'wouter';
import { type LoginInput } from '../schema/login/login.schema';
import { type SignupInput } from '../schema/signup/signup.schema';
import { useAuth } from '../hooks/use-auth';
// Google signup now uses official GIS button; login flow remains unchanged for now
import { Tabs, TabsContent, TabsList, TabsTrigger } from '../components/ui/tabs';
import { useLoginForm, useRegisterForm, useAuthMethodToggle, RegistrationFormValues } from '../features/auth/hooks/useAuthForms';
import { LoginForm } from '../features/auth/components/LoginForm';
import { RegisterForm } from '../features/auth/components/RegisterForm';
import { useToast } from '../hooks/use-toast';
import { tokenService } from '../lib/token-service';
import { BRAND } from '../config/brand';
import { getGoogleClientId, isGoogleLoginEnabled } from '../lib/brand-flags';
import loyaltyLogo from '@assets/che_pizza_fidelity_logo_horizontal.png';

// Segmented-control trigger: transparent, so the sliding white pill behind it shows.
const segTrigger = 'relative z-10 rounded-[9px] py-[9px] text-sm font-semibold text-[#6b665d] transition-none data-[state=active]:bg-transparent data-[state=active]:text-[#1d1b18] data-[state=active]:shadow-none auth-seg-tab';

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { user, loginMutation, registerMutation } = useAuth();
  const { toast } = useToast();

  // Method toggles now managed via custom hook (removed local duplicates)

  const googleClientId = getGoogleClientId();
  // Off unless this brand's origin has been authorised in the Google console
  // and the build says so: see src/lib/brand-flags.ts.
  const googleEnabled = isGoogleLoginEnabled();
  // State for GIS and active tab
  const [gisReady, setGisReady] = useState(false);
  const [activeTab, setActiveTab] = useState('login' as 'login' | 'register');

  const loginForm = useLoginForm();
  const registerForm = useRegisterForm();
  const { loginMethod, setLoginMethod, signupMethod, setSignupMethod } = useAuthMethodToggle();

  // If we come back from a Google redirect flow, tokens are delivered via URL hash.
  // Example: /auth#accessToken=...&refreshToken=...
  useEffect(() => {
    const raw = (typeof window !== 'undefined' ? window.location.hash : '') || '';
    const hash = raw.startsWith('#') ? raw.slice(1) : raw;
    if (!hash) return;
    const params = new URLSearchParams(hash);
    const access = params.get('accessToken') || params.get('access_token');
    const refresh = params.get('refreshToken') || params.get('refresh_token');
    const error = params.get('error');

    if (access) tokenService.setAccessToken(access);
    if (refresh) tokenService.setRefreshToken(refresh);

    if (access || refresh || error) {
      // Clean up URL (avoid keeping tokens in history)
      try {
        window.history.replaceState({}, document.title, window.location.pathname + window.location.search);
      } catch {}
    }

    if (error) {
      toast({
        title: 'Accesso con Google fallito',
        description: error,
        variant: 'destructive',
      });
      return;
    }

    if (access) {
      setLocation('/');
    }
  }, [setLocation, toast]);

  const decodeJwtPayload = (credential: string): Record<string, any> | null => {
    try {
      const parts = credential.split('.');
      if (parts.length < 2) return null;
      const normalized = parts[1].replace(/-/g, '+').replace(/_/g, '/');
      const padLength = (4 - (normalized.length % 4)) % 4;
      const padded = normalized + '='.repeat(padLength);
      const decoded = atob(padded);
      return JSON.parse(decoded);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('Failed to decode Google credential', err);
      return null;
    }
  };

  // If Google isn't configured for this origin, force password flows to avoid disabled register button
  useEffect(() => {
    if (!googleEnabled) {
      setLoginMethod('password');
      setSignupMethod('password');
    }
  }, [googleEnabled, setLoginMethod, setSignupMethod]);

  // Ensure login shows password fields (no toggle UI for login)
  useEffect(() => {
    setLoginMethod('password');
  }, [setLoginMethod]);

  // Ensure register keeps the password submit button available.
  // The method toggle UI was removed, but the value persists in localStorage.
  useEffect(() => {
    setSignupMethod('password');
  }, [setSignupMethod]);

  // Load GIS script once and render the official button for the active tab only
  useEffect(() => {
    if (!googleEnabled) return;
    const appendScript = () => new Promise<void>((resolve) => {
      if ((window as any).google?.accounts?.id) return resolve();
      const existing = document.getElementById('google-identity-services');
      if (existing) return existing.addEventListener('load', () => resolve());
      const s = document.createElement('script');
      s.id = 'google-identity-services';
      s.src = 'https://accounts.google.com/gsi/client';
      s.async = true;
      s.defer = true;
      s.onload = () => resolve();
      document.head.appendChild(s);
    });
    const render = async () => {
      await appendScript();
      const ga = (window as any).google?.accounts?.id;
      if (!ga) return;

      // Clear both containers to avoid duplicate rendering and missing-parent errors
      const loginContainer = document.getElementById('google-login-btn');
      const signupContainer = document.getElementById('google-signup-btn');
      if (loginContainer) loginContainer.innerHTML = '';
      if (signupContainer) signupContainer.innerHTML = '';

      // We only support Google *login* here using redirect mode (avoids COOP/postMessage issues).
      if (activeTab !== 'login') return;
      const containerId = 'google-login-btn';
      const container = document.getElementById(containerId);
      if (!container) return;

      // Use GIS popup mode (same as other business frontends).
      // This avoids needing any Google OAuth "Authorized redirect URIs" entries for user-service.
      const callback = async (resp: any) => {
        const token = resp?.credential;
        if (!token) return;
        const loginValues = loginForm.getValues();
        const payload: LoginInput = {
          authType: 'oauth',
          provider: 'google',
          idToken: token,
          email: loginValues.email || undefined,
        };
        try {
          await loginMutation.mutateAsync(payload);
          setLocation('/');
        } catch {}
      };

      ga.initialize({ client_id: googleClientId, callback, ux_mode: 'popup' });
      ga.renderButton(container, {
        theme: 'outline', size: 'large', type: 'standard', text: activeTab === 'register' ? 'signup_with' : 'signin_with', width: 320,
      });
      setGisReady(true);
    };

    render();
  }, [googleEnabled, googleClientId, activeTab, loginForm, registerForm, loginMutation, registerMutation, setLocation, toast]);

  const onPasswordLogin = async (data: { email: string; password: string }) => {
    const payload: LoginInput = { authType: 'password', email: data.email, password: data.password } as const;
    await loginMutation.mutateAsync(payload);
    setLocation('/');
  };

  const onRegister = async (data: RegistrationFormValues) => {
    // Password signup only; Google is handled by GIS button callback
    if (!data.acceptedTermsAndConditions || !data.acceptedPrivacyPolicy) return;
    if (signupMethod === 'password') {
      const payload: SignupInput = {
        authType: 'password', email: data.email, password: data.password,
        name: data.name, surname: data.surname, birthdate: data.birthdate,
        acceptedTermsAndConditions: data.acceptedTermsAndConditions,
        acceptedPrivacyPolicy: data.acceptedPrivacyPolicy,
        phone: data.phone || undefined,
      } as const;
      await registerMutation.mutateAsync(payload);
      setTimeout(() => setLocation('/'), 400);
    }
  };

  const isRegister = activeTab === 'register';

  return (
    <div className="min-h-screen supports-[height:100dvh]:min-h-dvh flex flex-col lg:grid lg:grid-cols-2">
      {/* Hero: the brand's own loyalty card on its dark colour */}
      <div
        className={`auth-hero relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[hsl(var(--brand-dark))] px-6 pb-[46px] text-center text-white lg:min-h-screen lg:p-12 ${isRegister ? 'pt-8' : 'pt-12'}`}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-[20%] -right-[20%] -top-[40%] h-[120%] lg:inset-0 lg:h-full"
          style={{ background: 'radial-gradient(60% 60% at 50% 35%, hsl(var(--brand-blue) / 0.55) 0%, transparent 70%)' }}
        />
        <img
          src={BRAND.logoUrl || loyaltyLogo}
          alt={`Carta fedeltà ${BRAND.fullName}`}
          className={`auth-card relative mx-auto block -rotate-[4deg] rounded-[14px] shadow-[0_24px_40px_-14px_rgba(0,0,0,0.6)] lg:mb-8 lg:w-[70%] lg:max-w-[340px] ${isRegister ? 'mb-3 w-[46%] max-w-[170px]' : 'mb-[18px] w-[70%] max-w-[250px]'}`}
        />
        <h1 className="relative mb-1 text-[22px] font-bold tracking-[-0.01em] [text-wrap:balance] lg:text-[30px]">
          {BRAND.fullName}
        </h1>
        <p className="relative text-sm text-white/[0.72] lg:text-base">La tua carta fedeltà</p>
      </div>

      {/* Form sheet */}
      <div className="flex flex-none flex-col lg:items-center lg:justify-center lg:bg-gradient-to-br lg:from-[var(--brand-surface-from)] lg:to-[var(--brand-surface-to)] lg:p-8">
        <div className="relative -mt-[22px] flex flex-none flex-col gap-[14px] rounded-t-[26px] bg-white px-[22px] pb-[max(22px,env(safe-area-inset-bottom))] pt-[22px] text-[#1d1b18] lg:mt-0 lg:w-full lg:max-w-md lg:rounded-[26px] lg:shadow-[0_12px_40px_-16px_rgba(0,0,0,0.18)]">
          <Tabs value={activeTab} onValueChange={(v: 'login' | 'register') => setActiveTab(v)} className="flex w-full flex-col gap-[14px]">
            <TabsList className="relative grid h-auto w-full grid-cols-2 rounded-[12px] bg-[#f6f4ef] p-1">
              <span
                aria-hidden
                className="auth-seg-pill absolute left-1 top-1 h-[calc(100%-8px)] w-[calc(50%-4px)] rounded-[9px] bg-white shadow-[0_1px_3px_rgba(0,0,0,0.12)]"
                style={{ transform: isRegister ? 'translateX(100%)' : 'translateX(0)' }}
              />
              <TabsTrigger value="login" className={segTrigger}>
                Accedi
              </TabsTrigger>
              <TabsTrigger value="register" className={segTrigger}>
                Registrati
              </TabsTrigger>
            </TabsList>

            {/* Login Tab */}
            <TabsContent value="login" className="auth-rise mt-0 flex flex-col gap-[14px]">
              <LoginForm
                form={loginForm}
                onSubmit={onPasswordLogin}
                loginMethod={loginMethod}
                toggleMethod={() => {}}
                onGoogle={() => { /* Google login disabled for now */ }}
                loading={loginMutation.isPending}
                googleLoading={!gisReady}
                googleError={null}
              />
              <div className="-mt-1 text-right">
                <Link href="/auth/forgot-password" className="text-[13px] font-medium text-[hsl(var(--brand-dark))] hover:underline">
                  Password dimenticata?
                </Link>
              </div>
              {googleEnabled && (
                <>
                  <div className="flex items-center gap-2.5 text-xs text-[#9a948a] before:h-px before:flex-1 before:bg-[#e4e0d6] before:content-[''] after:h-px after:flex-1 after:bg-[#e4e0d6] after:content-['']">
                    oppure
                  </div>
                  <div id="google-login-btn" className="flex justify-center" />
                </>
              )}
            </TabsContent>

            {/* Register Tab */}
            <TabsContent value="register" className="auth-rise mt-0 flex flex-col gap-[14px]">
              <p className="-mt-1 text-[13px] leading-snug text-[#6b665d]">
                Accumula punti ogni acquisto, e goditi i premi direttamente in cassa. Ci vogliono 30 secondi.
              </p>
              <RegisterForm
                form={registerForm}
                onSubmit={onRegister}
                signupMethod={signupMethod}
                loading={registerMutation.isPending}
                googleError={null}
              />
              {googleEnabled && (
                <div id="google-signup-btn" className="flex justify-center empty:hidden" />
              )}
            </TabsContent>
          </Tabs>

          <p className="pt-4 text-center lg:pt-1.5 text-[11px] tracking-[0.02em] text-[#a39d92]">
            Fidelity by <b className="font-semibold text-[#8a8478]">Returnacy</b>
          </p>
        </div>
      </div>
    </div>
  );

  // Handle redirect after hooks are called
  if (user) {
    setLocation("/");
    return null;
  }
}

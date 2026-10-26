import type { ReactNode } from 'react';
import { BRAND } from '../../../config/brand';
import loyaltyLogo from '@assets/che_pizza_fidelity_logo_horizontal.png';

// The auth-page.tsx look, for the screens around it (password recovery, "not
// enrolled here"): the brand's loyalty card on its dark colour, a white sheet
// underneath, the Returnacy signature at the bottom.

// Sheet field styling, same values as LoginForm/RegisterForm.
export const authLabel = 'text-xs font-semibold uppercase tracking-[0.05em] text-[#6b665d]';
export const authInput = 'h-12 min-w-0 rounded-[12px] border-[#e4e0d6] bg-[#f6f4ef] px-[14px] focus-visible:ring-[hsl(var(--brand-blue))] focus-visible:ring-offset-0';
export const authCta = 'h-12 w-full rounded-[12px] bg-brand-blue hover:bg-brand-dark text-base font-bold text-white shadow-[0_8px_18px_-8px_hsl(var(--brand-blue)/0.7)]';
export const authSecondary = 'h-12 w-full rounded-[12px] border border-[#e4e0d6] bg-white text-base font-semibold text-[#1d1b18] hover:bg-[#f6f4ef]';
export const authLink = 'text-[13px] font-medium text-[hsl(var(--brand-dark))] hover:underline';

export function AuthSheetHeading({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h2 className="text-lg font-bold leading-tight text-[#1d1b18] [text-wrap:balance]">{title}</h2>
      {children && <p className="text-[13px] leading-snug text-[#6b665d]">{children}</p>}
    </div>
  );
}

export function AuthShell({ subtitle = 'La tua carta fedeltà', children }: { subtitle?: string; children: ReactNode }) {
  return (
    <div className="min-h-screen supports-[height:100dvh]:min-h-dvh flex flex-col lg:grid lg:grid-cols-2">
      <div className="auth-hero relative flex flex-1 flex-col items-center justify-center overflow-hidden bg-[hsl(var(--brand-dark))] px-6 pb-[46px] pt-12 text-center text-white lg:min-h-screen lg:p-12">
        <div
          aria-hidden
          className="pointer-events-none absolute -left-[20%] -right-[20%] -top-[40%] h-[120%] lg:inset-0 lg:h-full"
          style={{ background: 'radial-gradient(60% 60% at 50% 35%, hsl(var(--brand-blue) / 0.55) 0%, transparent 70%)' }}
        />
        <img
          src={BRAND.logoUrl || loyaltyLogo}
          alt={`Carta fedeltà ${BRAND.fullName}`}
          className="auth-card relative mx-auto mb-[18px] block w-[70%] max-w-[250px] -rotate-[4deg] rounded-[14px] shadow-[0_24px_40px_-14px_rgba(0,0,0,0.6)] lg:mb-8 lg:w-[70%] lg:max-w-[340px]"
        />
        <h1 className="relative mb-1 text-[22px] font-bold tracking-[-0.01em] [text-wrap:balance] lg:text-[30px]">
          {BRAND.fullName}
        </h1>
        <p className="relative text-sm text-white/[0.72] lg:text-base">{subtitle}</p>
      </div>

      <div className="flex flex-none flex-col lg:items-center lg:justify-center lg:bg-gradient-to-br lg:from-[var(--brand-surface-from)] lg:to-[var(--brand-surface-to)] lg:p-8">
        <div className="relative -mt-[22px] flex flex-none flex-col gap-[14px] rounded-t-[26px] bg-white px-[22px] pb-[max(22px,env(safe-area-inset-bottom))] pt-[22px] text-[#1d1b18] lg:mt-0 lg:w-full lg:max-w-md lg:rounded-[26px] lg:shadow-[0_12px_40px_-16px_rgba(0,0,0,0.18)]">
          <div className="auth-rise flex min-w-0 flex-col gap-[14px]">{children}</div>
          <p className="pt-4 text-center lg:pt-1.5 text-[11px] tracking-[0.02em] text-[#a39d92]">
            Fidelity by <b className="font-semibold text-[#8a8478]">Returnacy</b>
          </p>
        </div>
      </div>
    </div>
  );
}

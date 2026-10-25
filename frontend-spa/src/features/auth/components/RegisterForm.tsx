import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '../../../components/ui/form';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';
import { RegistrationFormValues } from '../hooks/useAuthForms';

// Auth sheet field styling (auth-page.tsx): small caps label, warm grey field.
const fieldLabel = 'text-xs font-semibold uppercase tracking-[0.05em] text-[#6b665d]';
const fieldInput = 'h-12 rounded-[12px] border-[#e4e0d6] bg-[#f6f4ef] px-[14px] focus-visible:ring-[hsl(var(--brand-blue))] focus-visible:ring-offset-0';
const ctaButton = 'flex-1 h-12 rounded-[12px] bg-brand-blue hover:bg-brand-dark text-base font-bold text-white shadow-[0_8px_18px_-8px_hsl(var(--brand-blue)/0.7)]';

interface Props {
  form: UseFormReturn<any>;
  onSubmit: (v: RegistrationFormValues) => void;
  signupMethod: 'password' | 'google';
  loading: boolean;
  googleError?: Error | null;
}

export function RegisterForm({ form, onSubmit, signupMethod, loading, googleError }: Props) {
  const isPassword = signupMethod === 'password';
  const acceptedTerms = form.watch('acceptedTermsAndConditions');
  const acceptedPrivacy = form.watch('acceptedPrivacyPolicy');
  // Debug: log validation errors when submit fails
  const handleInvalid = (errors: Record<string, any>) => {
    const values = form.getValues();
    const flattened: string[] = [];
    for (const [key, val] of Object.entries(errors)) {
      const msg = (val as any)?.message || (val as any)?._errors?.[0] || JSON.stringify(val);
      flattened.push(`${key}: ${msg}`);
    }
    // eslint-disable-next-line no-console
    console.warn('[RegisterForm] submit prevented due to validation errors ->', flattened);
    // eslint-disable-next-line no-console
    console.log('[RegisterForm] current form values', values);
  };

  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit((v) => {
        // eslint-disable-next-line no-console
        console.log('[RegisterForm] onSubmit called with values', v, 'signupMethod=', signupMethod);
        onSubmit(v);
      }, handleInvalid)} className="flex flex-col gap-[14px]">
        <div className="grid grid-cols-2 gap-[10px]">
          <FormField control={form.control} name="name" render={({ field }) => (
            <FormItem className="space-y-1.5"><FormLabel className={fieldLabel}>Nome</FormLabel><FormControl><Input {...field} type="text" placeholder="Mario" className={fieldInput} /></FormControl><FormMessage /></FormItem>
          )} />
          <FormField control={form.control} name="surname" render={({ field }) => (
            <FormItem className="space-y-1.5"><FormLabel className={fieldLabel}>Cognome</FormLabel><FormControl><Input {...field} type="text" placeholder="Rossi" className={fieldInput} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <FormField control={form.control} name="email" render={({ field }) => (
          <FormItem className="space-y-1.5"><FormLabel className={fieldLabel}>Email</FormLabel><FormControl><Input {...field} type="email" placeholder="email@esempio.com" className={fieldInput} /></FormControl><FormMessage /></FormItem>
        )} />
        <FormField control={form.control} name="phone" render={({ field }) => (
          <FormItem className="space-y-1.5"><FormLabel className={fieldLabel}>Telefono <small className="text-[11px] font-medium normal-case tracking-normal">(opzionale)</small></FormLabel><FormControl><Input {...field} type="tel" placeholder="+39 1234567890" className={fieldInput} /></FormControl><FormMessage /></FormItem>
        )} />
        <div className="grid grid-cols-2 gap-[10px]">
          {signupMethod==='password' && (
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem className="space-y-1.5"><FormLabel className={fieldLabel}>Password</FormLabel><FormControl><Input {...field} type="password" placeholder="Minimo 8 caratteri" className={fieldInput} /></FormControl><FormMessage /></FormItem>
            )} />
          )}
          <FormField control={form.control} name="birthdate" render={({ field }) => (
            <FormItem className="space-y-1.5"><FormLabel className={fieldLabel}>Data di nascita</FormLabel><FormControl><Input {...field} type="date" className={fieldInput} /></FormControl><FormMessage /></FormItem>
          )} />
        </div>
        <div className="space-y-2 text-[11.5px] leading-[1.35] text-[#6b665d]">
          <div className="flex items-start gap-2">
            <input type="checkbox" id="acceptedTermsAndConditions" className="mt-px h-4 w-4 shrink-0 accent-[hsl(var(--brand-blue))]" {...form.register('acceptedTermsAndConditions', { required: true })} />
            <label htmlFor="acceptedTermsAndConditions">Accetto i <a href="/terms" target="_blank" className="text-[hsl(var(--brand-dark))] underline decoration-[hsl(var(--brand-dark)/0.5)]">Termini e Condizioni</a></label>
          </div>
          {!form.watch('acceptedTermsAndConditions') && form.formState.isSubmitted && (<p className="text-red-500 text-xs">Devi accettare i Termini e Condizioni</p>)}
          <div className="flex items-start gap-2">
            <input type="checkbox" id="acceptedPrivacyPolicy" className="mt-px h-4 w-4 shrink-0 accent-[hsl(var(--brand-blue))]" {...form.register('acceptedPrivacyPolicy', { required: true })} />
            <label htmlFor="acceptedPrivacyPolicy">Accetto l' <a href="/privacy" target="_blank" className="text-[hsl(var(--brand-dark))] underline decoration-[hsl(var(--brand-dark)/0.5)]">Informativa Privacy</a></label>
          </div>
          {!form.watch('acceptedPrivacyPolicy') && form.formState.isSubmitted && (<p className="text-red-500 text-xs">Devi accettare l'Informativa Privacy</p>)}
        </div>
        <div className="flex gap-2 items-start">
          {isPassword ? (
            <Button
              type="submit"
              className={ctaButton}
              disabled={loading || !acceptedTerms || !acceptedPrivacy}
            >
              {loading ? (<><Loader2 className="w-4 h-4 mr-2 animate-spin" />Registrazione...</>) : 'Crea la mia carta'}
            </Button>
          ) : (
            // In Google mode, rely on the official Google button below
            null
          )}
        </div>
        {signupMethod==='google' && (
          <div className="mt-2 p-2 text-sm text-gray-600">
            {googleError ? <span className="text-red-600">Errore Google: {googleError.message}</span> : 'Continua con Google cliccando il bottone ufficiale'}
          </div>
        )}
        {googleError && signupMethod==='google' && (
          <div className="flex items-start gap-2 text-amber-600 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>Errore Google: {googleError.message}</span>
          </div>
        )}
      </form>
    </Form>
  );
}

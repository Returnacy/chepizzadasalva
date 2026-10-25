import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from '../../../components/ui/form';
import { Input } from '../../../components/ui/input';
import { Button } from '../../../components/ui/button';
import { Loader2, AlertCircle } from 'lucide-react';
import { UseFormReturn } from 'react-hook-form';

// Auth sheet field styling (auth-page.tsx): small caps label, warm grey field.
const fieldLabel = 'text-xs font-semibold uppercase tracking-[0.05em] text-[#6b665d]';
const fieldInput = 'h-12 rounded-[12px] border-[#e4e0d6] bg-[#f6f4ef] px-[14px] focus-visible:ring-[hsl(var(--brand-blue))] focus-visible:ring-offset-0';
const ctaButton = 'flex-1 h-12 rounded-[12px] bg-brand-blue hover:bg-brand-dark text-base font-bold text-white shadow-[0_8px_18px_-8px_hsl(var(--brand-blue)/0.7)]';

interface Props {
  form: UseFormReturn<{ email: string; password: string }>;
  onSubmit: (v: { email: string; password: string }) => void;
  loginMethod: 'password' | 'google';
  toggleMethod: () => void;
  onGoogle: () => void;
  loading: boolean;
  googleLoading: boolean;
  googleError?: Error | null;
}

export function LoginForm({ form, onSubmit, loginMethod, toggleMethod, onGoogle, loading, googleLoading, googleError }: Props) {
  return (
    <Form {...form}>
      <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-[14px]">
        {loginMethod === 'password' && (
          <>
            <FormField control={form.control} name="email" render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className={fieldLabel}>Email</FormLabel>
                <FormControl><Input {...field} type="email" placeholder="email@esempio.com" className={fieldInput} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
            <FormField control={form.control} name="password" render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className={fieldLabel}>Password</FormLabel>
                <FormControl><Input {...field} type="password" placeholder="La tua password" className={fieldInput} /></FormControl>
                <FormMessage />
              </FormItem>
            )} />
          </>
        )}
        {loginMethod === 'google' && (
          <div className="p-3 text-sm text-gray-600">
            {googleError ? <span className="text-red-600">Errore Google: {googleError.message}</span> : 'Continua con Google cliccando il bottone ufficiale'}
          </div>
        )}
        <div className="flex gap-2">
          <Button type="submit" className={ctaButton} disabled={loading || loginMethod !== 'password'}>
            {loginMethod==='password' ? (loading ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Accesso...</> : 'Accedi') : 'Accedi'}
          </Button>
        </div>
        {googleError && loginMethod==='google' && (
          <div className="flex items-start gap-2 text-amber-600 text-sm">
            <AlertCircle className="w-4 h-4 mt-0.5" />
            <span>Errore Google: {googleError.message}</span>
          </div>
        )}
      </form>
    </Form>
  );
}

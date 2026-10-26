import { useState, useEffect } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link, useSearch } from "wouter";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../components/ui/form";
import { useToast } from "../hooks/use-toast";
import { z } from "zod";
import { http } from "../lib/http";
import { AuthShell, AuthSheetHeading, authCta, authInput, authLabel, authLink } from "../features/auth/components/AuthShell";

// Local schema replacing removed shared schema
const confirmPasswordSchema = z.object({
  token: z.string().min(32).max(64),
  password: z.string().min(8).max(20),
  confirmPassword: z.string().min(8).max(20),
}).refine(d => d.password === d.confirmPassword, { message: 'Le password non coincidono', path: ['confirmPassword'] });
type ResetPasswordData = z.infer<typeof confirmPasswordSchema>;

export default function ResetPasswordPage() {
  const [isSuccess, setIsSuccess] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const { toast } = useToast();
  const search = useSearch();
  
  // Extract token from URL
  const urlParams = new URLSearchParams(search);
  const token = urlParams.get('token');

  const form = useForm<ResetPasswordData>({
    resolver: zodResolver(confirmPasswordSchema),
    defaultValues: {
      token: token || "",
      password: "",
      confirmPassword: "",
    },
  });

  // Token verification endpoint removed in new version; rely on backend validation at confirm step
  const tokenVerification = { valid: !!token } as const;
  const verifyingToken = false;
  const tokenError = null;

  const resetPasswordMutation = useMutation({
    mutationFn: async (data: ResetPasswordData) => {
      const { confirmPassword, ...payload } = data; // payload has { token, password }
      // Backend expects { token, newPassword } and is mounted at /api/v1/auth
      const apiPayload = { token: payload.token, newPassword: payload.password };
      return await http.post<{ message: string }>(`/api/v1/auth/reset-password`, apiPayload);
    },
    onSuccess: () => {
      setIsSuccess(true);
    },
    onError: (error: Error) => {
      toast({
        title: "Errore",
        description: error.message || "Errore durante il reset della password",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ResetPasswordData) => {
    resetPasswordMutation.mutate(data);
  };

  // Update form token when URL token changes
  useEffect(() => {
    if (token) {
      form.setValue('token', token);
    }
  }, [token, form]);

  // Show error if no token provided
  if (!token) {
    return (
      <AuthShell>
        <AuthSheetHeading title="Link non valido">
          Il link per il reset della password non è valido o mancante.
        </AuthSheetHeading>
        <Button asChild className={authCta}>
          <Link href="/auth/forgot-password">
            Richiedi nuovo link
          </Link>
        </Button>
        <div className="text-center">
          <Link href="/auth" className={authLink}>
            Torna all'accesso
          </Link>
        </div>
      </AuthShell>
    );
  }

  // Show loading while verifying token
  if (verifyingToken) {
    return (
      <AuthShell>
        <div className="flex flex-col items-center gap-3 py-2 text-center">
          <Loader2 className="h-8 w-8 animate-spin text-[hsl(var(--brand-blue))]" />
          <p className="text-[13px] text-[#6b665d]">Verifica del link in corso...</p>
        </div>
      </AuthShell>
    );
  }

  // Show error if token is invalid or expired
  if (tokenError || !tokenVerification?.valid) {
    return (
      <AuthShell>
        <AuthSheetHeading title="Link scaduto">
          Il link per il reset della password è scaduto o non valido. I link scadono dopo 30 minuti per motivi di sicurezza.
        </AuthSheetHeading>
        <Button asChild className={authCta}>
          <Link href="/auth/forgot-password">
            Richiedi nuovo link
          </Link>
        </Button>
        <div className="text-center">
          <Link href="/auth" className={authLink}>
            Torna all'accesso
          </Link>
        </div>
      </AuthShell>
    );
  }

  // Show success message
  if (isSuccess) {
    return (
      <AuthShell>
        <AuthSheetHeading title="Password aggiornata">
          La tua password è stata aggiornata. Ora puoi usarla per accedere al tuo account.
        </AuthSheetHeading>
        <Button asChild className={authCta}>
          <Link href="/auth">
            Vai all'accesso
          </Link>
        </Button>
      </AuthShell>
    );
  }

  // Show password reset form
  return (
    <AuthShell>
      <AuthSheetHeading title="Reimposta la password">
        Scegli una nuova password: da 8 a 20 caratteri.
      </AuthSheetHeading>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-[14px]">
          <FormField
            control={form.control}
            name="password"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className={authLabel}>Nuova password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      {...field}
                      type={showPassword ? "text" : "password"}
                      placeholder="La nuova password"
                      className={`${authInput} pr-11`}
                      disabled={resetPasswordMutation.isPending}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={showPassword ? "Nascondi password" : "Mostra password"}
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowPassword(!showPassword)}
                      disabled={resetPasswordMutation.isPending}
                    >
                      {showPassword ? (
                        <EyeOff className="h-4 w-4 text-[#9a948a]" />
                      ) : (
                        <Eye className="h-4 w-4 text-[#9a948a]" />
                      )}
                    </Button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <FormField
            control={form.control}
            name="confirmPassword"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className={authLabel}>Conferma password</FormLabel>
                <FormControl>
                  <div className="relative">
                    <Input
                      {...field}
                      type={showConfirmPassword ? "text" : "password"}
                      placeholder="Ripeti la nuova password"
                      className={`${authInput} pr-11`}
                      disabled={resetPasswordMutation.isPending}
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      aria-label={showConfirmPassword ? "Nascondi password" : "Mostra password"}
                      className="absolute right-0 top-0 h-full px-3 py-2 hover:bg-transparent"
                      onClick={() => setShowConfirmPassword(!showConfirmPassword)}
                      disabled={resetPasswordMutation.isPending}
                    >
                      {showConfirmPassword ? (
                        <EyeOff className="h-4 w-4 text-[#9a948a]" />
                      ) : (
                        <Eye className="h-4 w-4 text-[#9a948a]" />
                      )}
                    </Button>
                  </div>
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className={authCta}
            disabled={resetPasswordMutation.isPending}
          >
            {resetPasswordMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Aggiornamento...</> : "Aggiorna password"}
          </Button>
        </form>
      </Form>
      <div className="text-center">
        <Link href="/auth" className={authLink}>
          Torna all'accesso
        </Link>
      </div>
    </AuthShell>
  );
}

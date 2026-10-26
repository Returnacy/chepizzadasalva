import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { Mail, Clock, Loader2 } from "lucide-react";
import { Button } from "../components/ui/button";
import { Input } from "../components/ui/input";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "../components/ui/form";
import { useToast } from "../hooks/use-toast";
import { z } from "zod";
import { userHttp } from "../lib/servicesHttp";
import { AuthShell, AuthSheetHeading, authCta, authInput, authLabel, authLink, authSecondary } from "../features/auth/components/AuthShell";

const forgotPasswordSchema = z.object({ email: z.string().email() });
type ForgotPasswordData = z.infer<typeof forgotPasswordSchema>;

export default function ForgotPasswordPage() {
  const [isSubmitted, setIsSubmitted] = useState(false);
  const { toast } = useToast();

  const form = useForm<ForgotPasswordData>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  const forgotPasswordMutation = useMutation({
    mutationFn: async (data: ForgotPasswordData) => {
      const payload = {
        email: data.email.trim().toLowerCase(),
        redirectUri: `${window.location.origin}/auth/reset-password`,
      };
      try {
        return await userHttp.post<{ ok?: boolean; message?: string }>(`/api/v1/auth/forgot-password`, payload);
      } catch (error: any) {
        // user-service answers 404 USER_NOT_FOUND for an unknown email. Showing
        // that would tell anyone which addresses have an account, so an unknown
        // email reads exactly like a sent one.
        if (error?.status === 404) return { ok: true };
        throw error;
      }
    },
    onSuccess: () => {
      setIsSubmitted(true);
    },
    onError: () => {
      toast({
        title: "Errore",
        description: "Non siamo riusciti a inviare l'email, riprova tra poco",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: ForgotPasswordData) => {
    forgotPasswordMutation.mutate(data);
  };

  if (isSubmitted) {
    return (
      <AuthShell>
        <AuthSheetHeading title="Controlla la tua email">
          Se l'indirizzo è registrato riceverai un'email con le istruzioni.
        </AuthSheetHeading>
        <ul className="flex flex-col gap-2.5 rounded-[12px] bg-[#f6f4ef] p-[14px] text-[13px] leading-snug text-[#6b665d]">
          <li className="flex gap-2.5">
            <Mail className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--brand-dark))]" />
            <span>Guarda anche nelle cartelle spam e promozioni.</span>
          </li>
          <li className="flex gap-2.5">
            <Clock className="mt-0.5 h-4 w-4 flex-none text-[hsl(var(--brand-dark))]" />
            <span>Il link scadrà tra 30 minuti per motivi di sicurezza.</span>
          </li>
        </ul>
        <Button
          type="button"
          className={authSecondary}
          onClick={() => {
            setIsSubmitted(false);
            form.reset();
          }}
        >
          Invia di nuovo
        </Button>
        <div className="text-center">
          <Link href="/auth" className={authLink}>
            Torna all'accesso
          </Link>
        </div>
      </AuthShell>
    );
  }

  return (
    <AuthShell>
      <AuthSheetHeading title="Password dimenticata?">
        Inserisci la tua email e ti invieremo un link per reimpostare la password.
      </AuthSheetHeading>
      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-[14px]">
          <FormField
            control={form.control}
            name="email"
            render={({ field }) => (
              <FormItem className="space-y-1.5">
                <FormLabel className={authLabel}>Email</FormLabel>
                <FormControl>
                  <Input
                    {...field}
                    type="email"
                    placeholder="email@esempio.com"
                    className={authInput}
                    disabled={forgotPasswordMutation.isPending}
                  />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />

          <Button
            type="submit"
            className={authCta}
            disabled={forgotPasswordMutation.isPending}
          >
            {forgotPasswordMutation.isPending ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Invio in corso...</> : "Invia link di reset"}
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

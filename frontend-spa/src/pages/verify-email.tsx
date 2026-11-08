import { useEffect, useMemo, useState } from "react";
import { useSearch, useLocation } from "wouter";
import { http } from "../lib/http";
import { z } from "zod";
import { emailVerificationsSchema, type EmailVerificationsInput } from "../schema/email-verifications.schema";
import { Button } from "../components/ui/button";
import { Loader2 } from "lucide-react";
import { AuthShell, AuthSheetHeading, authCta, authSecondary } from "../features/auth/components/AuthShell";

export default function VerifyEmailPage() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const [status, setStatus] = useState<"idle" | "submitting" | "success" | "error">("idle");
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Extract token from query string
  const token = useMemo(() => {
    const params = new URLSearchParams(search);
    return params.get("token") || "";
  }, [search]);

  useEffect(() => {
    async function run() {
      // Validate presence of token per schema
      const parse = emailVerificationsSchema.safeParse({ token });
      if (!parse.success) {
        setErrorMsg("Link di verifica incompleto: manca il codice. Apri di nuovo il link dall'email oppure richiedi una nuova email di verifica.");
        setStatus("error");
        return;
      }

      setStatus("submitting");
      setErrorMsg(null);
      try {
        const payload: EmailVerificationsInput = { token };
        await http.post<{ ok?: boolean }>("/api/v1/auth/verify-email/confirm", payload);
        setStatus("success");
      } catch (e: any) {
        const code = e?.body?.error || e?.message;
        setErrorMsg(
          code === "INVALID_OR_EXPIRED_TOKEN"
            ? "Link non valido o scaduto. Richiedi una nuova email di verifica dalla tua pagina."
            : "Verifica non riuscita. Riprova più tardi."
        );
        setStatus("error");
      }
    }

    run();
  }, [token]);

  // After success, redirect to homepage after 5 seconds
  useEffect(() => {
    if (status !== "success") return;
    const id = window.setTimeout(() => navigate("/"), 5000);
    return () => window.clearTimeout(id);
  }, [status, navigate]);

  return (
    <AuthShell>
      <AuthSheetHeading
        title={status === "success" ? "Email verificata" : status === "error" ? "Verifica fallita" : "Verifica email in corso"}
      >
        {status === "success"
          ? "La tua email è stata verificata con successo. Verrai reindirizzato alla home in pochi secondi."
          : status === "error"
            ? errorMsg || "Si è verificato un errore nella verifica dell'email."
            : "Attendere mentre verifichiamo il tuo indirizzo email..."}
      </AuthSheetHeading>
      {(status === "idle" || status === "submitting") && (
        <div className="flex justify-center py-1">
          <Loader2 className="h-7 w-7 animate-spin text-[hsl(var(--brand-blue))]" />
        </div>
      )}
      {status === "success" && (
        <Button asChild className={authCta}>
          <a href="/auth">Vai all'accesso</a>
        </Button>
      )}
      {status === "error" && (
        <Button asChild className={authSecondary}>
          <a href="/auth">Torna all'accesso</a>
        </Button>
      )}
    </AuthShell>
  );
}

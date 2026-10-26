import { Loader2 } from 'lucide-react';
import { Button } from '../../../components/ui/button';
import { BRAND } from '../../../config/brand';
import { AuthShell, AuthSheetHeading, authCta } from './AuthShell';

// Logged in, but with no membership in this brand: the account was created on
// another Returnacy pizzeria. Everything past this point would be refused by
// this brand's business-service, so the only way forward is out.
// No "register here" button: user-service answers a password signup with an
// existing email with 409 EMAIL_ALREADY_EXISTS instead of adding a membership.
export function NotEnrolledScreen({ onLogout, loggingOut }: { onLogout: () => void; loggingOut: boolean }) {
  return (
    <AuthShell>
      <AuthSheetHeading title={`Questo account non è iscritto a ${BRAND.fullName}`}>
        Il tuo account Returnacy esiste, ma non è registrato presso questa pizzeria.
      </AuthSheetHeading>
      <Button type="button" className={authCta} onClick={onLogout} disabled={loggingOut}>
        {loggingOut ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uscita...</> : 'Esci'}
      </Button>
    </AuthShell>
  );
}

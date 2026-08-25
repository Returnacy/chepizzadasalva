# PROVISION-BRAND — onboarding di un nuovo brand su Returnacy

Runbook end-to-end per portare **un cliente nuovo** (un brand, una pizzeria) da zero
a loyalty attiva: timbri, coupon, QR, scanner, staff.

> **Questo repo è il template.** `chepizzadasalva/` è avanti rispetto al
> `business-service` canonico (multi-sede, `walletScope`, staff location gate,
> handoff chiusura, location insights). I brand nuovi partono da qui.
>
> **Motore marketing congelato.** Campagne e invii restano spenti: il default di
> provisioning è `MESSAGING_DRY_RUN=true` e nessuna API key provider (§7).

---

## 0. Prima di iniziare

Il §0.2 è un runbook a sé: **il security set va in produzione su Che Pizza prima
di qualunque onboarding**. I §0.1 e §0.3 sono i due prerequisiti da chiudere.

### 0.1 ⚠️ TODO APERTO: probe rotte cliente in produzione

Durante l'audit è emerso che il gate globale del business-service trattava
**ogni token utente** come token di servizio (`azp='user-service'` è il default di
`signAccessToken`, ed è nella allow-list dei servizi), quindi il controllo ruoli
non è mai stato realmente eseguito. La correzione (`sub === client_id`) lo rende
effettivo — e questo cambia il comportamento delle rotte che i **clienti finali**
chiamano.

Sono state quindi marcate `allowUserAccess: true` e limitate al proprio utente:
`GET /api/v1/coupons`, `GET /api/v1/prizes/progression`, `GET /api/v1/prizes`.

**Da verificare in produzione PRIMA del deploy**, con un token di un cliente reale
(sola lettura, nessuna scrittura):

```bash
# TOKEN = access token di un cliente finale (ruolo USER), preso dal localStorage della SPA
BIZ=af941888-ec4c-458e-b905-21673241af3e
USERID=<User.id del cliente, da /api/v1/me>

curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  "https://fidelity.business.chepizzadasalva.it/api/v1/coupons?userId=$USERID&businessId=$BIZ"

curl -s -o /dev/null -w '%{http_code}\n' \
  -H "Authorization: Bearer $TOKEN" \
  "https://fidelity.business.chepizzadasalva.it/api/v1/prizes/progression?userId=$USERID"
```

- **200 oggi** (atteso, per via del bypass): dopo il deploy devono restare 200. ✅
- **403 oggi**: la carta fedeltà è già rotta in prod per i clienti e va aperto un
  bug a parte — non risolverlo dentro questo deploy.

Verificare anche che un cliente **non** possa leggere i coupon di un altro
(`userId` di un terzo → atteso **403** dopo il deploy).

### 0.2 Runbook: deploy del security set su Che Pizza

Il security set va in produzione **su Che Pizza per prima e da sola**, prima di
qualunque brand nuovo: è l'unico modo di isolare una regressione. Questa
checklist serve a decidere **quando** farlo — non va eseguita insieme
all'onboarding di un cliente.

```bash
BIZ=af941888-ec4c-458e-b905-21673241af3e          # Taggi
BS=https://fidelity.business.chepizzadasalva.it
US=https://user.returnacy.app
CUST_TOKEN=...    # access token di un CLIENTE finale (ruolo USER)
STAFF_TOKEN=...   # access token di uno STAFF Che Pizza
CUST_ID=...       # User.id del cliente (da GET $US/api/v1/me)
OTHER_ID=...      # User.id di un ALTRO cliente Che Pizza
```

#### Passo 1 — probe PRIMA del deploy (§0.1)

Registrare le risposte attuali: senza baseline non si distingue una regressione
da un bug preesistente.

```bash
curl -s -o /dev/null -w 'coupons:     %{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" "$BS/api/v1/coupons?userId=$CUST_ID&businessId=$BIZ"
curl -s -o /dev/null -w 'progression: %{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" "$BS/api/v1/prizes/progression?userId=$CUST_ID"
curl -s -o /dev/null -w 'users(CRM):  %{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" -X POST "$BS/api/v1/users" -H 'content-type: application/json' -d "{\"businessId\":\"$BIZ\"}"
```

Attese sul codice **attuale**: `200`, `200`, e **`200` anche sul terzo** — un
cliente finale che legge il CRM è la dimostrazione del bypass `azp`. Se il terzo
è già `403`, il bypass è mitigato da una env che non conosco: **fermarsi e
rileggere** prima di procedere.

#### Passo 2 — deploy `user-service`

Merge di `feat/tenant-scoped-authz` → deploy Railway. **Nessuna migrazione DB**:
il branch non cambia lo schema.

Env da NON toccare qui: lasciare `INTERNAL_SERVICE_CLIENTS` invariata (la
rotazione è il §8, separata) e **non** impostare `REQUIRE_TENANT_SERVICE_TOKENS`
— deve restare assente, cioè finestra aperta, altrimenti il business-service
ancora vecchio viene rifiutato.

```bash
curl -s -o /dev/null -w 'jwks: %{http_code}\n' "$US/.well-known/jwks.json"                             # 200
curl -s -o /dev/null -w 'me:   %{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" "$US/api/v1/me"  # 200 — nessun re-login
curl -s -o /dev/null -w 'users/:id da cliente: %{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" "$US/api/v1/users/$OTHER_ID"
```

L'ultimo → **403** (prima: 200 con email, telefono e membership di chiunque).

A log è atteso `[tenant] tenant-blind service token accepted during rotation
window`: corretto in questa fase, il business-service non è ancora rotato.

#### Passo 3 — deploy `business-service` Che Pizza

Push su `chepizzadasalva` main → Railway + Cloudflare Pages (un push ne fa due).

> Il gate del business-service è testato come funzione pura, non attraverso
> Fastify (`prismaRepositoryPlugin` importa Prisma da un path di container).
> **Questo passo è il primo test reale del cablaggio**: tenere i log aperti.

#### Passo 4 — verifica funzionale, in quest'ordine

| # | Cosa | Comando / azione | Atteso |
|---|---|---|---|
| 1 | Il cliente vede ancora i coupon | `curl -s -H "Authorization: Bearer $CUST_TOKEN" "$BS/api/v1/coupons?userId=$CUST_ID&businessId=$BIZ"` | **200**, stessi coupon del passo 1 |
| 2 | Progressione premi | `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" "$BS/api/v1/prizes/progression?userId=$CUST_ID"` | **200** |
| 3 | Carta fedeltà nel browser | aprire `fidelity.chepizzadasalva.it` come cliente | timbri e coupon visibili |
| 4 | **Il CRM si è chiuso ai clienti** | `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" -X POST "$BS/api/v1/users" -H 'content-type: application/json' -d "{\"businessId\":\"$BIZ\"}"` | **403** (era 200) |
| 5 | Un cliente non legge i coupon altrui | `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $CUST_TOKEN" "$BS/api/v1/coupons?userId=$OTHER_ID&businessId=$BIZ"` | **403** |
| 6 | Lo staff timbra | `/scan-qr` come staff, timbrare un cliente di prova | timbro registrato, contatori sincronizzati |
| 7 | Lo staff vede il CRM | `curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $STAFF_TOKEN" -X POST "$BS/api/v1/users" -H 'content-type: application/json' -d "{\"businessId\":\"$BIZ\"}"` | **200** |
| 8 | Attribuzione multi-sede | timbrare selezionando Lissaro | `Stamp.businessId` = Lissaro |
| 9 | Chiusura / Inventario | voce di nav come staff | apre PM, sede preselezionata |
| 10 | Analisi Sedi | aprire le tab | caricano dati reali |

**Il test cross-tenant vero (staff Che Pizza → business-service di un brand B)
non è eseguibile finché un brand B non esiste**: sta al §11, non qui.

#### Passo 5 — rollback

Ordine inverso: redeploy del commit precedente del **business-service prima**,
user-service dopo. user-service nuovo è compatibile col business-service vecchio;
il contrario no, perché il gate nuovo pretende un `sub` di servizio corretto.

Caso specifico: se falliscono **solo** i punti 1-3 (i clienti non vedono la
carta) e tutto il resto è verde, la causa è nel blocco `allowUserAccess` delle
rotte cliente, non nel gate → rollback del solo business-service e riapertura
del TODO §0.1.

#### Passo 6 — `ME_AUTO_ENROLL`: quando toglierlo

Il flag è solo un'uscita di sicurezza per un sistema senza staging.
**Da rimuovere dopo 2 settimane senza regressioni** dal passo 2: se in quel
periodo nessuno segnala una carta fedeltà scomparsa e a log non compare mai
`[me] implicit membership enrolment`, cancellare il ramo
`if (domain && autoEnrollEnabled)` in `get.me.service.ts` insieme al flag.
Lasciarlo lì per sempre significa tenere vivo un percorso di iscrizione
implicita cross-brand.

### 0.3 Dati che deve fornire il cliente

Mai inventati. Senza questi il build fallisce (§6.3):

| Dato | Serve per |
|---|---|
| Ragione sociale, sede legale, C.F., P. IVA | pagine Termini e Privacy |
| Email di contatto privacy/ToS | pagine legali |
| Nome commerciale + logo (PNG/SVG orizzontale) | SPA |
| Indirizzo e telefono della pizzeria | record `Business` |
| Premi e soglie timbri (es. "Pizza omaggio a 10") | seed premi |
| Email del titolare | primo ADMIN |

---

## 1. Decidere gli identificativi

```bash
export SLUG=sudest                     # [a-z0-9-], usato in host e client id
export BRAND_ID=$(uuidgen | tr 'A-Z' 'a-z')
export BUSINESS_ID=$(uuidgen | tr 'A-Z' 'a-z')
echo "SLUG=$SLUG BRAND_ID=$BRAND_ID BUSINESS_ID=$BUSINESS_ID"
```

Annotarli: servono in **tutti** i passi successivi e nella `RETURNACY_SHOP_MAP` di
PizzeriaManager.

**`walletScope`**: `LOCATION` per un cliente mono-sede (default, franchise-safe).
`BRAND` solo per un titolare con più sedi che vuole il portafoglio condiviso
(il caso Che Pizza). Sbagliarlo è visibile al cliente finale.

---

## 2. DNS — su **Porkbun**, non Cloudflare

`returnacy.app` ha i DNS su **Porkbun**. Il wildcard oggi punta al parking
(`pixie.porkbun.com`), quindi **ogni brand richiede due record espliciti**
(azione manuale di Enrico):

| Record | Tipo | Valore | Per |
|---|---|---|---|
| `<slug>.returnacy.app` | CNAME | target del progetto Cloudflare Pages | SPA cliente |
| `<slug>.business.returnacy.app` | CNAME | target custom-domain Railway | business-service |

Il target esatto lo forniscono Cloudflare Pages e Railway **dopo** aver creato
progetto e servizio (§5, §6): creare prima quelli, poi tornare qui.

> Nota: il custom domain del domain-mapper è rotto e si usa l'URL pubblico Railway.
> Non replicare quel pattern: qui i custom domain servono e vanno verificati.

---

## 3. Database del brand (Postgres dedicato)

Un **DB per brand**, senza eccezioni: il repository del business-service non filtra
per brand nelle scritture, quindi un DB condiviso non è isolabile.

1. Railway → nuovo Postgres nel progetto `Returnacy`, nome `pg-<slug>`.
2. Applicare lo schema. Il business-service **non migra al boot** (il Dockerfile
   esegue solo `prisma generate`): lo schema va applicato **prima** del codice.

```bash
cd chepizzadasalva/business-service/db
DATABASE_URL='<URL del nuovo Postgres>' \
  npx prisma db push --schema=./prisma/schema.prisma
```

Su DB vuoto `db push` è banale e sicuro (non esiste una cartella `migrations/`
per questo servizio — vedi `MULTI_LOCATION_ROLLOUT.md`).

---

## 4. Seed del brand

### 4.1 business-service (Brand + Business + Premi)

```bash
cd chepizzadasalva/business-service/db
pnpm build   # se dist/ non è aggiornato

ALLOW_SEED=true \
DATABASE_URL='<URL pg-'$SLUG'>' \
BRAND_ID="$BRAND_ID" \
BRAND_NAME='Pizzeria Sud Est' \
BRAND_EMAIL='info@sudest.it' \
BRAND_PHONE='+39 049 000000' \
BRAND_ADDRESS='Via Roma 1, Padova' \
BRAND_WALLET_SCOPE=LOCATION \
BUSINESS_ID="$BUSINESS_ID" \
BUSINESS_NAME='Sud Est — Padova' \
BUSINESS_ADDRESS='Via Roma 1, Padova' \
PRIZES='[{"name":"Pizza omaggio","pointsRequired":10}]' \
  pnpm seed
```

Idempotente: rilanciarlo aggiorna il brand e, cambiando `BUSINESS_ID`, aggiunge
una seconda sede. `BRAND_EMAIL`/`BRAND_PHONE` sono UNIQUE su `Brand`.

### 4.2 user-service (primo ADMIN) — DB **condiviso**, attenzione

user-service è il piano identità **comune a tutti i brand**: qui non si crea un DB
nuovo, si scrive in quello esistente. Il seed senza `BRAND_ID` tocca solo le policy.

`patch.team.service.ts` rifiuta per progetto di *assegnare* ADMIN, quindi il primo
va creato qui.

```bash
cd user-service/db
ALLOW_SEED=true \
DATABASE_URL='<URL user-service DB>' \
BRAND_ID="$BRAND_ID" BUSINESS_ID="$BUSINESS_ID" \
ADMIN_EMAIL='titolare@sudest.it' \
ADMIN_SUB='<keycloakSub del titolare>' \
ADMIN_NAME='Marco' ADMIN_SURNAME='Rossi' \
  pnpm seed
```

`ADMIN_SUB` è il `sub` del JWT. Se il titolare non ha ancora un account: farlo
registrare **prima** sulla SPA del suo brand, leggere il `sub` da `/api/v1/me`, poi
lanciare il seed. In caso contrario si crea un secondo account senza ADMIN.

`SEED_DEMO_USERS=true` aggiunge 12 utenti finti: **mai** su un DB con clienti veri.

> ⚠️ `prisma migrate deploy` **non** funziona su un user-service DB vuoto: l'unica
> migration presente (`20260430160000_add_password_hash`) fa `ALTER TABLE "User"` e
> presuppone lo schema già creato via `db push`. Rilevante solo se un giorno si
> stanzia un user-service nuovo; per l'onboarding di un brand non serve.

---

## 5. Servizio business-service su Railway

Nuovo servizio nel progetto `Returnacy`, da questo repo, Dockerfile
`chepizzadasalva/business-service/server/Dockerfile`.

Variabili (i valori di JWT/servizi si prendono da `staging-notes.md`):

| Var | Valore |
|---|---|
| `DATABASE_URL` | il Postgres del brand (§3) |
| `DEFAULT_BRAND_ID` | `$BRAND_ID` |
| `DEFAULT_BUSINESS_ID` | `$BUSINESS_ID` |
| `SELF_ISSUER` | issuer di user-service |
| `SELF_ISSUER_JWKS_URL` | `<issuer>/.well-known/jwks.json` |
| `USER_SERVICE_URL` | `https://user.returnacy.app` |
| `SERVICE_TOKEN_URL` | `https://user.returnacy.app/internal/v1/auth/service-token` |
| `SERVICE_CLIENT_ID` | **`business-service:<slug>`** (§8) |
| `SERVICE_CLIENT_SECRET` | il segreto nuovo generato al §8 |
| `USE_SELF_ISSUED_SERVICE_TOKENS` | `true` |
| `KEYCLOAK_AUDIENCE` | come Che Pizza |
| `KEYCLOAK_SERVICE_AUDIENCE` | come Che Pizza (il match è per prefisso prima di `:`) |
| `REQUIRE_TENANT_SERVICE_TOKENS` | `true` — **un brand nuovo parte già stretto** |
| `GOOGLE_WALLET_*` | solo se il cliente vuole il pass Google Wallet |

Poi: Railway → Settings → custom domain `<slug>.business.returnacy.app`, e tornare
al §2 per il CNAME su Porkbun.

**Health check**: il servizio risponde **401 a tutto** tranne `/health`. Un 401 su
una rotta API significa "vivo", non "rotto".

---

## 6. SPA cliente su Cloudflare Pages

### 6.1 Progetto

Nuovo progetto Pages collegato a questo repo, root directory `frontend-spa`.
Cloudflare autorileva **pnpm** (`pnpm-lock.yaml` è canonico).

### 6.2 Variabili di build

```
VITE_BRAND_NAME=Pizzeria Sud Est
VITE_BRAND_FULL_NAME=Pizzeria Sud Est
VITE_BRAND_LEGAL_NAME=Sud Est S.r.l.
VITE_BRAND_LEGAL_ADDRESS=Via Roma 1, 35100 Padova (PD)
VITE_BRAND_LEGAL_TAX_CODE=<C.F. del cliente>
VITE_BRAND_LEGAL_VAT=<P. IVA del cliente>
VITE_BRAND_CONTACT_EMAIL=privacy@sudest.it
VITE_BRAND_LOGO_URL=<URL assoluto del logo>      # vuoto → logo Che Pizza incluso nel bundle
VITE_BRAND_DOCUMENT_TITLE=Sud Est — Fidelity
VITE_BUSINESS_ID=<BUSINESS_ID>
VITE_USER_SERVICE_URL=https://user.returnacy.app
VITE_BUSINESS_SERVICE_URL=https://<slug>.business.returnacy.app
VITE_CAMPAIGN_SERVICE_URL=<campaign-service>      # campagne congelate: può restare vuoto
VITE_PM_URL=<PizzeriaManager del cliente>
```

### 6.3 Il build fallisce se la configurazione è incompleta

`prebuild` esegue `scripts/check-brand.mjs`, che blocca:
- qualunque `VITE_*` con placeholder residuo (`{{...}}`, `TODO`, `CHANGEME`, `XXX`);
- un brand diverso da Che Pizza che **eredita** ragione sociale, P. IVA, C.F. o
  email di Che Pizza (il caso pericoloso: pubblicare l'identità legale di un
  cliente sul sito di un altro).

Provarlo in locale prima di configurare Cloudflare:

```bash
cd chepizzadasalva/frontend-spa
VITE_BRAND_NAME='Pizzeria Sud Est' pnpm check:brand   # deve fallire elencando ciò che manca
```

Poi: custom domain `<slug>.returnacy.app` → CNAME su Porkbun (§2).

> Il logo: se `VITE_BRAND_LOGO_URL` è vuoto viene servito quello di Che Pizza
> incluso nel bundle. Per un cliente **è obbligatorio** valorizzarlo (il check non
> può accorgersene: un URL vuoto è legittimo per Che Pizza).

---

## 7. Messaggistica — spenta di default

Su ogni servizio del brand nuovo:

```
MESSAGING_DRY_RUN=true
```

Il dispatcher percorre tutta la pipeline (transizioni di stato, log, eventi) ma
**non chiama nessun provider**. Non impostare `RESEND_API_KEY` né
`DECISIONTELECOM_API_KEY`: "non le imposto" da solo non è un controllo — è
un'omissione che il primo copia-incolla di env annulla. Servono entrambe le cose.

Prima di togliere il dry-run: consenso marketing raccolto, mittente verificato,
e un invio di prova a un indirizzo interno.

---

## 8. Credenziali di servizio per-tenant (e rotazione di Che Pizza)

Il piano condiviso usava **un solo** `client_id: business-service` con **un solo**
segreto. Darlo a un secondo cliente significava dargli il DB clienti di Che Pizza.
Ora `INTERNAL_SERVICE_CLIENTS` accetta entrambe le forme insieme:

```json
{
  "business-service": "<segreto legacy>",
  "business-service:chepizza":  { "secret": "<nuovo A>", "brandId": "385d4ebb-..." },
  "business-service:sudest":    { "secret": "<nuovo B>", "brandId": "<BRAND_ID>" }
}
```

Il `brandId` finisce nel token come claim, deciso **dalla credenziale** e mai dal
body della richiesta.

### 8.1 Brand nuovo

1. Generare un segreto: `openssl rand -base64 32 | tr -d '/+=' | head -c 32`.
2. Aggiungere `"business-service:<slug>": {"secret": "...", "brandId": "$BRAND_ID"}`
   a `INTERNAL_SERVICE_CLIENTS` su user-service (**senza toccare le righe esistenti**).
3. Impostare `SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET` sul servizio del brand.
4. `REQUIRE_TENANT_SERVICE_TOKENS=true` sul brand nuovo fin dal primo giorno.

### 8.2 Rotazione di Che Pizza (finestra a doppia credenziale)

Da eseguire **solo dopo** che il brand nuovo è in piedi e stabile.

| # | Azione | Verifica |
|---|---|---|
| 1 | Aggiungere `business-service:chepizza` (con `brandId`) a `INTERNAL_SERVICE_CLIENTS`, lasciando la riga legacy | user-service riparte; a log `legacyClientIds` elenca ancora `business-service` |
| 2 | Sul business-service Che Pizza: `SERVICE_CLIENT_ID=business-service:chepizza` + nuovo segreto | timbrata di prova → i contatori si sincronizzano, nessun `MEMBERSHIP_NOT_FOUND` |
| 3 | Osservare i log di user-service ~24–48h | **zero** `tenant-blind service token accepted during rotation window` |
| 4 | Rimuovere la riga legacy `"business-service"` da `INTERNAL_SERVICE_CLIENTS` | a log sparisce il warning `legacyClientIds` |
| 5 | `REQUIRE_TENANT_SERVICE_TOKENS=true` su user-service **e** sul business-service Che Pizza | un token senza `brandId` → `403 TENANT_BLIND_SERVICE_TOKEN` |

**Rollback** a ogni passo: rimettere `SERVICE_CLIENT_ID=business-service` e il
segreto legacy (che al passo 4 non esiste più — da lì in poi il rollback è
riaggiungere la riga legacy).

Il passo 3 è il punto che rende sicuro il passo 4: finché quel warning compare,
**qualcosa** sta ancora usando la credenziale condivisa.

---

## 9. domain-mapper — l'unico punto condiviso che cambia

Aggiungere l'entry in `domain-mapper-service/server/domain-mapping.json`:

```json
"sudest": {
  "brandId": "<BRAND_ID>",
  "businessId": "<BUSINESS_ID>",
  "frontend-spa": "sudest.returnacy.app",
  "business-service": "sudest.business.returnacy.app"
}
```

⚠️ **La mappa è letta una sola volta al boot** (`server/src/app.ts`, `loadMapping()`
a module load) ed è **copiata dentro l'immagine** dal Dockerfile. Non esiste reload
a caldo: serve **commit + redeploy**, e durante il riavvio **il login di TUTTE le
SPA è degradato** (login e team resolution dipendono dalla risoluzione dell'host).

Finestra: fuori orario di servizio delle pizzerie (non a cavallo di cena).
Dopo il redeploy:

```bash
curl -s "https://domain-mapper-service-production.up.railway.app/api/v1/resolve?host=sudest.returnacy.app"
# atteso: brandId/businessId del brand nuovo
curl -s "https://domain-mapper-service-production.up.railway.app/api/v1/resolve?host=fidelity.chepizzadasalva.it"
# atteso: Che Pizza, invariato  ← la verifica che conta
```

---

## 10. SSO verso il PizzeriaManager del cliente

Contratto completo: **`user-service/docs/SSO-PM-CONTRACT.md`** (claim, audience,
TTL, ordine di deploy). Sul PM del cliente:

| Var | Valore |
|---|---|
| `RETURNACY_ISSUER` | issuer di user-service (condiviso) |
| `RETURNACY_JWKS_URL` | `<issuer>/.well-known/jwks.json` |
| `RETURNACY_BRAND_ID` | **`$BRAND_ID`** — è il confine di sicurezza |
| `RETURNACY_REQUIRE_BRAND_CLAIM` | `false` finché Returnacy v2 non è in prod, poi `true` |
| `RETURNACY_SHOP_MAP` | `{"<BUSINESS_ID>": <shopId del PM>}` |

Senza `RETURNACY_BRAND_ID` il PM del cliente accetta lo staff di **qualunque**
tenant Returnacy e gli crea un account Staff.

---

## 11. Checklist di verifica finale

Loyalty:
- [ ] Registrazione cliente su `<slug>.returnacy.app` → utente creato con membership sul brand nuovo
- [ ] QR cliente → scanner staff → timbro registrato sulla sede giusta
- [ ] Timbri fino alla soglia → coupon generato
- [ ] Riscatto coupon → `isRedeemed`, secondo tentativo → **409**
- [ ] `/crm` visibile allo staff del brand nuovo

Isolamento (**il punto della release**):
- [ ] Token staff Che Pizza → `<slug>.business.returnacy.app/api/v1/users` → **403**
- [ ] Token staff brand nuovo → business-service Che Pizza → **403**
- [ ] Cliente finale → `GET /api/v1/users/<id di un altro>` su user-service → **403**
- [ ] Staff brand nuovo → `GET /api/v1/users/<id cliente Che Pizza>` → **404**
- [ ] Service token del brand nuovo → `POST /internal/v1/users/query {brandId: <Che Pizza>}` → **403**
- [ ] Handoff PM staff Che Pizza → PM del cliente nuovo → **403**, nessun utente creato

Non-regressione Che Pizza (**da fare sempre**):
- [ ] Login cliente e staff: nessun re-login richiesto
- [ ] Carta fedeltà cliente: coupon e progressione visibili (cfr. §0.1)
- [ ] Timbratura Taggi e Lissaro: attribuzione corretta
- [ ] Chiusura / Inventario: handoff verso PM funzionante, sede preselezionata
- [ ] "Analisi Sedi": tutte le tab caricano

---

## 12. Ambiente locale (Postgres scratch)

Nessun Docker sulla macchina: si usa il Postgres installato via Homebrew su una
porta dedicata, senza toccare cluster esistenti.

```bash
export PATH="/opt/homebrew/opt/postgresql@18/bin:$PATH"
PGD=/tmp/rtn-pgdata; SOCK=/tmp/rtnpg      # socket path corto: >103 byte fa fallire il boot
rm -rf "$PGD"; mkdir -p "$PGD" "$SOCK"
initdb -D "$PGD" -U returnacy --auth=trust
pg_ctl -D "$PGD" -o "-p 55432 -k $SOCK -c listen_addresses=127.0.0.1" -l /tmp/rtn-pg.log start
createdb -h 127.0.0.1 -p 55432 -U returnacy brand_test

export DATABASE_URL='postgresql://returnacy@127.0.0.1:55432/brand_test'
cd chepizzadasalva/business-service/db && npx prisma db push --schema=./prisma/schema.prisma

# stop
pg_ctl -D "$PGD" stop
```

I test di autorizzazione **non** richiedono un database:

```bash
cd chepizzadasalva/business-service/server && npx vitest run   # gate tenant
cd user-service/server && npx vitest run                       # isolamento cross-tenant
cd messaging-service/dispatcher && npx vitest run              # dry-run
```

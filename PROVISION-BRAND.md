# PROVISION-BRAND — onboarding di un nuovo brand su Returnacy

Runbook end-to-end per portare **un cliente nuovo** (un brand, una pizzeria) da zero
a loyalty attiva: timbri, coupon, QR, scanner, staff.

> **Questo repo è il template.** `chepizzadasalva/` è avanti rispetto al
> `business-service` canonico (multi-sede, `walletScope`, staff location gate,
> handoff chiusura, location insights). I brand nuovi partono da qui.
>
> **Motore marketing congelato.** Campagne e invii restano spenti: il default di
> provisioning è `MESSAGING_DRY_RUN=true` sul messaging-service condiviso e
> nessuna API key provider (§7).

> **Aggiornato dopo i primi due clienti** (`quieora` 1 Sep, `sudest` 2 Sep 2026).
> Tutto ciò che qui è marcato **lezione** è successo davvero, non è previsione.
>
> **Il generatore dei blocchi di configurazione sta nel hub PizzeriaOS**, non
> qui: `PizzeriaOS/scripts/provision/` legge `clients/<slug>/client.env` e
> produce `pages.env`, `pm.env`, `business-service.env`, la entry del
> domain-mapper, i record DNS e la checklist dei passi manuali. Questo runbook
> resta la fonte del *perché*; quello è la fonte del *come* meccanico. Le
> verifiche read-only di fine provisioning sono in `verify-brand.sh <slug>`.

---

## Ordine dei passi (rivisto dopo sudest — non è l'ordine di numerazione)

1. §1 identificativi → §3 DB → §4.1 seed business-service → §5 servizio Railway
2. **§9 domain-mapper** — è un **prerequisito funzionale** del §8.1, non una
   rifinitura: finché il tenant non è nella mappa, `resolveBrandForBusiness()`
   non lo risolve e il CRM risponde `400 TENANT_SCOPE_REQUIRED`
3. §8.1 credenziale per-tenant + §6.4 `CORS_ORIGIN` di user-service
4. §2 DNS (i target esistono solo ora) → §6 SPA su Pages → §13 Google, se lo si vuole
5. §10 SSO verso il PM del cliente
6. §4.2 primo ADMIN — **per ultimo, e con il titolare presente**: nasce dalla
   sua registrazione sulla SPA, che deve quindi essere già live
7. §11 checklist

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

##### 1b — due query sul DB user-service (sola lettura)

Da eseguire sul DB user-service di Che Pizza **prima** del deploy. Sono `SELECT`:
nessuna scrittura, nessuna migrazione.

```sql
-- (a) Utenti senza alcuna membership su Che Pizza (né brand né sedi)
SELECT count(*) AS orfani
FROM "User" u
WHERE NOT EXISTS (
  SELECT 1 FROM "UserMembership" m
  WHERE m."userId" = u.id
    AND (
      m."brandId" = '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47'
      OR m."businessId" IN (
        'af941888-ec4c-458e-b905-21673241af3e',   -- Taggi
        'f103ce67-ad79-4bf6-99ca-1d632caf7786'    -- Lissaro
      )
    )
);
```

**Interpretazione.** `0` → procedere. **`> 0`** → quegli utenti dopo il deploy
non risultano clienti di nessun brand: il gate li respinge e la loro carta
fedeltà sparisce. Erano tenuti in piedi dall'auto-iscrizione di `/me`, che
questo branch disattiva. Due opzioni, da scegliere **prima** del passo 2:

- **`ME_AUTO_ENROLL=true`** su user-service: li riaggancia al primo `/me` come
  prima. Allora però il conteggio va rifatto a valle, prima di togliere il flag
  al passo 6.
- **bonifica**: `INSERT` mirato delle membership mancanti — la strada pulita se
  il numero è piccolo.

Prima di decidere, guardare *chi* sono: con timbri o coupon sono clienti veri;
a zero, probabilmente registrazioni mai completate.

```sql
-- (b) Righe legacy: membership con brandId NULL, per ruolo
SELECT role, count(*) FROM "UserMembership" WHERE "brandId" IS NULL GROUP BY role;
```

**Interpretazione.** **Non è più bloccante**: il commit `fix(authz)` allinea
user-service a business-service, quindi una riga con `brandId` NULL vale se il
suo `businessId` è una sede del brand. Va però saputo:

- righe con `role` diverso da `USER` sono staff che dopo il deploy dipendono dal
  fallback su `businessId`. Se una di quelle righe ha **anche** `businessId`
  NULL, quella persona non appartiene a nessun brand e perde l'accesso:
  ```sql
  SELECT count(*) FROM "UserMembership" WHERE "brandId" IS NULL AND "businessId" IS NULL;
  ```
  Atteso `0`. Se `> 0`, sistemare quelle righe prima del deploy.
- un numero alto di righe legacy è anche il segnale che una bonifica di
  `brandId` va pianificata a parte, dopo questo deploy.

##### 1c — tre controlli di configurazione

- **`USER_SERVICE_URL` sul business-service**: ora è *fail-closed*. Il backfill
  delle membership da `/me` è l'unica fonte di membership per i token utente (i
  token non portano claim di membership); se la var manca, `userMemberships`
  resta vuoto e **ogni utente prende 403**. Prima il bypass `azp` mascherava la
  cosa. Verificare che sia valorizzata su Railway.
- **Build command di Cloudflare Pages**: se è `vite build` (o `npx vite build`)
  lo script `prebuild` **non gira** e il controllo brand non viene eseguito. Per
  Che Pizza è indifferente (i default sono i suoi), ma per un brand nuovo quel
  controllo è tutta la rete di sicurezza: impostare il build command a
  **`npm run build`** (o `pnpm build`).
- **`REQUIRE_TENANT_SERVICE_TOKENS`**: deve restare **assente** su Che Pizza fino
  alla rotazione (§8.2). Impostarlo ora blocca il business-service.

##### 1d — changelog delle risposte API

| Endpoint | Prima | Dopo |
|---|---|---|
| `POST $BS/api/v1/users` con token cliente | 200 | **403** |
| `GET $US/api/v1/users/:id` da un cliente | 200 | **403** |
| `GET $US/api/v1/users/:id` fuori brand | 200 | **404** |
| `PATCH $US/api/v1/users/:id/memberships` con `memberships: []` | 200 | **400 `NO_MEMBERSHIPS`** |
| `PATCH .../memberships` cross-brand | 200 | **403 `CROSS_TENANT_FORBIDDEN`** |
| `POST $BS/api/v1/stamps` con businessId fuori brand | 200 | **400** |
| `GET $BS/api/v1/coupons?userId=<altro>` da cliente | 200 | **403** |
| `GET $US/api/v1/me` con token di servizio `business-service:<slug>` | 200 + riga `User` fantasma | **403 `SERVICE_TOKEN_NOT_ALLOWED`** |

Il `400 NO_MEMBERSHIPS` è nuovo: prima un array vuoto restituiva `200` senza far
nulla. Nessun chiamante noto lo invia — la SPA manda sempre almeno una entry —
ma è un cambio di contratto da conoscere se qualcosa di esterno chiama
quell'endpoint.

L'ultima riga è la correzione di `isServiceCaller` (`utils/serviceCallerGuard.ts`):
riconosceva un id di servizio **solo per corrispondenza esatta**, mentre dal §8.1
in poi ogni brand nuovo si chiama `business-service:<slug>`. Con
`INTERNAL_SERVICE_CLIENTS` assente o non parsabile quel `sub` non stava in nessuna
lista, `/me` lo prendeva per una persona e l'upsert a monte creava una riga `User`
intestata al client id — esattamente ciò che quella guardia esiste per impedire.
Ora il match è sul segmento prima di `:` oltre che sull'id intero, come già fanno
`tenantGuard.matchesAllowedService` e `evaluateTenantAccess` del business-service.
Nessun impatto sui token utente: il `sub` di una persona è un uuid, non contiene `:`.
Su Che Pizza, che usa ancora l'id legacy `business-service`, il comportamento è
identico a prima.

#### Passo 2 — deploy `user-service`

Merge di `feat/tenant-scoped-authz` → deploy Railway. **Nessuna migrazione DB**:
il branch non cambia lo schema.

Nello stesso deploy va anche la correzione di `isServiceCaller` (branch
`feat/spa-brand-tokens`, vedi §1d): non è un prerequisito per Che Pizza — che non
ha ancora credenziali per-tenant — ma deve essere in produzione **prima** del §8.1
del primo brand nuovo, altrimenti il suo business-service può farsi passare per un
utente su `/me`. Coperta da `server/tests/serviceCallerGuard.test.ts`.

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
| Colore brand `#RRGGBB` (dal logo o dal brand book) | SPA — senza, il sito del cliente resta blu Che Pizza |
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
| `_railway-verify.<slug>.business.returnacy.app` | TXT | `railway-verify=<token>` | **solo se Railway lo chiede** (vedi sotto) |

Il target esatto lo forniscono Cloudflare Pages e Railway **dopo** aver creato
progetto e servizio (§5, §6): creare prima quelli, poi tornare qui.

> Su Porkbun il nome del record si scrive **senza** il dominio: `sudest.business`,
> `_railway-verify.sudest.business`.

**Lezione sudest (2 Sep).** Per `sudest.business.returnacy.app` Railway ha chiesto
**anche** un TXT di verifica di proprietà (`Certificate status:
VALIDATING_OWNERSHIP`), che per `quieora` non era comparso. Non è opzionale
quando compare: **senza il TXT il certificato non viene emesso** e l'host resta
irraggiungibile in HTTPS anche col CNAME giusto. Il token si legge nella pagina
del custom domain su Railway, insieme al target CNAME. Quindi: dopo aver
aggiunto il custom domain, guardare **cosa** chiede Railway, non assumere che
siano sempre gli stessi record del cliente precedente.

**Lezione (entrambi).** Il target del custom domain Railway **cambia se il
custom domain viene ricreato**: su quieora il target è passato da
`cdsq3bo6.up.railway.app` a `j4qj9b5c.up.railway.app`. Il valore da scrivere su
Porkbun è quello che la dashboard mostra **adesso**, mai quello copiato da un
report precedente.

> Nota: il custom domain del domain-mapper è rotto e si usa l'URL pubblico Railway.
> Non replicare quel pattern: qui i custom domain servono e vanno verificati.

---

## 3. Database del brand (Postgres dedicato)

Un **DB per brand**, senza eccezioni: il repository del business-service non filtra
per brand nelle scritture, quindi un DB condiviso non è isolabile.

1. Railway → nuovo Postgres **nel progetto del cliente** (`pizzeriaos-<slug>`,
   un progetto per cliente: PM + suo Postgres, business-service + suo Postgres,
   Ordinacy quando arriva). I servizi condivisi restano nel progetto `Returnacy`.
2. Applicare lo schema. Il business-service **non migra al boot** (il Dockerfile
   esegue solo `prisma generate`): lo schema va applicato **prima** del codice.

**Lezione (quieora + sudest): il nome del Postgres non lo scegli tu.**
`railway add --database postgres` **ignora `--service`**: Railway assegna un
nome come `Postgres-FFGT` / `Postgres-12oQ`. Conseguenze, entrambe verificate:

- la `DATABASE_URL` del servizio applicativo va cablata su **quel** nome esatto
  (`${{Postgres-FFGT.DATABASE_URL}}`). **Rinominare il Postgres rompe il
  servizio**;
- con due Postgres nello stesso progetto (PM e business-service) va verificato a
  mano che ciascun servizio punti al **proprio** database.

**Lezione: `DATABASE_PUBLIC_URL` può non esistere.** Il template Postgres non la
genera se il tcp-proxy viene creato **dopo** il deploy del database (successo su
`Postgres-FFGT`, non su `Postgres`). In quel caso la URL pubblica si compone a
mano da `PGUSER` + `PGPASSWORD` + `PGDATABASE` + `RAILWAY_TCP_PROXY_DOMAIN` +
`RAILWAY_TCP_PROXY_PORT`, e non si stampa mai: si mette in una variabile di
shell e si usa solo quella.

```bash
railway tcp-proxy create --port 5432 --service <nome-Postgres> --environment production
```

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

`patch.team.service.ts` rifiuta per progetto di *assegnare* ADMIN (`ALLOWED_ROLES`
non contiene `ADMIN`, né come ruolo assegnabile né come ruolo del target):
**nessuna rotta HTTP può creare un ADMIN**. La scrittura diretta sul DB è l'unica
strada, ed è per questo che è l'ultimo passo del provisioning.

#### L'ordine, e perché è questo

Il `sub` non si può inventare: nasce server-side **alla registrazione**
(`post.register.service.ts`, `crypto.randomUUID()`). Un `ADMIN_SUB` deciso a
tavolino produce un secondo account, senza ADMIN, e il titolare non se ne
accorge. Quindi:

1. la SPA del brand è **live** (§6) e il suo host è nel domain-mapper (§9);
2. **il titolare si registra da solo**, sull'host `<slug>.returnacy.app`, con
   l'email che vuole usare — da fare con lui presente, al kickoff;
3. quella registrazione crea **già** la sua `UserMembership` sul brand, con
   `role='USER'` (il tenant lo decide il domain-mapper dall'host, fail-closed);
4. solo dopo si eleva il ruolo.

#### ⚠️ L'elevazione è un UPDATE, non un INSERT — e `pnpm seed` NON va usato

`schema.prisma` ha `@@unique([userId, brandId])`: una seconda membership sullo
stesso brand è impossibile. Non esiste una via "solo INSERT".

E `seed.ts` non è la via giusta su un utente che esiste già: chiama
`upsertUserByKeycloakSub` passando **sempre** `ADMIN_NAME` / `ADMIN_SURNAME` /
`ADMIN_BIRTHDAY`, che finiscono nel ramo `update` → **sovrascrive nome, cognome e
data di nascita reali** con `Owner` / `''` / `1970-01-01` se non si ripassano
identici a quelli digitati in registrazione. Davanti al cliente, al tavolo, è un
dato suo corrotto. (In più `dist/src/seed.js` è stale rispetto a `src/seed.ts`:
chi lancia `pnpm seed` senza `pnpm build` esegue codice vecchio.)

**Procedura autorizzata: UPDATE chirurgico della sola colonna `role`, in
transazione, con baseline Che Pizza.**

```bash
# 1. READ — trovare l'utente. 0 righe = il titolare non si è registrato
#    (o ha usato un'altra email/host): FERMARSI, non inventare un sub.
psql "$DBURL" -c "SELECT id, \"keycloakSub\", email FROM \"User\" WHERE email = '<EMAIL_TITOLARE>';"

# 2. READ — fotografare il PRIMA
psql "$DBURL" -c "SELECT id, \"brandId\", \"businessId\", role FROM \"UserMembership\" WHERE \"userId\" = '<USER_ID>';"
psql "$DBURL" -c "SELECT count(*) AS chepizza_before FROM \"UserMembership\" WHERE \"brandId\" = '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47';"

# 3. WRITE — in transazione esplicita
psql "$DBURL" <<'SQL'
BEGIN;
UPDATE "UserMembership" SET role = 'ADMIN'
 WHERE "userId" = '<USER_ID>' AND "brandId" = '<BRAND_ID>';
SELECT id, "brandId", "businessId", role FROM "UserMembership" WHERE "userId" = '<USER_ID>';
SELECT count(*) AS chepizza_after FROM "UserMembership" WHERE "brandId" = '385d4ebb-4c4b-46e9-8701-0d71bfd7ce47';
COMMIT;
SQL
```

**Regola d'oro: `UPDATE 1` esatto e `chepizza_after = chepizza_before`,
altrimenti `ROLLBACK;` al posto di `COMMIT;`.**

Verifica funzionale: il titolare fa **logout e login** (il ruolo sta nei claim
del token) e vede le sezioni ADMIN. Controprova di isolamento:
`GET /api/v1/users/<id di un cliente Che Pizza>` da quel token → 403/404, mai 200.

> Non esiste una "password admin Returnacy" da consegnare al cliente: l'identità
> nasce dalla sua registrazione. Non promettergliela.
>
> Il DB identità condiviso si raggiunge da `Postgres_UserSer` nel progetto
> `Returnacy`, env `development`. Se per arrivarci si crea un tcp-proxy,
> **rimuoverlo appena finito**: apre a Internet il DB identità di tutti i brand,
> Che Pizza inclusa. Se `DATABASE_PUBLIC_URL` c'era già, non toccare nulla.

Procedura estesa, con tutte le controprove: `PizzeriaOS/briefs/reports/
2026-09-02-admin-seed-quieora-REPORT.md`, "Procedura ESATTA ripetibile al tavolo".

`SEED_DEMO_USERS=true` aggiunge 12 utenti finti: **mai** su un DB con clienti veri.

> ⚠️ `prisma migrate deploy` **non** funziona su un user-service DB vuoto: l'unica
> migration presente (`20260430160000_add_password_hash`) fa `ALTER TABLE "User"` e
> presuppone lo schema già creato via `db push`. Rilevante solo se un giorno si
> stanzia un user-service nuovo; per l'onboarding di un brand non serve.

---

## 5. Servizio business-service su Railway

Nuovo servizio nel progetto `Returnacy`, da questo repo, Dockerfile
`chepizzadasalva/business-service/server/Dockerfile`.

Variabili (i valori di JWT/servizi si prendono da `staging-notes.md`). Questo è il
set **reale** in produzione su `quieora` e `sudest` — **16 variabili, nessuna di
più**, verificato per confronto fra i due servizi:

| Var | Valore |
|---|---|
| `DATABASE_URL` | referenza al Postgres del brand (§3), es. `${{Postgres-FFGT.DATABASE_URL}}` |
| `DEFAULT_BRAND_ID` | `$BRAND_ID` — **prima del primo boot** (vedi sotto) |
| `DEFAULT_BUSINESS_ID` | `$BUSINESS_ID` — idem |
| `SELF_ISSUER` | issuer di user-service |
| `SELF_ISSUER_JWKS_URL` | `<issuer>/.well-known/jwks.json` |
| `USER_SERVICE_URL` | `https://user.returnacy.app` |
| `SERVICE_TOKEN_URL` | `https://user.returnacy.app/internal/v1/auth/service-token` |
| `SERVICE_CLIENT_ID` | **`business-service:<slug>`** (§8) |
| `SERVICE_CLIENT_SECRET` | il segreto nuovo generato al §8 |
| `USE_SELF_ISSUED_SERVICE_TOKENS` | `true` |
| `KEYCLOAK_SERVICE_AUDIENCE` | come Che Pizza (il match è per prefisso prima di `:`) |
| `REQUIRE_TENANT_SERVICE_TOKENS` | `true` — **un brand nuovo parte già stretto** |
| `MESSAGING_DRY_RUN` | `true` — **ma non controlla niente qui**: vedi §7 |
| `NODE_ENV` | `production` |
| `PORT` | la porta su cui il server ascolta |
| `RAILWAY_DOCKERFILE_PATH` | `server/Dockerfile` |

Le ultime quattro non erano in questo runbook e sono state ricostruite a mano su
entrambi i clienti: senza `RAILWAY_DOCKERFILE_PATH` Railway non trova il
Dockerfile del business-service.

- **`KEYCLOAK_AUDIENCE` NON va impostata.** Non c'è su Che Pizza, non c'è su
  quieora, non c'è su sudest. Il fix `fix/audience-prefix-match` è in produzione
  su user-service e il match per prefisso funziona: metterla ha prodotto
  `401 Invalid audience` su quieora.
- **`DEFAULT_BRAND_ID` / `DEFAULT_BUSINESS_ID` vanno messe prima del primo
  boot.** `repository.prisma.ts:13` ripiega **in silenzio** sul brand di Che
  Pizza se mancano o sono scritte male. Verifica funzionale subito dopo il
  deploy, non a occhio sulla lista env:

  ```bash
  # con un service token del brand nuovo — nessun id di Che Pizza deve comparire
  curl -s "https://<slug>.business.returnacy.app/api/v1/brand/locations" -H "Authorization: Bearer $SVC"
  ```
- `GOOGLE_WALLET_*`: **non** in questo elenco. Sono opzionali e per brand — §13.

Poi: Railway → Settings → custom domain `<slug>.business.returnacy.app`, e tornare
al §2 per il CNAME (**e l'eventuale TXT**) su Porkbun.

**Health check**: il servizio risponde **401 a tutto**, `/health` **incluso** (il
plugin di auth gira prima dell'esenzione — confermato su entrambi i clienti). Un
401 significa "vivo", ma **non esiste un health check usabile da un probe
esterno**: non configurarne uno che si aspetti 200.

---

## 6. SPA cliente su Cloudflare Pages

### 6.1 Progetto

Nuovo progetto Pages collegato a questo repo, root directory `frontend-spa`.
Cloudflare autorileva **pnpm** (`pnpm-lock.yaml` è canonico).

Build command: **`npm run build`**, non `vite build` — con `vite build` il
`prebuild` non gira, `check-brand.mjs` non viene eseguito e la rete di sicurezza
del §6.3 sparisce.

Il progetto Pages **si crea a mano dalla dashboard**: dev'essere git-connected, e
su questa macchina non c'è né `wrangler` né una credenziale Cloudflare. È un
passo manuale di Enrico, non delegabile a un agente.

### 6.2 Variabili di build

> ⚠️ **Lezione sudest, la più costosa delle due notti.** L'import in blocco di
> Cloudflare Pages, su testo incollato:
>
> - **scarta** i valori che contengono spazi (`VITE_BRAND_NAME`,
>   `VITE_BRAND_FULL_NAME`, `VITE_BRAND_DOCUMENT_TITLE`,
>   `VITE_BRAND_LEGAL_NAME`, `VITE_BRAND_LEGAL_ADDRESS` — 5 su sudest);
> - **svuota** i valori che iniziano con `#`, letti come commento
>   (`VITE_BRAND_PRIMARY`, `VITE_BRAND_PRIMARY_DARK` — 2 su sudest).
>
> Risultato: il progetto Pages di Sud Est ha buildato e **pubblicato l'identità
> legale di Che Pizza**, verde, senza un avviso.
>
> **Quindi: si importa `PizzeriaOS/clients/<slug>/generated/pages.env`**, dove
> ogni valore è fra virgolette doppie e non c'è nessun commento. Lo genera
> `PizzeriaOS/scripts/provision/gen-client-config.sh <slug>`.
>
> Il check del §6.3 ora intercetta anche questo caso (config parziale), ma la
> difesa vera è il file quotato: il check è la rete, non il piano.

Nessun valore di esempio: i dati del cliente stanno in
`PizzeriaOS/clients/<slug>/client.env`, e i `{{...}}` marcano quelli non ancora
ricevuti. Un esempio plausibile in un runbook prima o poi finisce incollato in un
progetto Pages vero.

```
VITE_BRAND_NAME=<nome commerciale>
VITE_BRAND_FULL_NAME=<nome esteso, default: VITE_BRAND_NAME>
VITE_BRAND_DOCUMENT_TITLE=<titolo della scheda browser>
VITE_BRAND_LEGAL_NAME=<ragione sociale>
VITE_BRAND_LEGAL_ADDRESS=<sede legale>
VITE_BRAND_LEGAL_TAX_CODE=<C.F. del cliente>
VITE_BRAND_LEGAL_VAT=<P. IVA del cliente>
VITE_BRAND_CONTACT_EMAIL=<email contatto privacy/ToS>
VITE_BRAND_LOGO_URL=<URL assoluto del logo>       # vuoto → logo Che Pizza nel bundle
VITE_BRAND_PRIMARY=<#RRGGBB>                      # vuoto → blu Che Pizza
VITE_BRAND_PRIMARY_DARK=<#RRGGBB>                 # opzionale: derivato da PRIMARY se assente
VITE_BRAND_ID=<BRAND_ID>
VITE_BUSINESS_ID=<BUSINESS_ID>
VITE_USER_SERVICE_URL=https://user.returnacy.app
VITE_BUSINESS_SERVICE_URL=https://<slug>.business.returnacy.app
VITE_CAMPAIGN_SERVICE_URL=<campaign-service>      # campagne congelate: si OMETTE (vedi sotto)
VITE_PM_URL=<PizzeriaManager del cliente>
VITE_FRONTEND_BASE_URL=https://<slug>.returnacy.app
VITE_GOOGLE_LOGIN_ENABLED=true                    # opzionale, solo dopo §13
```

Due note sull'import:

- **`VITE_CAMPAIGN_SERVICE_URL` si omette** invece di impostarla vuota: il codice
  fa già fallback a stringa vuota, e una riga con valore vuoto può essere
  scartata o rifiutata dall'import.
- **`VITE_GOOGLE_CLIENT_ID` non si mette qui**: è nel `.env.local` committato del
  repo e vale per tutti i brand. Da sola non accende niente — §13.

Il colore è **un solo token**, non un tema. `VITE_BRAND_PRIMARY` sostituisce il
blu Che Pizza (bottoni, icone, bordi, gradiente della carta fedeltà);
`VITE_BRAND_PRIMARY_DARK` è la tinta scura di hover/tab attivo e, se non dichiarata,
viene derivata abbassando la luminosità di 28 punti.

Dal primary vengono derivate anche le **tinte chiare**: sfondo pagina
(`--brand-surface-from` / `-to`), pannelli informativi (`--brand-tint`,
`--brand-tint-border`), link e testo su quelle tinte (`--brand-accent`,
`--brand-accent-strong`, `--brand-ink`). Due cose da sapere, entrambe spiegate
per esteso in `src/config/theme.ts`:

- gli accent vengono **scuriti finché non superano 4,5:1 su bianco** (5,5:1 per
  `-strong`, 7:1 per l'ink). Un brand caldo (arancio, giallo) ottiene quindi un
  accent visibilmente più scuro di uno freddo: è voluto — la luminosità HSL non
  è leggibilità, e un link arancio "alla blue-600" sta sotto 3:1;
- lo sfondo pagina resta **chiaro per ogni brand**, anche per un cliente la cui
  identità è scura (la card di Qui è Ora è bruno quasi nero e va benissimo così).
  Non esiste un tema dark e non va inventato qui.

Tutto il resto è identico per ogni cliente di proposito: impaginazione, scala
neutra, crema di sfondo, rosso distruttivo, palette dei grafici, e i **set di
colori che portano significato** — badge dei ruoli, canali delle campagne, le tre
icone della hero di login, i chip dei filtri CRM. Ricolorare un solo membro di un
set con la tinta del brand distrugge il set.

### 6.3 Il build fallisce se la configurazione è incompleta

`prebuild` esegue `scripts/check-brand.mjs`, che blocca:
- qualunque `VITE_*` con placeholder residuo (`{{...}}`, `TODO`, `CHANGEME`, `XXX`);
- un `VITE_BRAND_PRIMARY`/`_DARK` che non è un `#RRGGBB` valido (la SPA lo
  ignorerebbe in silenzio e resterebbe blu Che Pizza);
- un brand diverso da Che Pizza che **eredita** ragione sociale, sede legale,
  P. IVA, C.F., email o colore di Che Pizza, o che lascia vuoti logo, colore,
  `VITE_BUSINESS_ID`, gli URL dei servizi o `VITE_PM_URL` (il caso pericoloso:
  pubblicare l'identità legale di un cliente sul sito di un altro, o far leggere
  al cliente il contatore di Che Pizza);
- qualunque `VITE_*` che contenga un host `chepizzadasalva` o un id di Che Pizza
  (brandId, businessId Taggi o Lissaro), in qualsiasi variabile si sia infilato;
- **una configurazione brand a metà**: `VITE_BRAND_NAME` vuota mentre almeno
  un'altra `VITE_BRAND_*` o `VITE_BUSINESS_ID` è valorizzata. Era il buco: tutti
  i controlli qui sopra pendono da `VITE_BRAND_NAME`, e con quella vuota il
  build passava per "Che Pizza" e non veniva controllato niente — è così che la
  build rotta di sudest è passata verde. L'errore elenca le chiavi trovate;
- un `VITE_GOOGLE_LOGIN_ENABLED` che non sia esattamente `true` o `false` (un
  typo leggerebbe "off" in silenzio).

Provarlo in locale prima di configurare Cloudflare, e provarlo **dal file che si
importerà davvero**:

```bash
cd chepizzadasalva/frontend-spa
node --env-file=/path/PizzeriaOS/clients/<slug>/generated/pages.env scripts/check-brand.mjs
# deve stampare il nome del CLIENTE fra parentesi, non "Che Pizza (defaults)"
```

Il nome fra parentesi è la prova che conta: se dice `Che Pizza (defaults)`, il
ramo di controllo del brand nuovo **non è stato eseguito**.

Poi: custom domain `<slug>.returnacy.app` → CNAME su Porkbun (§2).

> Il logo: se `VITE_BRAND_LOGO_URL` è vuoto viene servito quello di Che Pizza
> incluso nel bundle. Per un brand diverso da Che Pizza il check ora lo pretende,
> ma può solo vedere che la variabile è valorizzata: che l'URL risponda davvero e
> mostri il logo giusto va guardato con gli occhi dopo il primo deploy.
>
> Il logo dei primi due clienti sta sul loro **sito vetrina** (Netlify). Quando
> il cliente cabla il suo dominio definitivo, `VITE_BRAND_LOGO_URL` va spostata
> lì e il progetto Pages ri-deployato: l'URL vecchio muore col vecchio host.
> (Su sudest: `pizzeria-sudest.netlify.app` → `pizzeriasudest.com`, ancora da
> fare.)

### 6.4 L'origine del brand va aggiunta a `CORS_ORIGIN` di user-service

**Lezione sudest, non era in nessun runbook.** user-service è condiviso e ha una
allow-list di origini. Finché `https://<slug>.returnacy.app` non è dentro, la
registrazione dalla SPA del cliente fallisce con un **"failed to fetch"** che dal
browser sembra un problema di rete: nessun errore lato server, nessun log utile.

Sul servizio `Server_UserServ` (progetto `Returnacy`, env `development`),
aggiungere l'origine alla lista **senza toccare le esistenti**, poi redeploy.

Il `*.pages.dev` del progetto Cloudflare **resta fuori di proposito**: è il
dominio di anteprima, non quello del cliente, e il rifiuto è il comportamento
voluto. Le prove di registrazione si fanno sull'host definitivo.

Verifica (read-only, senza credenziali — è quella di `verify-brand.sh`):

```bash
curl -s -i -X OPTIONS https://user.returnacy.app/api/v1/auth/register \
  -H "Origin: https://<slug>.returnacy.app" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type" | head -20
# atteso: 204 + access-control-allow-origin: https://<slug>.returnacy.app
```

---

## 7. Messaggistica — spenta di default

> **Correzione (2 Sep, verificata nel codice).** `MESSAGING_DRY_RUN` è letta
> **solo dal dispatcher del messaging-service**, che è **condiviso** (servizio
> `Server_MessServ`, progetto Railway `Returnacy`). Il business-service del
> cliente **non la legge**: metterla lì — come dicevano le versioni precedenti di
> questo §7, e come è stato fatto su quieora e sudest — non controlla niente.
> È una variabile innocua, non una salvaguardia.

Va impostata **una volta sola, sul servizio condiviso**:

```
Server_MessServ (progetto Returnacy, env development):  MESSAGING_DRY_RUN=true
```

Il dispatcher percorre tutta la pipeline (transizioni di stato, log, eventi) ma
**non chiama nessun provider**. Non impostare `RESEND_API_KEY` né
`DECISIONTELECOM_API_KEY`: "non le imposto" da solo non è un controllo — è
un'omissione che il primo copia-incolla di env annulla. Servono entrambe le cose.

**Stato reale al 2 Sep**: su `Server_MessServ` la variabile **non è impostata** e
non c'è nessuna chiave provider. Quindi oggi non parte niente — ma **per
omissione**, cioè per l'esatta ragione per cui questo paragrafo dice che
l'omissione non basta. Impostarla è un TODO aperto, e vale per tutti i brand
insieme.

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

> **Prerequisito: il §9 dev'essere già fatto e deployato.** Finché il tenant non
> è nella `domain-mapping.json`, `resolveBrandForBusiness()` non lo risolve e il
> CRM risponde **`400 TENANT_SCOPE_REQUIRED`**. Non è una rifinitura di fine
> lavoro: le probe di questo §8.1 falliscono senza. Su quieora il sintomo era
> mascherato da un 401 di audience e ha fatto perdere una sessione intera.

1. Generare un segreto: `openssl rand -base64 32 | tr -d '/+=' | head -c 32`.
2. Aggiungere `"business-service:<slug>": {"secret": "...", "brandId": "$BRAND_ID"}`
   a `INTERNAL_SERVICE_CLIENTS` su user-service (**senza toccare le righe esistenti**).
   Confrontare le voci preesistenti **per hash** prima e dopo la scrittura: è
   l'unico modo di provare che l'aggiunta è additiva. Poi `railway redeploy`.
3. Impostare `SERVICE_CLIENT_ID` / `SERVICE_CLIENT_SECRET` sul servizio del brand.
4. `REQUIRE_TENANT_SERVICE_TOKENS=true` sul brand nuovo fin dal primo giorno.
5. Verifica: `POST /api/v1/users` sul CRM del brand nuovo → **200**. Un 400
   `TENANT_SCOPE_REQUIRED` significa che manca il §9; un 401 `Invalid audience`
   significa che è stata impostata `KEYCLOAK_AUDIENCE` (§5).

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

> **Va fatto PRIMA del §8.1**, non dopo: è un prerequisito funzionale (vedi §8.1).
> È anche il prerequisito del §4.2, perché il tenant della registrazione del
> titolare viene deciso dal domain-mapper sull'host della richiesta.

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
TTL, ordine di deploy).

Il PM del cliente parte dal branch **`clean`** di PizzeriaManager. Set **reale**
in produzione su quieora e sudest — **10 variabili**, verificato per confronto:

| Var | Valore |
|---|---|
| `DATABASE_URL` | referenza al Postgres del PM (§3) |
| `SESSION_SECRET` | generato per cliente |
| `COOKIE_SECURE` | `true` |
| `PUBLIC_REGISTRATION_ENABLED` | `false` — gli account li crea il provisioning |
| `SHOP_ADMIN_DEV_ONLY` | `true` |
| `RETURNACY_ISSUER` | issuer di user-service (condiviso) |
| `RETURNACY_JWKS_URL` | `<issuer>/.well-known/jwks.json` |
| `RETURNACY_BRAND_ID` | **`$BRAND_ID`** — è il confine di sicurezza |
| `RETURNACY_REQUIRE_BRAND_CLAIM` | **`true`** su un cliente nuovo: non ha token v1 in giro |
| `RETURNACY_SHOP_MAP` | `{"<BUSINESS_ID>": <shopId del PM>}` |

Senza `RETURNACY_BRAND_ID` il PM del cliente accetta lo staff di **qualunque**
tenant Returnacy e gli crea un account Staff.

Opzionali, **per fase** — non si mettono al provisioning, si aggiungono quando
quella fase arriva:

| Var | Quando |
|---|---|
| `SERVICE_API_KEYS` | al go-live di Ordinacy (auto-chiusura OT→PM) |
| `MOBILE_JWT_SECRET`, `MOBILE_CORS_ORIGINS`, `IOS_APP_ID` | al pairing dell'app iOS |
| `ANTHROPIC_API_KEY` | se si attiva l'intake AI delle fatture |
| `MCP_JWT_SECRET`, `MCP_PUBLIC_URL` | se si attiva l'MCP del PM |

Sulla SPA Returnacy del brand: `VITE_PM_URL` = l'URL del PM del cliente.

---

## 11. Checklist di verifica finale

La parte **read-only e automatizzabile** di questa checklist (DNS dei due host,
business-service vivo, SPA servita col brand giusto, preflight CORS, PM in
piedi) è in `PizzeriaOS/scripts/provision/verify-brand.sh <slug>`: si lancia
senza credenziali e ritorna diverso da zero se manca qualcosa. Tutto il resto —
timbri, coupon, isolamento cross-tenant — richiede un token e resta a mano.

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

---

## 13. Google per brand (login + Wallet)

Entrambi i bottoni Google — "Accedi con Google" e "Salva su Google Wallet" —
sono **fail-closed su un brand nuovo**: non compaiono finché non sono
configurati. È voluto: prima di questa regola comparivano e non funzionavano,
perché ereditavano la configurazione di Che Pizza.

Sono due cose separate, con due configurazioni separate. Nessuna delle due è
obbligatoria per il go-live.

### 13.1 Login Google — client OAuth **condiviso**

Il client OAuth è uno solo (quello di Che Pizza), `VITE_GOOGLE_CLIENT_ID` è nel
`.env.local` committato e arriva quindi al build di ogni brand. Google però
rifiuta il client da qualunque origine che non gli sia stata dichiarata.

**L'ordine conta:**

1. **prima**, nella console Google, aggiungere `https://<slug>.returnacy.app`
   alle *Authorized JavaScript origins* del client OAuth (passo manuale di
   Enrico — richiede la console);
2. **poi**, sul progetto Cloudflare Pages del brand, `VITE_GOOGLE_LOGIN_ENABLED=true`
   e ri-build.

Invertirli riaccende esattamente il bottone rotto che la regola serviva a
spegnere. Se il cliente non usa il login Google, non si tocca niente: assente o
`false` = bottone nascosto, e la pagina resta email + password.

Il build di Che Pizza (nessuna `VITE_BRAND_NAME`) tiene il bottone acceso
comunque, senza bisogno della variabile. `check-brand.mjs` rifiuta qualunque
valore diverso da `true` / `false` / assente, perché un typo leggerebbe "off"
in silenzio.

### 13.2 Google Wallet — classe fedeltà **per brand**

La carta vive sotto l'issuer Returnacy (service account
`…@returnacy-466015.iam.gserviceaccount.com`). Per un cliente nuovo serve una
**classe fedeltà dedicata** creata sotto quell'issuer, e poi queste variabili
sul **business-service del cliente** (non sulla SPA):

| Var | Valore |
|---|---|
| `GOOGLE_WALLET_LOYALTY_CLASS_ID` | `<issuerId>.<Nome_Brand>` |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` | `…@returnacy-466015.iam.gserviceaccount.com` |
| `GOOGLE_WALLET_PRIVATE_KEY` | chiave del service account |
| `GOOGLE_WALLET_PROGRAM_NAME` | nome del programma fedeltà mostrato sulla carta |
| `GOOGLE_WALLET_ISSUER_NAME` | `Returnacy` |
| `GOOGLE_WALLET_ALLOWED_ORIGINS` | `https://<slug>.returnacy.app` |
| `GOOGLE_WALLET_BACKGROUND_COLOR` / `_LOGO_URI` / `_HERO_IMAGE_URI` | opzionali, estetica della carta |

`GOOGLE_WALLET_ISSUER_ID` serve **solo** se il class id non contiene già un
punto.

Il gate lato server: se `GOOGLE_WALLET_LOYALTY_CLASS_ID`,
`GOOGLE_WALLET_SERVICE_ACCOUNT_EMAIL` o `GOOGLE_WALLET_PRIVATE_KEY` manca,
`GET /api/v1/wallet/google` risponde `200 {configured:false}` e
`POST` risponde `409 WALLET_NOT_CONFIGURED`; la SPA nasconde l'intero blocco.
**Valorizzarle fa ricomparire il bottone da solo, senza ri-buildare la SPA.**

---

## 14. Dove va ogni variabile

Le sette destinazioni, e cosa vive in ciascuna. È la mappa che mancava: metà
degli errori dei primi due clienti sono stati "variabile giusta, posto sbagliato".

| Destinazione | Cos'è | Variabili |
|---|---|---|
| **PizzeriaManager del cliente** (Railway, progetto del cliente) | app accounting, branch `clean` | `DATABASE_URL`, `SESSION_SECRET`, `COOKIE_SECURE`, `PUBLIC_REGISTRATION_ENABLED`, `SHOP_ADMIN_DEV_ONLY`, `RETURNACY_ISSUER`, `RETURNACY_JWKS_URL`, `RETURNACY_BRAND_ID`, `RETURNACY_REQUIRE_BRAND_CLAIM`, `RETURNACY_SHOP_MAP` — poi, per fase: `SERVICE_API_KEYS`, `MOBILE_JWT_SECRET`, `MOBILE_CORS_ORIGINS`, `IOS_APP_ID`, `ANTHROPIC_API_KEY`, `MCP_JWT_SECRET`, `MCP_PUBLIC_URL` (§10) |
| **business-service del cliente** (Railway, progetto del cliente) | backend loyalty del brand | le 16 del §5 — poi le `GOOGLE_WALLET_*` se il cliente vuole la carta (§13.2) |
| **user-service** (CONDIVISO, progetto `Returnacy`) | piano identità di tutti i brand | +1 entry in `INTERNAL_SERVICE_CLIENTS` (§8.1), +1 origine in `CORS_ORIGIN` (§6.4). **Additive, mai sostituzioni** |
| **messaging-service** (CONDIVISO, `Server_MessServ`) | dispatcher invii | `MESSAGING_DRY_RUN=true`, una volta per tutti i brand. Nessuna chiave provider (§7) |
| **Cloudflare Pages del brand** | build della SPA | tutte le `VITE_*` del §6.2 — si importano da `generated/pages.env`, quotate (§6.2) |
| **domain-mapper** (CONDIVISO, file nel repo) | host → tenant | 1 entry in `domain-mapping.json`; **commit + redeploy**, in finestra (§9) |
| **DNS Porkbun** (`returnacy.app`) | risoluzione | CNAME `<slug>.returnacy.app`, CNAME `<slug>.business.returnacy.app`, ed eventuale TXT `_railway-verify.<slug>.business` (§2) |
| **Console Google** | origini OAuth + classe Wallet | origine `https://<slug>.returnacy.app` fra le *Authorized JavaScript origins*; classe fedeltà sotto l'issuer Returnacy (§13) |

Un brand nuovo **non** aggiunge niente a: business-service di Che Pizza, il suo
Postgres, la SPA `che-pizza-da-salva`, `campaign-service`.

---

## 15. Limiti noti al 2 Sep 2026

Da dire al cliente prima che li scopra lui, non da nascondere.

- **Email di verifica della registrazione**: il link punta a
  `FRONTEND_VERIFY_EMAIL_URL`, che è **single-value** sul servizio condiviso, e
  l'oggetto usa un `BUSINESS_NAME` anch'esso single-value. Su un secondo brand,
  quindi, l'email di verifica porta all'host sbagliato e nomina il brand
  sbagliato. Il **reset password** invece risolve già per brand: non è lo stesso
  percorso. Fix in corso, tracciato fuori da questo runbook.
- **`VITE_BRAND_LOGO_URL` punta al sito vetrina** del cliente finché non ha il
  suo dominio definitivo: va spostata e il progetto Pages ri-deployato quando il
  dominio è cablato (§6.3).
- **`MESSAGING_DRY_RUN` non è impostata** su `Server_MessServ` (§7): oggi non
  parte niente solo perché mancano anche le chiavi provider.

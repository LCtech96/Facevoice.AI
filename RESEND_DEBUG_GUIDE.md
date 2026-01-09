# Guida Debug Email Prenotazioni

## Problema: Email non ricevuta dopo prenotazione

### Step 1: Testa la configurazione di Resend

Ho creato un endpoint di test. Vai su:

```
https://www.facevoice.ai/api/test-resend
```

Questo endpoint ti dirà:
- Se `RESEND_API_KEY` è configurata
- Se Resend risponde correttamente
- Eventuali errori specifici

**Cosa aspettarti:**
- ✅ **Success**: `{"success": true, "message": "Email di test inviata con successo!"}` 
  - → Controlla la tua email `luca@facevoice.ai`
- ❌ **Error**: Leggi il messaggio di errore per capire il problema

### Step 2: Verifica la chiave API su Vercel

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard)
2. Seleziona il progetto **facevoice**
3. Vai su **Settings** → **Environment Variables**
4. Cerca `RESEND_API_KEY`
5. Verifica che:
   - ✅ La chiave sia presente
   - ✅ Sia configurata per **Production**, **Preview**, e **Development**
   - ✅ La chiave sia corretta (deve iniziare con `re_`)

### Step 3: Verifica la chiave API su Resend

1. Vai su [Resend Dashboard](https://resend.com/api-keys)
2. Verifica che la chiave API sia **attiva**
3. Controlla i **limiti di utilizzo** (100 email/giorno sul piano gratuito)

### Step 4: Controlla i Log di Vercel

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard) → **facevoice**
2. Clicca su **Logs** nel menu laterale
3. Filtra per `/api/bookings/create`
4. Cerca i log che contengono:
   - `Attempting to send booking email via Resend...`
   - `Resend API response:`
   - `✅ Booking email sent successfully` o `❌ Resend API error`

### Step 5: Verifica il dominio email

**Problema comune:** Stiamo usando `onboarding@resend.dev` che è un dominio di test.

**Soluzioni:**

#### Opzione A: Usa il dominio di test (temporaneo)
Il dominio `onboarding@resend.dev` dovrebbe funzionare, ma potrebbe avere limitazioni.
Controlla se nelle email ricevi risposte tipo "Email blocked" o "Invalid domain".

#### Opzione B: Verifica il tuo dominio (consigliato)
1. Vai su [Resend Dashboard](https://resend.com/domains)
2. Clicca **Add Domain**
3. Inserisci `facevoice.ai`
4. Aggiungi i record DNS richiesti:
   - **SPF Record**
   - **DKIM Records**
   - **DMARC (opzionale)**
5. Dopo la verifica, aggiorna il codice:
   ```typescript
   from: 'FacevoiceAI <noreply@facevoice.ai>',
   ```

### Step 6: Controlla lo spam

Le email potrebbero finire in **spam** o **posta indesiderata**. Controlla:
- Cartella spam di `luca@facevoice.ai`
- Filtri email personalizzati
- Blocchi antispam del provider email

### Step 7: Test manuale con cURL

Puoi testare Resend direttamente da terminale:

```bash
curl -X POST https://api.resend.com/emails \
  -H "Authorization: Bearer TUA_CHIAVE_API_QUI" \
  -H "Content-Type: application/json" \
  -d '{
    "from": "FacevoiceAI <onboarding@resend.dev>",
    "to": "luca@facevoice.ai",
    "subject": "Test Email",
    "html": "<p>Test email da Resend</p>"
  }'
```

Sostituisci `TUA_CHIAVE_API_QUI` con la tua chiave API di Resend.

### Possibili errori comuni

1. **"Invalid API key"**
   - → Verifica che la chiave API sia corretta su Vercel

2. **"Domain not verified"**
   - → Usa `onboarding@resend.dev` per test, oppure verifica il dominio

3. **"Rate limit exceeded"**
   - → Hai superato il limite di 100 email/giorno (piano gratuito)

4. **"Email blocked"**
   - → Il dominio di destinazione ha bloccato le email da Resend
   - → Controlla le impostazioni di sicurezza di `luca@facevoice.ai`

### Soluzione alternativa: Email via Supabase

Se Resend continua a non funzionare, possiamo configurare Supabase per inviare email:

1. Vai su Supabase Dashboard → **Authentication** → **Email Templates**
2. Configura i template email
3. Usa Supabase Auth per inviare email

Vuoi che implementi questa alternativa?


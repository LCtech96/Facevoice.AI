# Guida Setup Email per Verifica Commenti

## Problema: Email non ricevute

Se non ricevi le email di verifica, ci sono diverse cause possibili:

### 1. RESEND_API_KEY non configurato

**Sintomo**: Le email vengono solo loggate nella console, non inviate.

**Soluzione**: Configura Resend o un altro servizio email.

### 2. Opzioni per Inviare Email

#### Opzione A: Resend (Consigliato - Gratuito fino a 100 email/giorno)

1. **Crea account su [Resend](https://resend.com)**
2. **Ottieni API Key**:
   - Vai su Dashboard → API Keys
   - Crea una nuova API Key
3. **Verifica dominio** (opzionale ma consigliato):
   - Aggiungi il tuo dominio
   - Configura i record DNS
   - Oppure usa il dominio di test `onboarding@resend.dev` per sviluppo
4. **Aggiungi variabile d'ambiente**:

   **Locale (`.env.local`):**
   ```env
   RESEND_API_KEY=re_xxxxxxxxxxxxx
   ```

   **Vercel:**
   - Settings → Environment Variables
   - Aggiungi `RESEND_API_KEY` con la tua chiave

5. **Aggiorna il dominio nel codice**:
   - In `app/api/tools/[id]/comment/route.ts`, riga 27
   - Cambia `from: 'FacevoiceAI <noreply@facevoice.ai>'` con il tuo dominio verificato
   - O usa `from: 'onboarding@resend.dev'` per test

#### Opzione B: Supabase Email (Già configurato)

Supabase ha un servizio email integrato. Puoi usarlo modificando la funzione `sendVerificationEmail`:

```typescript
// Usa Supabase per inviare email
const { data, error } = await supabase.functions.invoke('send-email', {
  body: {
    to: email,
    subject: 'Verifica il tuo commento',
    html: `...`
  }
})
```

#### Opzione C: Altri Servizi

- **SendGrid**: `@sendgrid/mail`
- **Mailgun**: `mailgun.js`
- **AWS SES**: `@aws-sdk/client-ses`
- **Nodemailer**: Con SMTP personalizzato

### 3. Verifica in Sviluppo

In sviluppo locale, se `RESEND_API_KEY` non è configurato:
- Le email vengono **loggate nella console del server**
- Controlla i log del terminale dove esegui `npm run dev`
- Vedrai: `=== EMAIL DI VERIFICA (SVILUPPO) ===` con il link

### 4. Verifica in Produzione

In produzione su Vercel:
1. Controlla i **Function Logs** in Vercel Dashboard
2. Cerca errori relativi a `sendVerificationEmail`
3. Verifica che `RESEND_API_KEY` sia configurato correttamente

### 5. Test Rapido

Per testare senza configurare un servizio email:

1. Lascia un commento
2. Controlla i log del server (console o Vercel logs)
3. Copia il link di verifica dai log
4. Apri il link nel browser per verificare il commento

### 6. Troubleshooting

**Email non arriva anche con RESEND_API_KEY configurato:**
- Verifica che il dominio sia verificato in Resend
- Controlla la cartella spam
- Verifica i log di Resend Dashboard per errori
- Assicurati che l'indirizzo email sia valido

**Link di verifica non funziona:**
- Verifica che `NEXT_PUBLIC_BASE_URL` sia configurato in Vercel
- Il link deve essere: `https://tuodominio.com/api/tools/comments/verify?token=xxx`

## Soluzione Temporanea

Se vuoi testare subito senza configurare email:

1. Lascia un commento
2. Controlla i log del server (console o Vercel Function Logs)
3. Copia il link di verifica dai log
4. Apri il link per verificare il commento

Il commento funzionerà comunque, solo che devi copiare manualmente il link dai log invece di riceverlo via email.



















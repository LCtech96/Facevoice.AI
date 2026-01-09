# Setup Dominio Resend per Email Prenotazioni

## Problema Attuale

Resend sta bloccando l'invio email perché:
- Stiamo usando il dominio di test `onboarding@resend.dev`
- Questo dominio permette di inviare **SOLO** all'email associata all'account Resend (`facevoiceai@gmail.com`)
- Stiamo cercando di inviare a `luca@facevoice.ai`, che non è l'email dell'account

**Errore ricevuto:**
```
You can only send testing emails to your own email address (facevoiceai@gmail.com). 
To send emails to other recipients, please verify a domain at resend.com/domains
```

## Soluzione: Verifica Dominio su Resend

### Step 1: Accedi a Resend Dashboard

1. Vai su [Resend Dashboard](https://resend.com/domains)
2. Accedi con il tuo account (quello associato a `facevoiceai@gmail.com`)

### Step 2: Aggiungi e Verifica il Dominio

1. Clicca su **"Add Domain"**
2. Inserisci: `facevoice.ai`
3. Clicca **"Add"**

### Step 3: Configura i Record DNS

Resend ti fornirà i record DNS da aggiungere. Dovrai aggiungere:

#### Record SPF
```
Tipo: TXT
Nome: @ (o facevoice.ai)
Valore: v=spf1 include:resend.com ~all
TTL: 3600
```

#### Record DKIM (2-3 record)
```
Tipo: TXT
Nome: resend._domainkey (o simile)
Valore: [fornito da Resend]
TTL: 3600
```

#### Record DMARC (opzionale ma consigliato)
```
Tipo: TXT
Nome: _dmarc
Valore: v=DMARC1; p=none; rua=mailto:luca@facevoice.ai
TTL: 3600
```

### Step 4: Aggiungi i Record DNS

1. Accedi al pannello di controllo del tuo provider DNS (es. Cloudflare, GoDaddy, etc.)
2. Aggiungi tutti i record forniti da Resend
3. Attendi la propagazione DNS (può richiedere fino a 48 ore, ma di solito è più veloce)

### Step 5: Verifica il Dominio

1. Torna su [Resend Dashboard](https://resend.com/domains)
2. Clicca su **"Verify"** accanto al dominio `facevoice.ai`
3. Resend verificherà automaticamente i record DNS
4. Quando la verifica è completata, vedrai un segno di spunta verde ✅

### Step 6: Aggiorna le Variabili d'Ambiente

Una volta verificato il dominio, aggiungi queste variabili su **Vercel**:

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard) → Il tuo progetto
2. **Settings** → **Environment Variables**
3. Aggiungi:

```
RESEND_FROM_EMAIL=noreply@facevoice.ai
RESEND_TO_EMAIL=luca@facevoice.ai
```

**Oppure** se vuoi usare un indirizzo specifico:

```
RESEND_FROM_EMAIL=bookings@facevoice.ai
RESEND_TO_EMAIL=luca@facevoice.ai
```

### Step 7: Aggiorna il Codice (Opzionale)

Il codice è già aggiornato per usare queste variabili d'ambiente. Se non le configuri, userà:
- `fromEmail`: `onboarding@resend.dev` (dominio di test)
- `toEmail`: `facevoiceai@gmail.com` (email dell'account)

## Soluzione Temporanea (Mentre Verifichi il Dominio)

Se vuoi testare subito senza verificare il dominio, puoi:

1. Aggiungere su Vercel:
   ```
   RESEND_TO_EMAIL=facevoiceai@gmail.com
   ```

2. Le email di prenotazione arriveranno a `facevoiceai@gmail.com` invece che a `luca@facevoice.ai`

3. Puoi configurare un forward automatico da `facevoiceai@gmail.com` a `luca@facevoice.ai` nel tuo provider email

## Verifica Funzionamento

Dopo aver verificato il dominio e aggiunto le variabili d'ambiente:

1. Testa l'endpoint: `https://www.facevoice.ai/api/test-resend`
2. Dovresti ricevere un'email di test a `luca@facevoice.ai`
3. Prova a creare una prenotazione dal form
4. Controlla che l'email arrivi correttamente

## Note Importanti

- ⚠️ **Il dominio di test `onboarding@resend.dev` ha limitazioni**: può inviare solo all'email dell'account
- ✅ **Con dominio verificato**: puoi inviare a qualsiasi indirizzo email
- 📧 **Piano gratuito Resend**: 100 email/giorno
- 🔒 **Sicurezza**: I record DNS garantiscono che solo tu possa inviare email dal tuo dominio

## Supporto

Se hai problemi con la verifica del dominio:
1. Controlla che tutti i record DNS siano corretti
2. Usa uno strumento come [MXToolbox](https://mxtoolbox.com/) per verificare i record
3. Contatta il supporto Resend se la verifica non funziona dopo 48 ore


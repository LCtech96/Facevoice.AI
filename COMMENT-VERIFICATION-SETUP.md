# Sistema di Verifica Email per Commenti

## Funzionalità Implementate

1. **Richiesta Email**: Prima di pubblicare un commento, viene richiesta una email valida
2. **Verifica Email**: Viene inviata un'email di verifica al creatore del commento
3. **Commenti Non Verificati**: I commenti vengono salvati ma non sono visibili finché non vengono verificati
4. **Link di Verifica**: L'email contiene un link per verificare il commento (valido 24 ore)

## Setup Database

### 1. Esegui lo Schema SQL

Vai su [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor e esegui il contenuto di `supabase-tool-comments-schema.sql`.

Questo creerà:
- Tabella `tool_comments` con supporto per email e verifica
- Campi: `user_email`, `is_verified`, `verification_token`, `verification_expires_at`
- RLS policies per mostrare solo commenti verificati

## Configurazione Email

### Opzione 1: Resend (Consigliato)

1. Crea un account su [Resend](https://resend.com)
2. Verifica il tuo dominio
3. Ottieni la API Key
4. Aggiungi la variabile d'ambiente:

**Locale (`.env.local`):**
```env
RESEND_API_KEY=re_xxxxxxxxxxxxx
```

**Vercel:**
- Vai su Settings → Environment Variables
- Aggiungi `RESEND_API_KEY` con la tua chiave

### Opzione 2: Altri Servizi Email

Puoi modificare la funzione `sendVerificationEmail` in `app/api/tools/[id]/comment/route.ts` per usare:
- SendGrid
- Mailgun
- AWS SES
- Nodemailer con SMTP

## Flusso Utente

1. L'utente scrive un commento
2. Se non autenticato, viene richiesta l'email
3. Il commento viene salvato come "non verificato"
4. Viene inviata un'email con link di verifica
5. L'utente clicca sul link nell'email
6. Il commento viene verificato e diventa visibile
7. Il contatore commenti viene aggiornato

## Endpoint API

- `POST /api/tools/[id]/comment` - Crea un commento (richiede email)
- `GET /api/tools/comments/verify?token=xxx` - Verifica un commento tramite token
- `GET /api/tools/[id]/comments` - Ottiene solo i commenti verificati

## Note

- I commenti non verificati scadono dopo 24 ore
- Solo i commenti verificati sono visibili pubblicamente
- Gli utenti autenticati possono usare la loro email di account
- In sviluppo, le email vengono loggate nella console invece di essere inviate


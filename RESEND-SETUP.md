# Setup Resend Email

## Chiave API Configurata

La chiave API di Resend è stata aggiunta al file `.env.local` per lo sviluppo locale.

## Configurazione Vercel

Per far funzionare le email in produzione, aggiungi la variabile d'ambiente su Vercel:

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard)
2. Seleziona il progetto **Facevoice.AI**
3. Vai su **Settings** → **Environment Variables**
4. Aggiungi:
   - **Name**: `RESEND_API_KEY`
   - **Value**: `re_S3Yyfdhw_LcuLB5aTx5SZVJjTgYgWadjZ`
   - **Environment**: Seleziona tutti (Production, Preview, Development)
5. Clicca **Save**

## Dominio Email

Attualmente il codice usa il dominio di test di Resend: `onboarding@resend.dev`

### Per usare il tuo dominio (opzionale):

1. Vai su [Resend Dashboard](https://resend.com/domains)
2. Aggiungi e verifica il tuo dominio
3. Aggiorna in `app/api/tools/[id]/comment/route.ts` (riga 27):
   ```typescript
   from: 'FacevoiceAI <noreply@tuodominio.com>',
   ```

## Test

Dopo aver aggiunto la variabile su Vercel:
1. Fai un nuovo deploy (o aspetta il prossimo)
2. Prova a lasciare un commento
3. Dovresti ricevere l'email di verifica

## Limiti Resend

- **Piano gratuito**: 100 email/giorno
- **Piano Pro**: 50,000 email/mese

Per maggiori informazioni: https://resend.com/pricing















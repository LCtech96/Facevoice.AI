# 🔑 Aggiornamento GROQ_API_KEY

## ⚠️ IMPORTANTE: Aggiorna la variabile d'ambiente su Vercel

La GROQ_API_KEY deve essere aggiornata manualmente sul dashboard Vercel.

### Passi per aggiornare GROQ_API_KEY su Vercel:

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard)
2. Seleziona il progetto **Facevoice.AI**
3. Vai su **Settings** → **Environment Variables**
4. Cerca la variabile `GROQ_API_KEY`
5. Clicca su **Edit** (o **Add** se non esiste)
6. Inserisci la nuova chiave API:
   - **Name:** `GROQ_API_KEY`
   - **Value:** `[INSERISCI_LA_TUA_NUOVA_CHIAVE_GROQ_QUI]`
   - **Environment:** Seleziona tutti (Production, Preview, Development)
7. Clicca **Save**

### Dopo aver aggiornato la variabile:

1. Vai su **Deployments**
2. Clicca sui **3 puntini** (⋯) dell'ultimo deployment
3. Seleziona **Redeploy**
4. Oppure aspetta che il prossimo commit triggeri automaticamente un nuovo deploy

## 🔗 Come ottenere una nuova GROQ_API_KEY:

1. Vai su [Groq Console](https://console.groq.com/)
2. Accedi al tuo account
3. Vai su **API Keys**
4. Crea una nuova chiave API o copia una esistente
5. La chiave inizia con `gsk_...`

## ✅ Verifica:

Dopo il deploy, testa la chat AI per verificare che i modelli Groq funzionino correttamente.


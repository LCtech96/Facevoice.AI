# 🔑 Aggiornamento GEMINI_API_KEY

## ⚠️ IMPORTANTE: Aggiorna la variabile d'ambiente su Vercel

La nuova GEMINI_API_KEY deve essere aggiornata manualmente sul dashboard Vercel.

### Nuova Chiave API:
```
AIzaSyAL6Sstew_aOMW-jkS5DpKDlyeF67w-Mo8
```

### Passi per aggiornare GEMINI_API_KEY su Vercel:

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard)
2. Seleziona il progetto **Facevoice.AI**
3. Vai su **Settings** → **Environment Variables**
4. Cerca la variabile `GEMINI_API_KEY`
5. Clicca su **Edit** (o **Add** se non esiste)
6. Inserisci la nuova chiave API:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** `AIzaSyAL6Sstew_aOMW-jkS5DpKDlyeF67w-Mo8`
   - **Environment:** Seleziona tutti (Production, Preview, Development)
7. Clicca **Save**

### Dopo aver aggiornato la variabile:

1. Vai su **Deployments**
2. Clicca sui **3 puntini** (⋯) dell'ultimo deployment
3. Seleziona **Redeploy**
4. Oppure aspetta che il prossimo commit triggeri automaticamente un nuovo deploy

## 📊 Limitazioni Piano Gratuito Gemini

Secondo la [documentazione ufficiale Gemini API](https://ai.google.dev/gemini-api/docs), il piano gratuito include:

### Rate Limits:
- **Richieste per minuto:** Limitato (varia per modello)
- **Richieste per giorno:** Limitato

### Token Limits:
- **maxOutputTokens:** Fino a 8192 token (già configurato nel codice)
- **Input tokens:** Varia per modello

### Modelli Disponibili nel Piano Gratuito:
- ✅ **Gemini 2.5 Flash** - Consigliato per uso frequente
- ✅ **Gemini 2.5 Flash-Lite** - Più veloce e economico
- ✅ **Gemini 1.5 Flash** - Versione precedente
- ⚠️ **Gemini 2.5 Pro** - Potrebbe avere limiti più restrittivi
- ⚠️ **Gemini 1.5 Pro** - Potrebbe avere limiti più restrittivi

### Best Practices per Rispettare i Limiti:

1. **Usa Gemini 2.5 Flash come default** - Più efficiente per il piano gratuito
2. **Gestisci gli errori di rate limit** - Il codice gestisce già gli errori API
3. **Monitora l'uso** - Controlla periodicamente su [Google AI Studio](https://ai.google.dev/)
4. **Implementa retry logic** - In caso di rate limit, implementare backoff esponenziale

## ✅ Verifica:

Dopo il deploy, testa la chat AI per verificare che i modelli Gemini funzionino correttamente.

## 🔗 Riferimenti:

- [Gemini API Documentation](https://ai.google.dev/gemini-api/docs)
- [Gemini API Pricing](https://ai.google.dev/pricing)
- [Google AI Studio](https://ai.google.dev/)














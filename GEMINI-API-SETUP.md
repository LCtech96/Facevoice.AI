# 🤖 Gemini API - Setup e Configurazione

Questa guida spiega come configurare l'API Gemini di Google per utilizzare i modelli Gemini nella chat AI.

## 📋 Modelli Gemini Disponibili

L'applicazione supporta i seguenti modelli Gemini:

1. **Gemini 2.5 Flash** (`gemini-2.5-flash`)
   - Modello più recente e veloce
   - Supporto multimodale (testo, immagini, video)
   - Ideale per risposte rapide

2. **Gemini 2.5 Pro** (`gemini-2.5-pro`)
   - Modello più avanzato
   - Ragionamento esteso
   - Ideale per compiti complessi

3. **Gemini 1.5 Pro** (`gemini-1.5-pro`)
   - Finestra di contesto di 1M token
   - Modello avanzato per compiti complessi

4. **Gemini 1.5 Flash** (`gemini-1.5-flash`)
   - Veloce ed efficiente
   - Supporto multimodale

## 🔑 Configurazione Chiave API

### 1. Ottieni la Chiave API

1. Vai su [Google AI Studio](https://ai.google.dev/)
2. Accedi con il tuo account Google
3. Clicca su "Get API Key" o "Recupera chiave API"
4. Crea una nuova chiave API o usa una esistente
5. Copia la chiave API (formato: `AIzaSy...`)

### 2. Configurazione Locale (.env.local)

Aggiungi la seguente variabile d'ambiente nel file `.env.local` nella root del progetto:

```env
GEMINI_API_KEY=AIzaSyByqPQl2cWe5X1gX2AocopFgHipf7Ivr6o
```

**Nota:** Puoi anche usare `GOOGLE_API_KEY` come nome alternativo:

```env
GOOGLE_API_KEY=AIzaSyByqPQl2cWe5X1gX2AocopFgHipf7Ivr6o
```

### 3. Configurazione Vercel (Produzione)

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard)
2. Seleziona il tuo progetto
3. Vai su **Settings** → **Environment Variables**
4. Aggiungi una nuova variabile:
   - **Name:** `GEMINI_API_KEY`
   - **Value:** `AIzaSyByqPQl2cWe5X1gX2AocopFgHipf7Ivr6o`
   - **Environment:** Production, Preview, Development (seleziona tutti)
5. Clicca **Save**
6. **Redeploy** il progetto per applicare le modifiche

## 🚀 Funzionalità Gemini

### Multimodalità

I modelli Gemini supportano:
- **Testo:** Generazione e comprensione di testo
- **Immagini:** Analisi e generazione di immagini
- **Video:** Analisi di video (in futuro)

### Streaming

L'API Gemini supporta lo streaming delle risposte per un'esperienza più interattiva (attualmente implementato come standard, streaming in arrivo).

### Finestra di Contesto

- **Gemini 1.5 Pro:** Fino a 1M token di contesto
- **Gemini 2.5 Flash/Pro:** Finestra di contesto estesa

## 📝 Esempio di Utilizzo

Una volta configurata la chiave API, i modelli Gemini appariranno automaticamente nel selettore modelli nella chat AI:

1. Apri la chat AI
2. Clicca sull'icona delle impostazioni (Settings) in alto
3. Seleziona uno dei modelli Gemini disponibili
4. Inizia a chattare!

## 🔧 Troubleshooting

### Errore: "Gemini API key not configured"

**Causa:** La chiave API non è configurata correttamente.

**Soluzione:**
1. Verifica che la variabile `GEMINI_API_KEY` o `GOOGLE_API_KEY` sia presente in `.env.local` (locale) o nelle variabili d'ambiente di Vercel (produzione)
2. Riavvia il server di sviluppo (`npm run dev`) dopo aver aggiunto la variabile
3. Su Vercel, assicurati di fare un nuovo deploy dopo aver aggiunto la variabile

### Errore: "Invalid API key"

**Causa:** La chiave API non è valida o è stata revocata.

**Soluzione:**
1. Verifica che la chiave API sia corretta su [Google AI Studio](https://ai.google.dev/)
2. Genera una nuova chiave API se necessario
3. Aggiorna la variabile d'ambiente con la nuova chiave

### I modelli Gemini non appaiono nel selettore

**Causa:** La chiave API potrebbe non essere configurata o il componente non la rileva.

**Soluzione:**
1. Verifica che la chiave sia configurata (vedi sopra)
2. I modelli Gemini dovrebbero apparire automaticamente quando la chiave è configurata
3. Se non appaiono, controlla la console del browser per eventuali errori

## 📚 Documentazione Riferimento

- [Gemini API Documentation](https://ai.google.dev/api?hl=it)
- [Gemini API Reference](https://ai.google.dev/gemini-api/docs?hl=it)
- [Google AI Studio](https://ai.google.dev/)

## 🔒 Sicurezza

**IMPORTANTE:** 
- Non committare mai la chiave API nel repository Git
- Assicurati che `.env.local` sia nel `.gitignore`
- Usa sempre variabili d'ambiente per le chiavi API
- Su Vercel, usa le variabili d'ambiente del progetto, non hardcode nel codice

## ✨ Funzionalità Avanzate (Future)

- [ ] Streaming delle risposte in tempo reale
- [ ] Supporto per analisi di immagini
- [ ] Supporto per analisi di video
- [ ] Function calling
- [ ] Caching delle risposte















# Aggiornamento GEMINI_API_KEY (sostituisce GROQ)

## Importante: aggiorna le variabili su Vercel

Groq / Llama è stato rimosso. Usa solo `GEMINI_API_KEY` (o `GOOGLE_API_KEY`).

### Passi su Vercel

1. Vai su [Vercel Dashboard](https://vercel.com/dashboard)
2. Seleziona il progetto **Facevoice.AI**
3. Vai su **Settings** → **Environment Variables**
4. Imposta o aggiorna `GEMINI_API_KEY` con la chiave da [Google AI Studio](https://aistudio.google.com/)
5. Seleziona Production, Preview e Development
6. **Elimina** la variabile `GROQ_API_KEY` se presente
7. Salva e fai **Redeploy** dell’ultimo deployment Production

### Locale (`.env.local`)

```env
GEMINI_API_KEY=la_tua_chiave_gemini
```

Non committare mai `.env` / `.env.local` con chiavi reali.

### Modello default

- Chat e chat-widget usano `gemini-flash-latest`
- I modelli Groq Llama non sono più disponibili nel selettore

### Verifica

Dopo il redeploy, testa la chat AI e il widget. Se Gemini risponde `RESOURCE_EXHAUSTED` / crediti esauriti, ricarica i crediti su [AI Studio](https://ai.studio/projects).

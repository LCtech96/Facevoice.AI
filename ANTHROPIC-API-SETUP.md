# Claude (Anthropic) API Setup

## Configurazione

### 1. Variabili d'Ambiente

Aggiungi la seguente variabile d'ambiente:

**Locale (`.env.local`):**
```env
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

**Vercel (Environment Variables):**
1. Vai su [Vercel Dashboard](https://vercel.com/dashboard)
2. Seleziona il tuo progetto
3. Vai su **Settings** → **Environment Variables**
4. Aggiungi:
   - **Name**: `ANTHROPIC_API_KEY`
   - **Value**: `your_anthropic_api_key_here` (usa la tua chiave API)
   - **Environment**: Production, Preview, Development (seleziona tutti)

### 2. Installazione Dipendenze

Esegui:
```bash
npm install
```

Questo installerà `@anthropic-ai/sdk` che è già stato aggiunto a `package.json`.

### 3. Modelli Disponibili

I seguenti modelli Claude sono ora disponibili:

- **Claude 3 Opus** (`claude-3-opus`) - Modello più potente, ideale per ragionamento complesso
- **Claude 3 Sonnet** (`claude-3-sonnet`) - Bilanciato tra performance e velocità
- **Claude 3 Haiku** (`claude-3-haiku`) - Veloce ed efficiente, ideale per risposte rapide

### 4. Utilizzo

Una volta configurata la chiave API, i modelli Claude saranno disponibili nel selettore modelli nella chat AI.

## Documentazione

Per maggiori informazioni, consulta:
- [Anthropic Console](https://console.anthropic.com/)
- [Anthropic Documentation](https://console.anthropic.com/docs/it/home)


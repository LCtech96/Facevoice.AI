# Guida Setup Rapido

## ✅ Progetto Configurato

Il sito web è stato configurato e dovrebbe essere in esecuzione su **http://localhost:3000**

## 📸 Aggiungi la Foto del Team

Per aggiungere la foto di Luca Corrao:

1. Copia la tua foto professionale
2. Rinominala come `luca-corrao.jpg`
3. Inseriscila nella cartella: `public/team/luca-corrao.jpg`
4. Apri `components/Team.tsx` e nella riga 32, cambia:
   ```typescript
   image: '', // Percorso vuoto = usa placeholder
   ```
   con:
   ```typescript
   image: '/team/luca-corrao.jpg', // Percorso della foto
   ```

Il sito userà automaticamente questa foto nella sezione Team. Se il percorso è vuoto o la foto non viene trovata, verrà mostrato un placeholder con le iniziali "LC" (nessun errore 404).

## 🎨 Personalizzazioni

### Colori
- Sfondo: nero verdastro (#0a1a0a → #0f2a15)
- Testo: rosso corallo (#ff6b6b)

Modifica i colori in:
- `tailwind.config.ts` - Configurazione Tailwind
- `app/globals.css` - Variabili CSS e stili glass

### Chat AI
La chat AI attualmente usa una simulazione. Per connettere un vero LLM:

1. Modifica `components/AIChat.tsx`
2. Sostituisci la simulazione con una chiamata API reale nella funzione `handleSend`

Esempio:
```typescript
const response = await fetch('/api/chat', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ message: userMessage.content })
})
const data = await response.json()
```

## 🚀 Comandi Disponibili

```bash
pnpm dev        # Avvia il server di sviluppo
pnpm build      # Costruisce per produzione
pnpm start      # Avvia il server di produzione
pnpm lint       # Controlla il codice
```

## 📁 Struttura Principale

- `app/` - Pagine e layout Next.js
- `components/` - Componenti React riutilizzabili
- `public/` - File statici (immagini, ecc.)
- `tailwind.config.ts` - Configurazione Tailwind
- `app/globals.css` - Stili globali e effetti glass

## 🔧 Stack Tecnologico

- **Next.js 14** - Framework React
- **TypeScript** - Tipizzazione
- **Tailwind CSS** - Styling
- **Framer Motion** - Animazioni
- **Lucide React** - Icone

Il design utilizza l'effetto **liquid glass** (glassmorphism) con backdrop-filter per un aspetto moderno stile Apple.


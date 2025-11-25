# Facevoice AI - Website Aziendale

Sito web aziendale moderno con design liquid glass stile Apple.

## Caratteristiche

- 🎨 Design moderno con effetto liquid glass
- 💬 Chat AI integrata stile ChatGPT
- 👥 Sezione Team con profili dei membri
- 🛠️ Sezione Services con i nostri servizi
- ⭐ Sezione Clients con sistema di recensioni

## Stack Tecnologico

- **Next.js 14** - Framework React con App Router
- **TypeScript** - Tipizzazione statica
- **Tailwind CSS** - Styling utility-first
- **Framer Motion** - Animazioni fluide
- **Lucide React** - Icone moderne

## Installazione

1. Installa le dipendenze:
```bash
pnpm install
```

2. Aggiungi la foto del CEO nella cartella `public/team/luca-corrao.jpg`

3. Avvia il server di sviluppo:
```bash
pnpm dev
```

4. Apri [http://localhost:3000](http://localhost:3000) nel browser

## Struttura Progetto

```
├── app/
│   ├── globals.css      # Stili globali e liquid glass
│   ├── layout.tsx       # Layout principale
│   └── page.tsx         # Pagina principale
├── components/
│   ├── Navigation.tsx   # Barra di navigazione
│   ├── Hero.tsx         # Sezione hero
│   ├── Services.tsx     # Sezione servizi
│   ├── Team.tsx         # Sezione team
│   ├── Clients.tsx      # Sezione clienti
│   └── AIChat.tsx       # Interfaccia chat AI
└── public/
    └── team/            # Foto del team
```

## Personalizzazione

### Colori
I colori sono definiti in `tailwind.config.ts` e `app/globals.css`:
- Sfondo nero verdastro: `#0a1a0a` - `#0f2a15`
- Testo rosso corallo: `#ff6b6b`

### Chat AI
Per connettere un vero LLM, modifica `components/AIChat.tsx` e sostituisci la simulazione con una chiamata API reale.

## Note

La foto di Luca Corrao deve essere aggiunta manualmente in `public/team/luca-corrao.jpg`


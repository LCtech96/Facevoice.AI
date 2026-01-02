# 🏠 Home Feed - Setup e Configurazione

## 📋 Funzionalità Implementate

### 1. Navigation Bar Responsive
- **Desktop**: Navigation bar in alto con logo e menu orizzontale
- **Mobile**: Navigation bar in basso (stile Revolut) con icone e label
- Bottone "Home" aggiunto alla navigation

### 2. Pagina Home Feed
- Feed stile social media con card per ogni AI tool
- Ogni card include:
  - Foto di copertina
  - Categoria
  - Nome e descrizione
  - Contatori per like, commenti e condivisioni

### 3. Funzionalità Interattive

#### Like
- Click sul cuore per mettere/rimuovere like
- Contatore aggiornato in tempo reale
- Solo utenti autenticati possono mettere like
- Stato persistente (salvato su Supabase)

#### Commenti/Recensioni
- Sezione commenti espandibile
- Form per aggiungere recensioni
- Lista commenti con nome utente e data
- Solo utenti autenticati possono commentare

#### Condivisione
- Condivisione nativa (Web Share API) o copia link
- Link condivisibile: `https://facevoice.ai/home?tool={toolId}`
- Quando si clicca su un link condiviso, la pagina si apre e scrolla automaticamente al tool specifico
- Il tool viene evidenziato per 3 secondi

## 🗄️ Setup Database Supabase

### 1. Esegui lo Script SQL

Vai su [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor e esegui il contenuto di `supabase-schema.sql`.

Questo creerà:
- Tabella `ai_tools` - Tools AI principali
- Tabella `tool_likes` - Like degli utenti
- Tabella `tool_comments` - Commenti/Recensioni
- Tabella `tool_shares` - Tracciamento condivisioni
- Indici per performance
- RLS (Row Level Security) policies

### 2. Verifica le Tabelle

Dopo aver eseguito lo script, verifica che le tabelle siano state create correttamente:
- Vai su **Table Editor** nel Supabase Dashboard
- Dovresti vedere le 4 tabelle create
- La tabella `ai_tools` dovrebbe contenere 6 tools di esempio

## 🔧 Configurazione

### Variabili d'Ambiente

Assicurati di avere nel tuo `.env.local`:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key  # Opzionale, per operazioni admin
```

## 📱 Responsive Design

### Desktop (md e superiori)
- Navigation bar in alto
- Logo a sinistra, menu a destra
- Spacing superiore: `h-20`

### Mobile (sotto md)
- Navigation bar in basso
- Icone con label sotto
- Safe area support per dispositivi con notch
- Spacing inferiore: `h-20`

## 🔗 Link Condivisibili

I link condivisibili hanno il formato:
```
https://facevoice.ai/home?tool={toolId}
```

Quando un utente clicca su questo link:
1. Viene portato alla pagina `/home`
2. Il feed si carica
3. La pagina scrolla automaticamente al tool specifico
4. Il tool viene evidenziato con un ring per 3 secondi

## 🎨 Componenti Creati

### `app/home/page.tsx`
Pagina principale del feed con gestione autenticazione e redirect da link condivisi.

### `components/Feed.tsx`
Container del feed che gestisce:
- Caricamento tools
- Gestione like
- Gestione commenti
- Gestione condivisioni
- Scroll automatico a tool evidenziato

### `components/AIToolCard.tsx`
Card individuale per ogni tool con:
- Immagine di copertina
- Informazioni tool
- Bottoni interattivi (like, commenti, condivisione)
- Sezione commenti espandibile

### `components/Navigation.tsx` (Modificato)
Navigation bar responsive con:
- Layout desktop (top) e mobile (bottom)
- Bottone Home aggiunto
- Gestione autenticazione per AI Chat

## 📊 API Routes

### `GET /api/tools/[id]/like?userId={userId}`
Verifica se un utente ha messo like a un tool.

### `POST /api/tools/[id]/like`
Aggiunge o rimuove un like.

### `POST /api/tools/[id]/comment`
Aggiunge un commento/recensione.

### `GET /api/tools/[id]/comments`
Ottiene tutti i commenti di un tool.

### `POST /api/tools/[id]/share`
Registra una condivisione e aggiorna il contatore.

## 🚀 Prossimi Passi

1. **Esegui lo script SQL** in Supabase
2. **Verifica le tabelle** create
3. **Testa le funzionalità**:
   - Like su un tool
   - Aggiungi un commento
   - Condividi un tool e verifica il redirect
4. **Personalizza i tools** modificando i dati in `components/Feed.tsx` o caricandoli da Supabase

## 📝 Note

- I dati mock sono definiti in `components/Feed.tsx` nella costante `mockAITools`
- Per caricare i dati da Supabase invece dei mock, modifica `loadTools()` in `Feed.tsx`
- Le immagini di copertina usano `/team/Trinacria.png` come default
- Il sistema supporta sia utenti autenticati che non autenticati (con limitazioni)

















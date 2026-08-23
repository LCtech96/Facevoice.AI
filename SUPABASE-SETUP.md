# 🗄️ Setup Supabase - Guida Completa

## ✅ Cosa è stato fatto

1. ✅ Installato `@supabase/supabase-js`
2. ✅ Creato client Supabase (`lib/supabase.ts`)
3. ✅ Creata tabella `team_members` nel database
4. ✅ Inseriti i 7 membri del team esistenti
5. ✅ Aggiornato componente Team per caricare dati da Supabase

## 📝 Configurazione Variabili d'Ambiente

Crea un file `.env.local` nella root del progetto con:

```env
NEXT_PUBLIC_SUPABASE_URL=https://tuo-progetto.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=la_tua_anon_key_qui
SUPABASE_SERVICE_ROLE_KEY=la_tua_service_role_key_qui
GEMINI_API_KEY=la_tua_gemini_api_key_qui
```

**⚠️ IMPORTANTE:** 
- Ottieni le tue chiavi dal [Supabase Dashboard](https://supabase.com/dashboard)
- Per GEMINI_API_KEY, ottienila da [Google AI Studio](https://aistudio.google.com/)
- **NON committare mai questo file con le chiavi reali!**
- `GROQ_API_KEY` non è più usata (sostituita da Gemini)

**Nota:** Il file `.env.local` è già nel `.gitignore`, quindi le tue credenziali sono al sicuro.

## 🗄️ Configurazione Storage

### Passo 1: Crea il Bucket "team-photos"

1. Vai su [Supabase Dashboard](https://supabase.com/dashboard/project/anbkdvcnewocappmsbnc/storage/buckets)
2. Clicca su **"New bucket"**
3. Nome: `team-photos`
4. Spunta **"Public bucket"** (per permettere accesso pubblico alle immagini)
5. Clicca **"Create bucket"**

### Passo 2: Configura le Policy dello Storage

Nel bucket `team-photos`, vai su **"Policies"** e crea:

#### Policy 1: Public Access (SELECT)
- **Policy name:** Public Access
- **Allowed operation:** SELECT
- **Policy definition:**
```sql
bucket_id = 'team-photos'
```

#### Policy 2: Public Upload (INSERT)
- **Policy name:** Public can upload team photos
- **Allowed operation:** INSERT
- **Policy definition:**
```sql
bucket_id = 'team-photos'
```

## 📸 Come Caricare le Foto

### Metodo 1: Via Interfaccia Web (Raccomandato)

1. Vai sulla sezione **Team** del sito
2. Passa il mouse sopra l'immagine placeholder di un membro del team
3. Apparirà un'icona di upload
4. Clicca e seleziona l'immagine dalla tua galleria
5. L'immagine verrà caricata automaticamente su Supabase Storage

### Metodo 2: Via Supabase Dashboard

1. Vai su [Storage Dashboard](https://supabase.com/dashboard/project/anbkdvcnewocappmsbnc/storage/buckets/team-photos)
2. Clicca su **"Upload file"**
3. Crea una cartella con l'ID del membro (es: `1` per Luca Corrao)
4. Carica l'immagine nella cartella
5. L'URL verrà generato automaticamente

## 🔄 Struttura Database

### Tabella: `team_members`

| Campo | Tipo | Descrizione |
|-------|------|-------------|
| id | SERIAL | ID univoco |
| name | TEXT | Nome del membro |
| role | TEXT | Ruolo |
| description | TEXT | Descrizione |
| email | TEXT | Email |
| linkedin | TEXT | Link LinkedIn |
| image_url | TEXT | URL pubblico dell'immagine |
| image_path | TEXT | Percorso nello storage |
| created_at | TIMESTAMP | Data creazione |
| updated_at | TIMESTAMP | Data ultimo aggiornamento |

## 🚀 Prossimi Passi

1. **Crea il bucket `team-photos`** nello storage (se non esiste)
2. **Configura le policy** per permettere accesso pubblico e upload
3. **Riavvia il server** di sviluppo: `pnpm dev`
4. **Carica le foto** direttamente dal sito passando il mouse sulle immagini placeholder

## 🔍 Verifica

Dopo aver configurato tutto:

1. Vai su `http://localhost:3000` e naviga alla sezione **Team**
2. Dovresti vedere i 7 membri del team caricati da Supabase
3. Passa il mouse sopra un'immagine per vedere l'icona di upload
4. Carica una foto e verifica che venga salvata correttamente

## 📚 File Importanti

- `lib/supabase.ts` - Client Supabase per operazioni pubbliche
- `lib/supabase-admin.ts` - Client Supabase per operazioni admin (server-side)
- `components/Team.tsx` - Componente che carica e visualizza il team
- `app/api/team/route.ts` - API route per fetch dei membri
- `app/api/team/upload/route.ts` - API route per upload immagini
- `supabase-setup.sql` - SQL per setup database (già eseguito)

## ⚠️ Note di Sicurezza

- Le policy attuali permettono accesso pubblico completo. Per un ambiente di produzione, considera di limitare l'accesso.
- Il `service_role` key è molto potente - non esporlo mai nel codice client-side.
- Le immagini sono pubbliche nel bucket `team-photos` - assicurati che sia quello che vuoi.


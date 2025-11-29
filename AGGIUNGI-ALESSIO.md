# 📝 Guida per Aggiungere Alessio come Client Success Manager

## ✅ Stato Attuale

- ✅ Immagine già presente in: `public/team/Alessio professionale fv.png`
- ✅ API route creata: `app/api/team/route.ts` (supporta POST per aggiungere membri)
- ✅ Script SQL creato: `add-alessio.sql`
- ✅ Script TypeScript creato: `scripts/add-alessio.ts`
- ✅ Script Node.js creato: `scripts/add-alessio-api.js`

## 🚀 Metodi per Aggiungere Alessio al Database

### Metodo 1: Via SQL Script (Consigliato)

1. Vai su [Supabase SQL Editor](https://supabase.com/dashboard/project/anbkdvcnewocappmsbnc/sql/new)
2. Copia e incolla il contenuto di `add-alessio.sql`
3. Esegui lo script

**Oppure** usa questo comando SQL diretto:

```sql
INSERT INTO team_members (name, role, description, email, linkedin, image_url)
VALUES (
  'Alessio',
  'Client Success Manager',
  'Dedicated to ensuring client satisfaction and success, building strong relationships and driving value for our partners',
  'alessio@facevoice.ai',
  NULL,
  '/team/Alessio professionale fv.png'
)
ON CONFLICT (name) DO UPDATE
SET 
  role = EXCLUDED.role,
  description = EXCLUDED.description,
  email = EXCLUDED.email,
  image_url = EXCLUDED.image_url,
  updated_at = NOW();
```

### Metodo 2: Via API (quando il server è in esecuzione)

1. Avvia il server: `pnpm dev`
2. In un altro terminale, esegui:

```bash
curl -X POST http://localhost:3000/api/team \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Alessio",
    "role": "Client Success Manager",
    "description": "Dedicated to ensuring client satisfaction and success, building strong relationships and driving value for our partners",
    "email": "alessio@facevoice.ai",
    "image_url": "/team/Alessio professionale fv.png"
  }'
```

**Oppure** usa lo script Node.js:

```bash
node scripts/add-alessio-api.js
```

### Metodo 3: Via Script TypeScript (richiede variabili d'ambiente)

1. Assicurati di avere un file `.env.local` con:
   ```
   NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your_supabase_anon_key
   ```

2. Esegui:
   ```bash
   npx --yes tsx scripts/add-alessio.ts
   ```

## 🔍 Verifica

Dopo aver aggiunto Alessio:

1. Vai su `http://localhost:3000` (o il tuo URL di produzione)
2. Naviga alla sezione **Team**
3. Dovresti vedere Alessio con il ruolo "Client Success Manager"
4. L'immagine dovrebbe essere visibile da `/team/Alessio professionale fv.png`

## 📋 Dettagli di Alessio

- **Nome**: Alessio
- **Ruolo**: Client Success Manager
- **Email**: alessio@facevoice.ai
- **Immagine**: `/team/Alessio professionale fv.png`
- **Descrizione**: Dedicated to ensuring client satisfaction and success, building strong relationships and driving value for our partners

## 🎯 Note

- L'immagine è già presente nella cartella `public/team/`
- Il percorso dell'immagine è relativo alla root pubblica (`/team/...`)
- Se Alessio esiste già, verrà aggiornato con il nuovo ruolo


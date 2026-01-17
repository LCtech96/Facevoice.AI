# 🔧 Setup Slug Blog - Istruzioni

## ✅ Cosa è stato fatto

1. ✅ Aggiunto supporto per campo `slug` nella tabella `blog_posts`
2. ✅ Aggiornata API per generare slug automaticamente quando si crea un post
3. ✅ Migliorata ricerca per supportare sia UUID che slug
4. ✅ Creato script per generare slug per post esistenti

## 📋 Passi da seguire

### 1. Esegui la Migration SQL

Vai su [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor e esegui il contenuto del file `BLOG_ADD_SLUG_MIGRATION.sql`.

Questo script:
- Aggiunge la colonna `slug` alla tabella `blog_posts`
- Crea un indice per ricerca veloce
- Genera automaticamente slug per tutti i post esistenti

### 2. (Opzionale) Genera slug per post esistenti

Se hai post esistenti senza slug, puoi eseguire lo script TypeScript:

```bash
# Installa tsx se non ce l'hai
npm install -g tsx

# Esegui lo script
npx tsx scripts/generate-blog-slugs.ts
```

**Nota:** Lo script SQL nella migration già genera gli slug automaticamente, quindi questo passo è opzionale.

### 3. Verifica

Dopo aver eseguito la migration:

1. Vai su Supabase → Table Editor → `blog_posts`
2. Verifica che tutti i post abbiano un campo `slug` popolato
3. Controlla che lo slug per il post "Visibilità Impresa Palermo Social Media" sia `visibilita-impresa-palermo-social-media`

### 4. Test

Prova ad accedere a:
- `https://www.facevoice.ai/blog/visibilita-impresa-palermo-social-media`
- Dovrebbe funzionare correttamente!

## 🎯 Come funziona ora

- **Nuovi post**: Lo slug viene generato automaticamente dal titolo quando crei un post
- **Post esistenti**: Gli slug vengono generati dalla migration SQL
- **Ricerca**: L'API cerca prima per campo `slug`, poi per slug generato dal titolo (fallback)
- **URL supportati**: 
  - `/blog/{uuid}` → cerca per ID
  - `/blog/{slug}` → cerca per slug

## 🔍 Troubleshooting

Se un post non viene trovato:

1. Verifica che il post esista nel database
2. Controlla che il campo `slug` sia popolato
3. Verifica che lo slug corrisponda esattamente all'URL (case-insensitive)
4. Controlla i log della console per vedere quali slug sono disponibili

## 📝 Note

- Gli slug sono generati automaticamente dal titolo
- Gli slug sono unici (se due post hanno lo stesso titolo, viene aggiunto un numero: `-1`, `-2`, ecc.)
- Gli slug sono case-insensitive nella ricerca
- Gli accenti vengono rimossi automaticamente

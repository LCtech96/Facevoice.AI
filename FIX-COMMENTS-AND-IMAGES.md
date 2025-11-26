# Fix Commenti e Immagini

## Problemi Risolti

### 1. Errori API Commenti (500 Internal Server Error)
- **Causa**: Lo schema del database richiedeva `user_id` come `UUID`, ma il codice inseriva stringhe per utenti anonimi
- **Causa**: Le RLS policies richiedevano autenticazione per inserire commenti
- **Soluzione**: 
  - Modificato lo schema per accettare `TEXT` per `user_id` (supporta UUID e stringhe anonime)
  - Aggiornate le RLS policies per permettere commenti pubblici
  - Le API ora usano `SERVICE_ROLE_KEY` per bypassare RLS quando necessario

### 2. Errori Caricamento Immagini
- **Causa**: Alcune immagini esterne (vreelabs, khroma, aitryon) non erano disponibili
- **Soluzione**: 
  - Sostituite con placeholder locale (`/team/placeholder.svg`)
  - Aggiunto fallback automatico in `AIToolCard` per immagini che falliscono

### 3. Mapping Campi Commenti
- **Causa**: Il componente `AIToolCard` si aspettava `text` e `createdAt`, ma l'API restituiva `comment` e `created_at`
- **Soluzione**: Aggiornato il componente per usare i nomi corretti dei campi

## Azioni Richieste

### 1. Esegui la Migrazione Database

Vai su [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor e esegui il contenuto di `supabase-fix-comments.sql`.

Questo script:
- Modifica `user_id` da `UUID` a `TEXT` per supportare utenti anonimi
- Rimuove la policy che richiede autenticazione
- Crea una nuova policy che permette a chiunque di inserire commenti

### 2. Verifica Variabili d'Ambiente

Assicurati che `SUPABASE_SERVICE_ROLE_KEY` sia configurato in:
- `.env.local` (per sviluppo locale)
- Vercel Environment Variables (per produzione)

### 3. Test

Dopo aver eseguito la migrazione:
1. Prova ad aggiungere un commento senza essere loggato
2. Verifica che i commenti vengano salvati correttamente
3. Controlla che le immagini falliscano gracefully con il placeholder

## Note

- I commenti sono ora completamente pubblici (nessuna autenticazione richiesta)
- Gli utenti anonimi vengono identificati come "Guest" o con un ID temporaneo
- Le immagini che falliscono vengono automaticamente sostituite con un placeholder


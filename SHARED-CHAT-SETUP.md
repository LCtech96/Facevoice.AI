# 💬 Setup Chat Condivise in Tempo Reale

## 📋 Panoramica

Le chat condivise permettono a più utenti di collaborare in tempo reale sulla stessa conversazione con l'AI. Quando qualcuno condivide un link, tutti i partecipanti vedono gli stessi messaggi e possono scrivere contemporaneamente.

## 🔧 Setup Database Supabase

### 1. Esegui lo Script SQL

Vai su [Supabase Dashboard](https://supabase.com/dashboard) → SQL Editor e esegui il contenuto di `supabase-shared-chats-schema.sql`.

Questo creerà:
- Tabella `shared_chats` - Chat condivise
- Tabella `shared_chat_messages` - Messaggi delle chat condivise
- Indici per performance
- Trigger per aggiornare `updated_at`
- RLS (Row Level Security) policies per accesso pubblico
- Abilitazione di Realtime per sincronizzazione in tempo reale

### 2. Verifica Realtime

1. Vai su **Database** → **Replication** nel Supabase Dashboard
2. Verifica che `shared_chats` e `shared_chat_messages` siano abilitate per Realtime
3. Se non lo sono, abilita manualmente cliccando sul toggle

## 🚀 Come Funziona

### Per Condividere una Chat:

1. Apri una chat nella pagina AI Chat
2. Clicca sul bottone "Share" (icona Share2) in alto a destra
3. Viene creata una chat condivisa nel database
4. I messaggi esistenti vengono migrati alla chat condivisa
5. Viene generato un link di condivisione
6. Copia e condividi il link

### Per Partecipare a una Chat Condivisa:

1. Apri il link condiviso (es: `/ai-chat/shared/{chat-id}`)
2. Vedi automaticamente tutti i messaggi esistenti
3. I nuovi messaggi appaiono in tempo reale per tutti i partecipanti
4. Puoi scrivere e vedere le risposte dell'AI in tempo reale

## 🔄 Sincronizzazione in Tempo Reale

La sincronizzazione funziona tramite **Supabase Realtime**:

- Quando qualcuno invia un messaggio, viene salvato nel database
- Supabase Realtime notifica tutti i client connessi
- I messaggi appaiono automaticamente su tutti i dispositivi
- Non serve refresh della pagina

## 📝 Note Tecniche

- **RLS Policies**: Le chat condivise sono pubbliche (chiunque può leggere e scrivere)
- **Performance**: Gli indici ottimizzano le query sui messaggi
- **Scalabilità**: Supabase Realtime gestisce automaticamente la scalabilità
- **Sicurezza**: Considera di aggiungere autenticazione se necessario

## 🐛 Troubleshooting

### I messaggi non appaiono in tempo reale
- Verifica che Realtime sia abilitato per le tabelle
- Controlla la console del browser per errori
- Verifica che il canale Realtime sia sottoscritto correttamente

### Errori di permesso
- Verifica che le RLS policies siano configurate correttamente
- Controlla che le tabelle siano pubbliche o che l'utente abbia i permessi

### Messaggi duplicati
- Il sistema evita duplicati controllando gli ID dei messaggi
- Se persistono, verifica la logica di sincronizzazione








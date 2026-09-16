# Database Supabase

## File

| File | A cosa serve |
| --- | --- |
| `schema.sql` | **Fonte di verita'.** Rispecchia lo stato reale del database. Idempotente: rieseguibile senza rompere nulla. |
| `seed.sql` | Dati iniziali (membri del team, AI Tools del feed). Da eseguire dopo `schema.sql`. |
| `archive/` | Script storici gia' eseguiti in passato. **Non eseguirli**, sono solo documentazione. |

## Setup di un ambiente nuovo

Nel SQL Editor di Supabase, nell'ordine:

1. `schema.sql`
2. `seed.sql`

## Modifiche allo schema

Quando cambi il database, **aggiorna `schema.sql`**. E' l'unico file che deve
rispecchiare la realta': se ne aggiungi un altro a parte, si ricrea il problema
che questa cartella ha risolto.

## Utenti registrati

Gli utenti stanno in `auth.users` (schema Supabase Auth), non in `public`.
Non esiste una tabella `profiles`.

```sql
SELECT COUNT(*) AS utenti_totali FROM auth.users;
```

## Storico

A settembre 2026 il database conteneva 16 tabelle in `public`, ma:

- **6 non erano usate da nessuna parte** — `properties`, `posts`,
  `collaborations`, `messages`, `profiles`, `entertainment_posts`: residui di un
  progetto precedente, tutte vuote. Rimosse.
- **3 usate dal codice non esistevano** — `ai_tools`, `tool_likes`,
  `tool_shares`: definite in `archive/supabase-schema.sql`, che pero' non era
  mai stato eseguito. Like e condivisioni degli AI Tools erano rotti in
  silenzio. Create.

La causa era che ~20 script nella root definivano le stesse tabelle in modo
incoerente, senza che nessuno fosse autorevole. Di qui `schema.sql`.

# Chat interna del team — setup

La chat su `/ai-chat` gira su Claude ed e' riservata ai dipendenti.
Il widget pubblico del sito e le chat condivise restano su Gemini.

## 1. Variabile d'ambiente

Aggiungi su Vercel (e in locale in `.env.local`):

```
ANTHROPIC_API_KEY=sk-ant-...
```

La chiavi si crea dalla console Anthropic. Senza questa variabile la
chat interna risponde con un errore esplicito; il resto del sito
continua a funzionare.

## 2. Migrazione database

Esegui `supabase/migrations/2026-09-16_chat_workspace.sql` nel SQL
Editor di Supabase. Crea cinque tabelle: `chat_members`,
`chat_projects`, `user_chats`, `user_chat_messages`, `chat_usage`.

L'ultima sezione dello script abilita `luca@facevoice.ai` come admin.

## 3. Abilitare i dipendenti

Chi non e' in `chat_members` non puo' usare la chat, anche se ha un
account sul sito. Per aggiungere qualcuno:

1. il dipendente si registra normalmente su `/auth`
2. l'admin va su `/admin/usage` e inserisce la sua email

Il limite di default e' 20 USD al mese, modificabile dalla stessa pagina.

## Come funzionano i limiti

Ogni chiamata registra token e costo in `chat_usage`. Prima di ogni
richiesta il server somma la spesa del mese corrente: se ha raggiunto
il tetto, la richiesta non parte.

Il controllo e' *prima* della chiamata, quindi l'ultimo messaggio puo'
sforare di poco il limite — non si conosce il costo finche' la risposta
non e' arrivata. L'alternativa sarebbe interrompere una risposta a meta'.

Il contatore riparte il primo del mese (UTC).

## Modelli disponibili

| Modello | Input $/1M | Output $/1M |
| --- | --- | --- |
| Claude Opus 5 (default) | 5 | 25 |
| Claude Sonnet 5 | 2 | 10 |
| Claude Haiku 4.5 | 1 | 5 |

I prezzi stanno in `lib/chat-models.ts`: se Anthropic li cambia, si
aggiornano li' e il calcolo dei costi si adegua.

## Streaming

Le risposte arrivano parola per parola. La route `/api/chat` restituisce
NDJSON (un evento JSON per riga): `chat` con l'id definitivo della chat,
`delta` per ogni pezzo di testo, `done` con il messaggio salvato e il
consumo, `error` se qualcosa si rompe.

Il messaggio viene salvato su database e il consumo registrato solo a
fine stream, quando si conoscono i token effettivi. Se lo stream si
interrompe a meta', la parte gia' ricevuta viene comunque salvata.

`maxDuration = 300` in `app/api/chat/route.ts` serve perche' il default
di Vercel (10 secondi) troncherebbe le risposte lunghe. Su piano Hobby
il tetto reale e' piu' basso: se vedi risposte tagliate, e' quello.

## Progetti e istruzioni

Un progetto e' una cartella con un campo istruzioni. Le istruzioni
vengono iniettate come system prompt in ogni chat di quel progetto:
e' cosi' che si tiene separato il contesto di un cliente dall'altro.

Si modificano dalla sidebar della chat, con l'icona a ingranaggio
accanto al nome del progetto.

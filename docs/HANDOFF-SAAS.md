# Facevoice AI – riepilogo per riprendere il lavoro (SaaS clienti)

Aggiornato al 4 novembre 2026. Leggere tutto prima di iniziare: qui c'e' quello
che e' fatto, come si lavora e cosa manca.

## Regole di lavoro (da rispettare sempre)

- Rispondere in **italiano**, comandi semplici e passo passo, con **link diretti**, poche parole.
- **Database**: nessun accesso da qui. Non chiederlo. L'SQL lo esegue Luca (dare l'SQL completo).
  Il connettore Supabase disponibile e' di **Nomadiqe**: non usarlo per Facevoice.
- **Segreti**: mai mostrarli o chiederli in chat. Vanno solo nelle variabili di Vercel (le incolla Luca).
- **Commit**: in fondo sempre
  `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` e
  `Claude-Session: <link della sessione>`. Nessun nome di modello nei testi del codice.
- Solo **luca@facevoice.ai** e' amministratore completo. Non citare mai lo "smart working".
  Indirizzo: Via Vito Di Stefano 32, Terrasini (PA). P. IVA 07272010823.
- Email ai clienti: niente P.S.; invito WhatsApp +39 351 420 6353. Niente contenuti evostudios.
  Non reintrodurre la "super chat che modifica il sito".
- Non toccare i progetti Google Cloud "FacevoiceAI" e "nomadiqe-push".
- I crediti costano: richieste brevi, poche prove pesanti (Playwright solo se serve).

## Branch e pubblicazione

- `main` = sito vero (www.facevoice.ai). Le correzioni del sito si fanno su
  `claude/cool-wright-vsg5p4`, poi `git merge --no-ff` in `main` e push (Vercel pubblica da solo),
  poi `main` si unisce in `saas`.
- `saas` = piattaforma clienti in anteprima: **https://beta.facevoice.ai** (alias del branch).
  Tutto il lavoro SaaS va qui, non su main.
- Vercel: progetto `prj_GPeCYvrnpOS9glnoPUwuVH9AjVrx`, team `team_OoURXyOfNV0MkB2dLeeFqGvj`.
  Ogni tanto la build fallisce scaricando il font Google (problema di rete di Vercel): basta
  ripubblicare la stessa versione (create_deployment con deploymentId).
- Prima di `tsc` dopo un cambio di branch: `rm -rf .next/types .next/dev/types`.

## Database

- **Sito vero**: progetto Supabase `anbkdvcnewocappmsbnc` (non toccare).
- **Beta SaaS**: progetto `facevoice-saas-test` (`ofoharpnfuqcgutfslcp`), chiavi nuove sb_publishable / sb_secret.
  SQL editor: https://supabase.com/dashboard/project/ofoharpnfuqcgutfslcp/sql/new
- Migrazioni SaaS (gia' eseguite sulla beta): `supabase/migrations/2026-11-02_saas_workspaces.sql`,
  `2026-11-03_saas_inbox.sql`, `2026-11-05_saas_posts.sql` (tabella **workspace_posts**: il nome
  `scheduled_posts` e' gia' usato dal pannello admin). Tutto e' anche in `supabase/schema.sql`.
- Tabelle dei clienti: si leggono/scrivono SOLO con `workspaceDb(id)` (`lib/workspace-db.ts`),
  mai `supabaseAdmin.from()` diretto (social_channels, social_messages, social_identities,
  ai_knowledge, ai_usage, channel_connections, workspace_posts).
- Al lancio: eseguire le migrazioni sul database vero (dopo un backup), unire `saas` in `main`,
  togliere `SAAS_WEBHOOK_FORWARD_URL`, `SAAS_CRON_FORWARD_URL` e `META_WEBHOOK_CLIENTS_ONLY`.

## Meta (app FVoiceAI 1623447539171759)

- Azienda verificata, app Live, **Tech Provider** registrato e verifica dell'accesso inviata il 4/11.
- Il **login di Facebook** e' bloccato da Meta ("Funzione non disponibile") per tutte le
  configurazioni: in attesa della verifica.
- **Accesso con Instagram** funzionante (ID app Instagram 1417484803043706, chiave in Vercel
  Preview `INSTAGRAM_APP_SECRET`). Redirect: `https://beta.facevoice.ai/api/app/instagram/callback`.
- **App Review inviata il 4/11** per `instagram_business_basic` e `instagram_business_manage_messages`
  (rinnovati i permessi Pagina). Fino all'approvazione possono collegarsi solo gli account
  **Tester di Instagram** (es. nomadiqe_com).
- Da chiedere in una seconda review (con video): `instagram_business_manage_comments`,
  `instagram_business_content_publish`, poi `pages_manage_posts` per Facebook.
- Webhook: il sito vero (`app/api/webhooks/meta`) gira alla beta gli eventi dei clienti e quelli
  con firma Instagram (chiave non presente sul sito).

## Cosa fa la piattaforma clienti (beta)

Menu: Panoramica · Omnichat · Commenti · Istruzioni · Assistente (titolo "FacevoiceAI").

- Registrazione email/Google, spazi di lavoro (`lib/workspace.ts`), nome attivita' modificabile.
- Canali: email IMAP/SMTP (`lib/saas/email.ts`), Instagram con accesso Instagram
  (`lib/saas/instagram.ts`, token 60 giorni rinnovato dal cron), Pagine via Facebook (`lib/saas/meta.ts`).
  Un account collegato a uno spazio si sposta se chi accede lo controlla (`takeOverConnection`).
- **Omnichat**: messaggi + risposte AI con modalita' Spenta/Bozze/Automatica (`lib/saas/responder.ts`).
- **Commenti**: pagina a parte, risposta pubblica e privata (`lib/saas/comments.ts`).
- **Assistente** (`app/app/assistente/page.tsx`, `lib/saas/assistant.ts`, `lib/saas/posts.ts`,
  `lib/saas/publish.ts`): chat con foto; crea post con le foto o caroselli (una slide per foto,
  nell'ordine, testo sopra la foto, logo del cliente), modifica immagini con l'AI, si tocca una
  slide per correggere solo quella, programma giorno/ora, pubblica su Instagram. Risponde anche su
  messaggi e commenti ricevuti.
- Cron: il sito vero ogni minuto chiama `https://beta.facevoice.ai/api/cron/saas` (firma con
  `META_APP_SECRET`): post programmati, email, rinnovo accessi.

## Sito vero (Facevoice) – cose recenti

- Blog automatico con carosello: gancio grande, immagini AI una alla volta, colori della palette
  che ruotano; Instagram aspetta che le immagini siano pronte (`lib/blog-image.tsx`, `lib/blog-share.ts`).
- Super chat admin (`lib/lead-assistant.ts`): indicazioni per i contenuti, caroselli con le foto di
  Luca con anteprima e Pubblica, `recent_posts` / `show_post` / `carousel_from_blog` per ripubblicare.
- Pagine legali: `/privacy`, `/privacy/cancellazione-dati`, `/termini`, `/piattaforma`.

## Da fare / aperto

1. **Caricamento foto nell'Assistente**: l'archivio Supabase rispondeva con una pagina HTML.
   Ora `store()` in `lib/saas/posts.ts` carica con fetch diretto e scrive nei log
   "archivio foto: caricamento rifiutato … HTTP …". Far riprovare Luca e leggere quel log.
   Controllare che il bucket `workspace-media` esista ed e' pubblico.
2. Verificare la prima pubblicazione reale su Instagram (permesso di pubblicazione: ricollegare
   Instagram dalla pagina Instagram con `?publish=1`).
3. Seconda App Review (commenti, pubblicazione) con video.
4. Video nei post, post automatici per i clienti, collegamento Canva, menzioni nelle storie
   nell'Omnichat, WhatsApp, Gmail OAuth.
5. Al lancio: vedi "Database" sopra; Google OAuth in produzione; SMTP Resend su Supabase.

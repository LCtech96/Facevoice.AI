# 🔐 Configurazione Google OAuth con Supabase

## 📋 Credenziali Google OAuth

⚠️ **IMPORTANTE:** Le credenziali devono essere configurate nelle variabili d'ambiente o nel dashboard Supabase. Non committare mai le credenziali nel repository!

- **Client ID:** Configura nel dashboard Supabase o come variabile d'ambiente
- **Client Secret:** Configura nel dashboard Supabase o come variabile d'ambiente
- **Callback URL:** `https://anbkdvcnewocappmsbnc.supabase.co/auth/v1/callback`

## 🚀 Passi per Configurare Google OAuth in Supabase

### 1. Accedi al Dashboard Supabase

Vai su [Supabase Dashboard](https://supabase.com/dashboard/project/anbkdvcnewocappmsbnc/auth/providers)

### 2. Configura Google Provider

1. Vai su **Authentication** → **Providers**
2. Trova **Google** nella lista dei provider
3. Clicca su **Google** per aprire le impostazioni
4. Abilita il provider Google spuntando **"Enable Google provider"**
5. Inserisci le credenziali (ottieni le tue credenziali da Google Cloud Console):
   - **Client ID (for OAuth):** [Inserisci il tuo Client ID]
   - **Client Secret (for OAuth):** [Inserisci il tuo Client Secret]
6. Clicca su **Save**

### 3. Verifica le Redirect URLs

Assicurati che nella sezione **Redirect URLs** sia presente:
- `https://anbkdvcnewocappmsbnc.supabase.co/auth/v1/callback`
- `http://localhost:3000/auth/callback` (per sviluppo locale)

### 4. Configurazione Google Cloud Console (se necessario)

Se le credenziali non funzionano, verifica in [Google Cloud Console](https://console.cloud.google.com/):

1. Vai su **APIs & Services** → **Credentials**
2. Trova il tuo OAuth 2.0 Client ID
3. Verifica che nelle **Authorized redirect URIs** sia presente:
   - `https://anbkdvcnewocappmsbnc.supabase.co/auth/v1/callback`

## ✅ Funzionalità Implementate

1. **Sign In/Sign Up con Email e Password**
   - Registrazione con email
   - Login con email e password
   - Recupero password via email

2. **Sign In con Google OAuth**
   - Accesso rapido con account Google
   - Redirect automatico dopo autenticazione

3. **Protezione Chat AI**
   - La chat AI è accessibile solo agli utenti autenticati
   - Il modal di autenticazione appare automaticamente quando si accede alla pagina

4. **Logout**
   - Pulsante di logout nella sidebar
   - Redirect alla home dopo logout

## 🔧 File Modificati/Creati

- `lib/supabase-client.ts` - Client Supabase per autenticazione lato client
- `components/AuthModal.tsx` - Componente modal per autenticazione
- `app/ai-chat/page.tsx` - Pagina chat con protezione autenticazione
- `app/auth/callback/route.ts` - Route per gestire callback OAuth
- `components/AIChatSidebar.tsx` - Aggiunto pulsante logout

## 📝 Note

- L'autenticazione è obbligatoria per accedere alla Chat AI
- Le sessioni vengono mantenute tra i refresh della pagina
- Il modal di autenticazione appare automaticamente quando si clicca su "AI Chat" senza essere autenticati


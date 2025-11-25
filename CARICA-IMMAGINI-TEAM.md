# 📸 Guida per Caricare le Immagini del Team

## Metodo 1: Via Supabase Dashboard (Consigliato)

1. Vai su: https://supabase.com/dashboard/project/anbkdvcnewocappmsbnc/storage/buckets/team-photos
2. Se il bucket non esiste, crealo:
   - Nome: `team-photos`
   - Spunta "Public bucket"
3. Carica le immagini in questo modo:
   - Crea una cartella per ogni membro del team con il loro ID:
     - Cartella `1/` per Luca Corrao
     - Cartella `2/` per Sevara Urmanaeva
     - Cartella `3/` per Giuseppe Delli Paoli
     - Cartella `4/` per Sara Siddique
     - Cartella `5/` per Jonh Mcnova
     - Cartella `6/` per Leonardo Alotta
     - Cartella `7/` per Abraham Caur
   - Carica le foto nelle rispettive cartelle

4. Dopo aver caricato tutte le immagini, vai sul sito e clicca su "Sincronizza Immagini" per collegare le immagini al database

## Metodo 2: URL Diretti

Se hai già gli URL pubblici delle immagini, puoi aggiornare direttamente il database con questo SQL:

```sql
UPDATE team_members 
SET image_url = 'URL_DELL_IMMAGINE_QUI'
WHERE id = 1; -- Cambia l'ID per ogni membro
```

## Mapping Membri → ID

- ID 1: Luca Corrao - CEO & Founder
- ID 2: Sevara Urmanaeva - CMO
- ID 3: Giuseppe Delli Paoli - AI & Automation Specialist
- ID 4: Sara Siddique - Data Engineer, Data Scientist
- ID 5: Jonh Mcnova - Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)
- ID 6: Leonardo Alotta - Chief Financial Officer (CFO)
- ID 7: Abraham Caur - Product Manager (PM), UX/UI Designer

## Formati Immagini Supportati

- JPG / JPEG
- PNG
- WebP

Consigliato: immagini quadrate (1:1), minimo 400x400 pixel.


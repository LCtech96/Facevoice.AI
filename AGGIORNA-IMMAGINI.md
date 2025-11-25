# 📸 Come Aggiornare le Immagini del Team

Dopo aver rimosso la funzionalità di upload dall'interfaccia, le immagini devono essere caricate direttamente su Supabase Storage e poi collegate al database.

## Metodo 1: Via Dashboard Supabase (Consigliato)

1. **Carica le immagini nello storage:**
   - Vai su: https://supabase.com/dashboard/project/anbkdvcnewocappmsbnc/storage/buckets/team-photos
   - Crea cartelle con l'ID del membro (1, 2, 3, 4, 5, 6, 7)
   - Carica le foto nelle rispettive cartelle
   - Esempio: cartella `1/` → foto di Luca Corrao

2. **Sincronizza le immagini:**
   - Vai sul sito in localhost:3000
   - Nella sezione Team, clicca su "Sincronizza Immagini"
   - Le immagini verranno automaticamente collegate al database

## Metodo 2: Via API (Per sviluppatori)

Usa questa API route per aggiornare direttamente gli URL:

```bash
curl -X POST http://localhost:3000/api/admin/set-team-images \
  -H "Content-Type: application/json" \
  -d '{
    "images": [
      {
        "memberId": 1,
        "imageUrl": "https://anbkdvcnewocappmsbnc.supabase.co/storage/v1/object/public/team-photos/1/foto.jpg",
        "imagePath": "1/foto.jpg"
      }
    ]
  }'
```

## Mapping ID Membri

- **ID 1:** Luca Corrao - CEO & Founder
- **ID 2:** Sevara Urmanaeva - CMO
- **ID 3:** Giuseppe Delli Paoli - AI & Automation Specialist
- **ID 4:** Sara Siddique - Data Engineer, Data Scientist
- **ID 5:** Jonh Mcnova - Prompt Engineer, DevOps Engineer / Site Reliability Engineer (SRE)
- **ID 6:** Leonardo Alotta - Chief Financial Officer (CFO)
- **ID 7:** Abraham Caur - Product Manager (PM), UX/UI Designer

## Formato URL Immagini

Le immagini devono essere accessibili pubblicamente. Il formato URL è:
```
https://anbkdvcnewocappmsbnc.supabase.co/storage/v1/object/public/team-photos/{memberId}/{filename}
```

## Formati Supportati

- JPG / JPEG
- PNG
- WebP

Consigliato: immagini quadrate (1:1), minimo 400x400 pixel per una migliore qualità.


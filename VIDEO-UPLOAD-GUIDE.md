# 📹 Guida al Caricamento Video su Supabase

## 🎯 Panoramica

Questa guida spiega come caricare video per gli AI Tools nel Feed. I video vengono salvati su Supabase Storage e possono essere visualizzati nelle card degli AI Tools.

## 📋 Prerequisiti

1. Account Supabase configurato
2. Bucket Storage creato su Supabase
3. Variabili d'ambiente configurate

## 🔧 Setup Supabase Storage

### 1. Crea il Bucket per i Video

1. Vai su [Supabase Dashboard](https://supabase.com/dashboard)
2. Seleziona il tuo progetto
3. Vai su **Storage** nel menu laterale
4. Clicca su **New bucket**
5. Nome bucket: `ai-tools-videos`
6. Imposta come **Public** (per permettere l'accesso pubblico ai video)
7. Clicca su **Create bucket**

### 2. Configura le Policy RLS (Row Level Security)

1. Vai su **Storage** → **Policies** → `ai-tools-videos`
2. Crea una policy per permettere l'upload:
   - **Policy Name**: `Allow public uploads`
   - **Allowed Operation**: `INSERT`
   - **Policy Definition**: 
     ```sql
     (bucket_id = 'ai-tools-videos')
     ```
3. Crea una policy per permettere la lettura:
   - **Policy Name**: `Allow public reads`
   - **Allowed Operation**: `SELECT`
   - **Policy Definition**: 
     ```sql
     (bucket_id = 'ai-tools-videos')
     ```

## 📤 Come Caricare un Video

### Metodo 1: Tramite API (Programmatico)

```typescript
// Esempio di upload video
const uploadVideo = async (toolId: string, videoFile: File) => {
  const formData = new FormData()
  formData.append('file', videoFile)

  const response = await fetch(`/api/tools/${toolId}/upload-video`, {
    method: 'POST',
    body: formData,
  })

  const data = await response.json()
  
  if (data.success) {
    console.log('Video URL:', data.videoUrl)
    // Usa data.videoUrl per aggiornare il tool
  }
}
```

### Metodo 2: Tramite Supabase Dashboard

1. Vai su **Storage** → `ai-tools-videos`
2. Clicca su **Upload file**
3. Seleziona il video
4. Scegli la cartella (es: `higgsfield/` per il tool Higgsfield)
5. Clicca su **Upload**
6. Copia l'URL pubblico del video

### Metodo 3: Tramite Supabase Client (Frontend)

```typescript
import { createClient } from '@/lib/supabase-client'

const uploadVideoToSupabase = async (toolId: string, videoFile: File) => {
  const supabase = createClient()
  
  const fileExtension = videoFile.name.split('.').pop()
  const fileName = `${toolId}/${Date.now()}.${fileExtension}`
  const filePath = `ai-tools-videos/${fileName}`

  // Upload
  const { data, error } = await supabase.storage
    .from('ai-tools-videos')
    .upload(filePath, videoFile, {
      contentType: videoFile.type,
      upsert: false,
    })

  if (error) {
    console.error('Upload error:', error)
    return null
  }

  // Ottieni URL pubblico
  const { data: { publicUrl } } = supabase.storage
    .from('ai-tools-videos')
    .getPublicUrl(filePath)

  return publicUrl
}
```

## 🎬 Aggiungere Video a un AI Tool

### Opzione 1: Modifica Diretta nel Codice

Aggiungi il campo `videoUrl` al tool in `components/Feed.tsx`:

```typescript
{
  id: 'higgsfield',
  name: 'Higgsfield',
  description: '...',
  coverImage: 'https://...',
  category: 'Video & Stile',
  link: 'https://...',
  videoUrl: 'https://your-project.supabase.co/storage/v1/object/public/ai-tools-videos/higgsfield/video.mp4',
  likes: 342,
  comments: 56,
  shares: 89,
}
```

### Opzione 2: Tramite Database (Se hai tabella ai_tools)

```sql
UPDATE ai_tools 
SET video_url = 'https://your-project.supabase.co/storage/v1/object/public/ai-tools-videos/higgsfield/video.mp4'
WHERE id = 'higgsfield';
```

## 📝 Formati Video Supportati

- **MP4** (consigliato) - H.264 codec
- **WebM** - VP9 codec
- **MOV** - QuickTime
- **AVI** - Meno comune

**Raccomandazione**: Usa MP4 con codec H.264 per la massima compatibilità.

## ⚠️ Limitazioni

- **Dimensione massima**: 500MB per video
- **Durata consigliata**: 30-60 secondi per video di anteprima
- **Risoluzione consigliata**: 1080p (1920x1080) o inferiore per ottimizzare le dimensioni

## 🔍 Verifica Video Caricato

1. Vai su **Storage** → `ai-tools-videos`
2. Trova il video caricato
3. Clicca su di esso per vedere i dettagli
4. Copia l'URL pubblico
5. Testa l'URL nel browser per verificare che il video si carichi

## 🎨 Best Practices

1. **Ottimizza i video prima dell'upload**:
   - Usa tool come [HandBrake](https://handbrake.fr/) o [FFmpeg](https://ffmpeg.org/)
   - Comprimi i video mantenendo una buona qualità
   - Usa risoluzione 1080p o inferiore

2. **Organizza i file**:
   - Crea una cartella per ogni tool: `higgsfield/`, `runway/`, ecc.
   - Usa nomi file descrittivi: `demo.mp4`, `tutorial.mp4`

3. **Considera CDN**:
   - Supabase Storage usa CDN per distribuire i video
   - I video vengono serviti rapidamente in tutto il mondo

## 🐛 Troubleshooting

### Video non si carica
- Verifica che il bucket sia pubblico
- Controlla le policy RLS
- Verifica l'URL del video

### Video troppo grande
- Comprimi il video prima dell'upload
- Usa una risoluzione inferiore
- Considera di usare un servizio di streaming esterno (YouTube, Vimeo)

### Video non si riproduce nel browser
- Verifica il formato del video (usa MP4)
- Controlla che il codec sia supportato (H.264)
- Verifica i CORS settings su Supabase

## 📚 Risorse Utili

- [Supabase Storage Docs](https://supabase.com/docs/guides/storage)
- [Video Optimization Guide](https://web.dev/fast/#optimize-your-images-and-video)
- [FFmpeg Compression Guide](https://trac.ffmpeg.org/wiki/Encode/H.264)











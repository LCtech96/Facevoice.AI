# 📸 Come Aggiungere le Foto del Team

## Passo 1: Prepara le Immagini
- Formato consigliato: JPG o PNG
- Dimensioni consigliate: minimo 400x400 pixel (quadrata)
- Nomi file:
  - `luca-corrao.jpg` (o `.png`)
  - `sevara-urmanaeva.jpg` (o `.png`)

## Passo 2: Carica le Immagini
Copia i file nella cartella: `public/team/`

Dovresti avere:
```
public/
  team/
    luca-corrao.jpg
    sevara-urmanaeva.jpg
    README.md
```

## Passo 3: Verifica i Percorsi nel Codice
Apri `components/Team.tsx` e verifica che i percorsi siano corretti:

```typescript
{
  name: 'Luca Corrao',
  image: '/team/luca-corrao.jpg', // ✅ Percorso corretto
  ...
},
{
  name: 'Sevara Urmanaeva',
  image: '/team/sevara-urmanaeva.jpg', // ✅ Percorso corretto
  ...
}
```

**Nota:** I percorsi devono iniziare con `/team/` e puntare al file nella cartella `public/team/`

## Passo 4: Riavvia il Server
Dopo aver aggiunto le immagini:
1. Ferma il server (Ctrl+C)
2. Riavvia con: `pnpm dev`
3. Ricarica la pagina nel browser (F5 o Ctrl+R)

## 🔍 Verifica
Se le immagini non si vedono:
1. Controlla che i nomi file siano esattamente come indicato (case-sensitive)
2. Verifica che i file siano nella cartella `public/team/`
3. Controlla la console del browser per eventuali errori
4. Assicurati che i percorsi nel codice corrispondano ai nomi file

## ✨ Risultato
Le foto verranno visualizzate automaticamente. Se un'immagine non viene trovata, verrà mostrato un placeholder con le iniziali.


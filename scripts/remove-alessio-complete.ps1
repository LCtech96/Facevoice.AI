# Script completo per rimuovere Alessio
$env:GIT_PAGER = 'cat'
$env:GIT_EDITOR = 'echo'

Write-Host "RIMOZIONE COMPLETA DI ALESSIO" -ForegroundColor Red
Write-Host ""

# Carica variabili d'ambiente
if (Test-Path ".env.local") {
    Get-Content .env.local | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    Write-Host "Variabili d'ambiente caricate" -ForegroundColor Green
} else {
    Write-Host "File .env.local non trovato" -ForegroundColor Red
    exit 1
}

# Rimuovi dal database
Write-Host "Rimuovendo Alessio dal database..." -ForegroundColor Cyan
$result = npx --yes tsx scripts/remove-alessio.ts 2>&1
Write-Host $result

Write-Host ""
Write-Host "Rimuovendo file locali di Alessio..." -ForegroundColor Cyan

# Rimuovi l'immagine se esiste
$imageFiles = Get-ChildItem "public/team" -Filter "*Alessio*" -ErrorAction SilentlyContinue
if ($imageFiles) {
    foreach ($file in $imageFiles) {
        git rm "public/team/$($file.Name)"
        Write-Host "  Rimossa: $($file.Name)" -ForegroundColor Green
    }
}

# Rimuovi i file di script relativi ad Alessio
Write-Host "Rimuovendo script e documentazione di Alessio..." -ForegroundColor Cyan
$filesToRemove = @(
    "scripts/add-alessio.ts",
    "scripts/add-alessio-api.js",
    "add-alessio.sql",
    "AGGIUNGI-ALESSIO.md",
    "scripts/deploy-alessio.ps1"
)

foreach ($file in $filesToRemove) {
    if (Test-Path $file) {
        git rm $file -ErrorAction SilentlyContinue
        Write-Host "  Rimosso: $file" -ForegroundColor Green
    }
}

# Aggiungi i nuovi file di rimozione
git add scripts/remove-alessio.ts
git add remove-alessio.sql
git add scripts/remove-alessio-complete.ps1

# Rimuovi Alessio da supabase-setup.sql
Write-Host "Aggiornando supabase-setup.sql..." -ForegroundColor Cyan
git add supabase-setup.sql

# Commit e push
$stagedFiles = git diff --cached --name-only
if ($stagedFiles) {
    Write-Host ""
    Write-Host "Creazione commit..." -ForegroundColor Cyan
    git commit -m "feat: Remove Alessio completely from team - remove all files, images, and database entries"
    
    Write-Host "Push su GitHub..." -ForegroundColor Cyan
    git push origin main
    
    Write-Host ""
    Write-Host "RIMOZIONE COMPLETATA CON SUCCESSO!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Riepilogo:" -ForegroundColor Cyan
    Write-Host "  - Alessio rimosso dal database" -ForegroundColor Green
    Write-Host "  - Immagine rimossa" -ForegroundColor Green
    Write-Host "  - Script e documentazione rimossi" -ForegroundColor Green
    Write-Host "  - Modifiche committate e pushate" -ForegroundColor Green
    Write-Host ""
    Write-Host "Vercel ricostruira il sito - Alessio non sara piu visibile" -ForegroundColor Cyan
} else {
    Write-Host "Nessuna modifica da committare" -ForegroundColor Yellow
}

Write-Host ""


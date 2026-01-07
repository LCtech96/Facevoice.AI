# Script finale per rimuovere Mattia Orlando
$env:GIT_PAGER = 'cat'
$env:GIT_EDITOR = 'echo'

Write-Host "RIMOZIONE DEFINITIVA DI MATTIA ORLANDO" -ForegroundColor Red
Write-Host ""

# Carica le variabili d'ambiente
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

# Verifica se SERVICE_ROLE_KEY esiste
if (-not $env:SUPABASE_SERVICE_ROLE_KEY) {
    Write-Host ""
    Write-Host "ATTENZIONE: SUPABASE_SERVICE_ROLE_KEY non trovata" -ForegroundColor Yellow
    Write-Host "Esegui lo script SQL direttamente su Supabase:" -ForegroundColor Yellow
    Write-Host "  remove-mattia-definitive.sql" -ForegroundColor Cyan
    Write-Host ""
    Write-Host "Oppure aggiungi SUPABASE_SERVICE_ROLE_KEY al file .env.local" -ForegroundColor Yellow
    Write-Host ""
    
    # Prova comunque con lo script normale
    Write-Host "Tentativo con script normale..." -ForegroundColor Cyan
    $result = npx --yes tsx scripts/verify-and-remove-mattia.ts 2>&1
    Write-Host $result
} else {
    Write-Host "Esecuzione rimozione con privilegi admin..." -ForegroundColor Cyan
    $result = npx --yes tsx scripts/remove-mattia-admin.ts 2>&1
    Write-Host $result
}

Write-Host ""
Write-Host "ISTRUZIONI FINALI:" -ForegroundColor Yellow
Write-Host "1. Se la card e ancora visibile, esegui questo SQL su Supabase:" -ForegroundColor Yellow
Write-Host "   File: remove-mattia-definitive.sql" -ForegroundColor Cyan
Write-Host ""
Write-Host "2. Pulisci la cache del browser:" -ForegroundColor Yellow
Write-Host "   - Hard refresh: Ctrl+Shift+R (Windows) o Cmd+Shift+R (Mac)" -ForegroundColor Cyan
Write-Host "   - Oppure apri in modalita incognito" -ForegroundColor Cyan
Write-Host ""
Write-Host "3. Vercel potrebbe avere cache CDN - aspetta qualche minuto" -ForegroundColor Yellow
Write-Host "   oppure forza un nuovo deploy da Vercel Dashboard" -ForegroundColor Yellow
Write-Host ""

# Commit dei file
Write-Host "Aggiungendo file finali..." -ForegroundColor Cyan
git add remove-mattia-definitive.sql
git add scripts/remove-mattia-admin.ts
git add scripts/remove-mattia-final.ps1

$stagedFiles = git diff --cached --name-only
if ($stagedFiles) {
    git commit -m "fix: Add definitive SQL script to remove Mattia Orlando"
    git push origin main
    Write-Host ""
    Write-Host "File committati e pushati" -ForegroundColor Green
}

Write-Host ""














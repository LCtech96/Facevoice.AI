# Script per forzare la rimozione completa di Mattia Orlando
$env:GIT_PAGER = 'cat'
$env:GIT_EDITOR = 'echo'

Write-Host "FORZATURA RIMOZIONE COMPLETA DI MATTIA ORLANDO" -ForegroundColor Red
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
    Write-Host "File .env.local non trovato" -ForegroundColor Yellow
    Write-Host "Esegui manualmente lo script SQL: remove-mattia-complete.sql" -ForegroundColor Yellow
    exit 1
}

# Esegui lo script di verifica e rimozione
Write-Host "Esecuzione rimozione forzata..." -ForegroundColor Cyan
$result = npx --yes tsx scripts/verify-and-remove-mattia.ts 2>&1
Write-Host $result

Write-Host ""
Write-Host "IMPORTANTE:" -ForegroundColor Yellow
Write-Host "1. Se la card e ancora visibile, potrebbe essere cache del browser" -ForegroundColor Yellow
Write-Host "2. Prova a fare hard refresh: Ctrl+Shift+R (Windows) o Cmd+Shift+R (Mac)" -ForegroundColor Yellow
Write-Host "3. Vercel potrebbe avere cache CDN - potrebbe servire qualche minuto" -ForegroundColor Yellow
Write-Host "4. Se necessario, esegui lo script SQL: remove-mattia-complete.sql su Supabase" -ForegroundColor Yellow
Write-Host ""

# Aggiungi i file e fai commit
Write-Host "Aggiungendo file di rimozione completa..." -ForegroundColor Cyan
git add scripts/verify-and-remove-mattia.ts
git add remove-mattia-complete.sql
git add scripts/force-remove-mattia.ps1

$stagedFiles = git diff --cached --name-only
if ($stagedFiles) {
    git commit -m "fix: Force complete removal of Mattia Orlando from team"
    git push origin main
    Write-Host ""
    Write-Host "Commit e push completati" -ForegroundColor Green
    Write-Host "Vercel ricostruira il sito - la card dovrebbe scomparire" -ForegroundColor Cyan
}

Write-Host ""












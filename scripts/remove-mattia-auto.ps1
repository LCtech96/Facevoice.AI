# Script per rimuovere Mattia Orlando automaticamente
$env:GIT_PAGER = 'cat'
$env:GIT_EDITOR = 'echo'

Write-Host "Rimozione automatica di Mattia Orlando dal team..." -ForegroundColor Cyan
Write-Host ""

# Carica le variabili d'ambiente da .env.local
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
    Write-Host "Esegui manualmente lo script SQL in Supabase: remove-mattia.sql" -ForegroundColor Yellow
    exit 1
}

# Esegui lo script TypeScript
Write-Host "Rimuovendo Mattia dal database..." -ForegroundColor Cyan
$result = npx --yes tsx scripts/remove-mattia.ts 2>&1
Write-Host $result

if ($LASTEXITCODE -eq 0) {
    Write-Host ""
    Write-Host "RIMOZIONE COMPLETATA!" -ForegroundColor Green
    Write-Host ""
    Write-Host "Se Mattia non e stato rimosso dal database, esegui:" -ForegroundColor Yellow
    Write-Host "Lo script SQL in remove-mattia.sql su Supabase" -ForegroundColor Yellow
} else {
    Write-Host ""
    Write-Host "Errore durante la rimozione dal database" -ForegroundColor Yellow
    Write-Host "Esegui manualmente lo script SQL in Supabase: remove-mattia.sql" -ForegroundColor Yellow
}

Write-Host ""














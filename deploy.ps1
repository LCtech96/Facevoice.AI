# Script per committare e pushare le modifiche su Vercel
# Disabilita il pager di git
$env:GIT_PAGER = 'cat'
$env:GIT_EDITOR = 'echo'

Write-Host "Staging delle modifiche..."
git add app/api/chat/route.ts

Write-Host "Creazione del commit..."
git commit -m "fix: Add type assertion to fix Groq SDK type error in chat route"

Write-Host "Push su GitHub..."
git push origin main

Write-Host "`nDeploy completato! Vercel dovrebbe rilevare automaticamente il nuovo commit e avviare un nuovo build."















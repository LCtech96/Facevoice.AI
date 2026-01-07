# Configure git to not use pager
$env:GIT_PAGER = ''
$env:GIT_EDITOR = 'echo'

# Stage the file
git add app/api/chat/route.ts

# Commit with message
git commit -m "fix: Add type assertion to fix Groq SDK type error in chat route"

# Push to remote
git push origin main

Write-Host "Changes committed and pushed successfully!"



















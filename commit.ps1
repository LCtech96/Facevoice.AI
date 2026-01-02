# Abort rebase and commit changes
$env:GIT_PAGER = ''
$env:GIT_EDITOR = 'echo'

# Remove rebase directory if it exists
if (Test-Path .git\rebase-merge) {
    Remove-Item -Recurse -Force .git\rebase-merge
}

# Stage changes
git add app/ai-chat/page.tsx

# Commit changes
git commit -m "fix: Update Trinacria image extension from .png to .jpg"

# Push to remote
git push origin main

















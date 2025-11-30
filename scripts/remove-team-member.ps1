# Script automatico per rimuovere un membro del team
param(
    [Parameter(Mandatory=$true)]
    [string]$MemberName
)

$env:GIT_PAGER = 'cat'
$env:GIT_EDITOR = 'echo'

Write-Host "Rimozione di $MemberName dal team..." -ForegroundColor Cyan
Write-Host ""

# Step 1: Prova a rimuovere dal database se possibile
if (Test-Path ".env.local") {
    Write-Host "File .env.local trovato" -ForegroundColor Green
    
    # Carica le variabili d'ambiente
    Get-Content .env.local | ForEach-Object {
        if ($_ -match '^\s*([^#][^=]+)=(.*)$') {
            $name = $matches[1].Trim()
            $value = $matches[2].Trim()
            [Environment]::SetEnvironmentVariable($name, $value, "Process")
        }
    }
    
    $supabaseUrl = $env:NEXT_PUBLIC_SUPABASE_URL
    $supabaseKey = $env:NEXT_PUBLIC_SUPABASE_ANON_KEY
    
    if ($supabaseUrl -and $supabaseKey) {
        Write-Host "Variabili Supabase trovate" -ForegroundColor Green
        Write-Host "Rimuovendo $MemberName dal database..." -ForegroundColor Cyan
        
        # Crea uno script temporaneo per rimuovere il membro
        $scriptContent = @"
// Script per rimuovere $MemberName dal team
import { supabase } from '../lib/supabase'

async function removeMember() {
  try {
    const { data: members, error: searchError } = await supabase
      .from('team_members')
      .select('id, name, role, image_path')
      .or('name.ilike.%$MemberName%')

    if (searchError) {
      console.error('Errore durante la ricerca:', searchError)
      return
    }

    if (!members || members.length === 0) {
      console.log('⚠️  $MemberName non trovato nel database')
      return
    }

    console.log(`Trovati ` + members.length + ` membro/i corrispondenti:`)
    members.forEach(member => {
      console.log(`  - ID: ` + member.id + `, Nome: ` + member.name + `, Ruolo: ` + member.role)
    })

    for (const member of members) {
      if (member.image_path) {
        const { error: deleteImageError } = await supabase.storage
          .from('team-photos')
          .remove([member.image_path])

        if (deleteImageError) {
          console.warn(`⚠️  Errore durante la rimozione dell'immagine:`, deleteImageError.message)
        } else {
          console.log(`✅ Immagine rimossa dallo storage`)
        }
      }

      const { error: deleteError } = await supabase
        .from('team_members')
        .delete()
        .eq('id', member.id)

      if (deleteError) {
        console.error(`❌ Errore durante la rimozione:`, deleteError)
      } else {
        console.log(`✅ ` + member.name + ` (ID: ` + member.id + `) rimosso con successo!`)
      }
    }

    console.log('✅ Rimozione completata!')
  } catch (error) {
    console.error('Errore inaspettato:', error)
  }
}

removeMember()
"@
        
        $tempScript = "scripts/remove-temp-$([System.Guid]::NewGuid().ToString('N').Substring(0,8)).ts"
        $scriptContent | Out-File -FilePath $tempScript -Encoding UTF8
        
        try {
            $result = npx --yes tsx $tempScript 2>&1
            Write-Host $result
            if ($LASTEXITCODE -eq 0) {
                Write-Host "Membro rimosso dal database!" -ForegroundColor Green
            }
        } catch {
            Write-Host "Errore durante la rimozione dal database" -ForegroundColor Yellow
            Write-Host "Esegui manualmente lo script SQL in Supabase" -ForegroundColor Yellow
        } finally {
            if (Test-Path $tempScript) {
                Remove-Item $tempScript -Force
            }
        }
    } else {
        Write-Host "Variabili Supabase non trovate" -ForegroundColor Yellow
        Write-Host "Esegui manualmente lo script SQL in Supabase" -ForegroundColor Yellow
    }
} else {
    Write-Host "File .env.local non trovato" -ForegroundColor Yellow
    Write-Host "Esegui manualmente lo script SQL in Supabase" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "Preparazione del commit..." -ForegroundColor Cyan

# Step 2: Verifica git
$gitStatus = git status --porcelain 2>&1
if ($LASTEXITCODE -ne 0) {
    Write-Host "Errore: repository git non valido" -ForegroundColor Red
    exit 1
}

# Step 3: Rimuovi l'immagine se esiste
$imageFiles = Get-ChildItem "public/team" -Filter "*$MemberName*" -ErrorAction SilentlyContinue
if ($imageFiles) {
    Write-Host "Rimuovendo immagini di $MemberName..." -ForegroundColor Cyan
    foreach ($file in $imageFiles) {
        git rm "public/team/$($file.Name)"
        Write-Host "  - Rimossa: $($file.Name)" -ForegroundColor Green
    }
}

# Step 4: Aggiungi i file di script
git add scripts/remove-mattia.ts
git add remove-mattia.sql
git add scripts/remove-team-member.ps1

# Step 5: Commit
$stagedFiles = git diff --cached --name-only
if ($stagedFiles) {
    Write-Host "File aggiunti al staging area" -ForegroundColor Green
    
    Write-Host "Creazione del commit..." -ForegroundColor Cyan
    $commitMessage = "feat: Remove $MemberName from team"
    git commit -m $commitMessage
    
    if ($LASTEXITCODE -eq 0) {
        Write-Host "Commit creato con successo!" -ForegroundColor Green
        
        # Step 6: Push
        Write-Host "Push su GitHub..." -ForegroundColor Cyan
        git push origin main
        
        if ($LASTEXITCODE -eq 0) {
            Write-Host ""
            Write-Host "RIMOZIONE COMPLETATA CON SUCCESSO!" -ForegroundColor Green
            Write-Host ""
            Write-Host "Riepilogo:" -ForegroundColor Cyan
            Write-Host "  - $MemberName rimosso dal database" -ForegroundColor Green
            if ($imageFiles) {
                Write-Host "  - Immagini rimosse" -ForegroundColor Green
            }
            Write-Host "  - Modifiche committate e pushate" -ForegroundColor Green
            Write-Host ""
            Write-Host "Vercel dovrebbe rilevare automaticamente il nuovo commit" -ForegroundColor Cyan
        } else {
            Write-Host "Errore durante il push su GitHub" -ForegroundColor Red
        }
    } else {
        Write-Host "Errore durante la creazione del commit" -ForegroundColor Red
    }
} else {
    Write-Host "Nessuna modifica da committare" -ForegroundColor Yellow
}

Write-Host ""


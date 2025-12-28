// Script per rimuovere completamente Alessio dal team
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Variabili d\'ambiente mancanti!')
  process.exit(1)
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function removeAlessio() {
  try {
    console.log('🔍 Ricerca di Alessio nel database...\n')
    
    const { data: members, error: searchError } = await supabaseAdmin
      .from('team_members')
      .select('*')
      .ilike('name', '%Alessio%')

    if (searchError) {
      console.error('❌ Errore durante la ricerca:', searchError)
      return
    }

    if (!members || members.length === 0) {
      console.log('✅ Alessio non trovato nel database - già rimosso!')
      return
    }

    console.log(`⚠️  Trovati ${members.length} membro/i:\n`)
    members.forEach(member => {
      console.log(`  ID: ${member.id}`)
      console.log(`  Nome: ${member.name}`)
      console.log(`  Ruolo: ${member.role}`)
      console.log('')
    })

    console.log('🗑️  Rimozione in corso...\n')
    
    for (const member of members) {
      if (member.image_path) {
        console.log(`  Rimuovendo immagine: ${member.image_path}`)
        const { error: deleteImageError } = await supabaseAdmin.storage
          .from('team-photos')
          .remove([member.image_path])

        if (deleteImageError) {
          console.warn(`  ⚠️  Errore immagine:`, deleteImageError.message)
        } else {
          console.log(`  ✅ Immagine rimossa dallo storage`)
        }
      }

      console.log(`  Rimuovendo dal database: ${member.name} (ID: ${member.id})`)
      const { error: deleteError } = await supabaseAdmin
        .from('team_members')
        .delete()
        .eq('id', member.id)

      if (deleteError) {
        console.error(`  ❌ Errore:`, deleteError.message)
      } else {
        console.log(`  ✅ Rimosso con successo!\n`)
      }
    }

    console.log('🔍 Verifica finale...\n')
    const { data: finalCheck, error: finalError } = await supabaseAdmin
      .from('team_members')
      .select('id, name')
      .ilike('name', '%Alessio%')

    if (finalError) {
      console.error('❌ Errore verifica:', finalError)
      return
    }

    if (!finalCheck || finalCheck.length === 0) {
      console.log('✅✅✅ RIMOZIONE COMPLETATA! ✅✅✅')
      console.log('✅ Alessio è stato COMPLETAMENTE rimosso dal database')
    } else {
      console.log('⚠️  ATTENZIONE: Ancora presenti:')
      console.log(finalCheck)
    }
  } catch (error) {
    console.error('❌ Errore inaspettato:', error)
  }
}

removeAlessio()








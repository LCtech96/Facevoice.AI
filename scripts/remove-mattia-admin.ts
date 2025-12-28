// Script per rimuovere Mattia Orlando usando il client admin
// Questo bypassa le policy RLS
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

if (!supabaseUrl || !supabaseServiceRoleKey) {
  console.error('❌ Variabili d\'ambiente mancanti!')
  console.error('Assicurati di avere NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY in .env.local')
  process.exit(1)
}

// Client con privilegi admin per bypassare RLS
const supabaseAdmin = createClient(supabaseUrl, supabaseServiceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
})

async function removeMattiaAdmin() {
  try {
    console.log('🔍 Ricerca di Mattia Orlando nel database...\n')
    
    // Cerca con il client admin
    const { data: members, error: searchError } = await supabaseAdmin
      .from('team_members')
      .select('*')
      .or('id.eq.10,name.ilike.%Mattia%,name.ilike.%Orlando%')

    if (searchError) {
      console.error('❌ Errore durante la ricerca:', searchError)
      return
    }

    if (!members || members.length === 0) {
      console.log('✅ Mattia Orlando non trovato nel database - già rimosso!')
      return
    }

    console.log(`⚠️  Trovati ${members.length} membro/i:\n`)
    members.forEach(member => {
      console.log(`  ID: ${member.id}`)
      console.log(`  Nome: ${member.name}`)
      console.log(`  Ruolo: ${member.role}`)
      console.log('')
    })

    // Rimuovi tutti i membri trovati usando il client admin
    console.log('🗑️  Rimozione con privilegi admin...\n')
    
    for (const member of members) {
      // Rimuovi l'immagine dallo storage
      if (member.image_path) {
        console.log(`  Rimuovendo immagine: ${member.image_path}`)
        const { error: deleteImageError } = await supabaseAdmin.storage
          .from('team-photos')
          .remove([member.image_path])

        if (deleteImageError) {
          console.warn(`  ⚠️  Errore immagine:`, deleteImageError.message)
        } else {
          console.log(`  ✅ Immagine rimossa`)
        }
      }

      // Rimuovi dal database con client admin
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

    // Verifica finale con client admin
    console.log('🔍 Verifica finale con client admin...\n')
    const { data: finalCheck, error: finalError } = await supabaseAdmin
      .from('team_members')
      .select('id, name')
      .or('id.eq.10,name.ilike.%Mattia%,name.ilike.%Orlando%')

    if (finalError) {
      console.error('❌ Errore verifica:', finalError)
      return
    }

    if (!finalCheck || finalCheck.length === 0) {
      console.log('✅✅✅ RIMOZIONE COMPLETATA! ✅✅✅')
      console.log('✅ Mattia Orlando è stato COMPLETAMENTE rimosso dal database')
      console.log('✅ La card non dovrebbe più apparire sul sito')
    } else {
      console.log('⚠️  ATTENZIONE: Ancora presenti nel database:')
      console.log(finalCheck)
      console.log('\n💡 Esegui lo script SQL: remove-mattia-definitive.sql su Supabase')
    }
  } catch (error) {
    console.error('❌ Errore inaspettato:', error)
  }
}

removeMattiaAdmin()










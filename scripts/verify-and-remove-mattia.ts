// Script per verificare e rimuovere completamente Mattia Orlando
import { supabase } from '../lib/supabase'

async function verifyAndRemoveMattia() {
  try {
    console.log('🔍 Verificando se Mattia Orlando esiste ancora nel database...\n')
    
    // Cerca Mattia Orlando con vari pattern
    const { data: members, error: searchError } = await supabase
      .from('team_members')
      .select('*')
      .or('name.ilike.%Mattia%,name.ilike.%Orlando%,name.ilike.%MO%')

    if (searchError) {
      console.error('❌ Errore durante la ricerca:', searchError)
      return
    }

    if (!members || members.length === 0) {
      console.log('✅ Mattia Orlando non trovato nel database - già rimosso!')
      return
    }

    console.log(`⚠️  Trovati ${members.length} membro/i corrispondenti:\n`)
    members.forEach(member => {
      console.log(`  ID: ${member.id}`)
      console.log(`  Nome: ${member.name}`)
      console.log(`  Ruolo: ${member.role}`)
      console.log(`  Email: ${member.email || 'N/A'}`)
      console.log(`  Image URL: ${member.image_url || 'N/A'}`)
      console.log(`  Image Path: ${member.image_path || 'N/A'}`)
      console.log('')
    })

    // Rimuovi tutti i membri trovati
    console.log('🗑️  Rimozione in corso...\n')
    
    for (const member of members) {
      // Rimuovi l'immagine dallo storage se esiste
      if (member.image_path) {
        console.log(`  Rimuovendo immagine dallo storage: ${member.image_path}`)
        const { error: deleteImageError } = await supabase.storage
          .from('team-photos')
          .remove([member.image_path])

        if (deleteImageError) {
          console.warn(`  ⚠️  Errore durante la rimozione dell'immagine:`, deleteImageError.message)
        } else {
          console.log(`  ✅ Immagine rimossa dallo storage`)
        }
      }

      // Rimuovi il membro dal database
      console.log(`  Rimuovendo ${member.name} (ID: ${member.id}) dal database...`)
      const { error: deleteError } = await supabase
        .from('team_members')
        .delete()
        .eq('id', member.id)

      if (deleteError) {
        console.error(`  ❌ Errore durante la rimozione:`, deleteError.message)
      } else {
        console.log(`  ✅ ${member.name} rimosso con successo!\n`)
      }
    }

    // Verifica finale
    console.log('🔍 Verifica finale...\n')
    const { data: finalCheck, error: finalError } = await supabase
      .from('team_members')
      .select('id, name')
      .or('name.ilike.%Mattia%,name.ilike.%Orlando%,name.ilike.%MO%')

    if (finalError) {
      console.error('❌ Errore durante la verifica finale:', finalError)
      return
    }

    if (!finalCheck || finalCheck.length === 0) {
      console.log('✅✅✅ RIMOZIONE COMPLETATA CON SUCCESSO! ✅✅✅')
      console.log('✅ Mattia Orlando è stato completamente rimosso dal database')
    } else {
      console.log('⚠️  Attenzione: alcuni membri potrebbero essere ancora presenti')
      console.log(finalCheck)
    }
  } catch (error) {
    console.error('❌ Errore inaspettato:', error)
  }
}

verifyAndRemoveMattia()


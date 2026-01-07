// Script per rimuovere Mattia Orlando dal team
import { supabase } from '../lib/supabase'

async function removeMattia() {
  try {
    // Cerca Mattia Orlando nel database
    const { data: members, error: searchError } = await supabase
      .from('team_members')
      .select('id, name, role, image_path')
      .or('name.ilike.%Mattia%,name.ilike.%Orlando%')

    if (searchError) {
      console.error('Errore durante la ricerca:', searchError)
      return
    }

    if (!members || members.length === 0) {
      console.log('⚠️  Mattia Orlando non trovato nel database')
      return
    }

    console.log(`Trovati ${members.length} membro/i corrispondenti:`)
    members.forEach(member => {
      console.log(`  - ID: ${member.id}, Nome: ${member.name}, Ruolo: ${member.role}`)
    })

    // Rimuovi tutti i membri trovati
    for (const member of members) {
      // Rimuovi l'immagine dallo storage se esiste
      if (member.image_path) {
        const { error: deleteImageError } = await supabase.storage
          .from('team-photos')
          .remove([member.image_path])

        if (deleteImageError) {
          console.warn(`⚠️  Errore durante la rimozione dell'immagine per ${member.name}:`, deleteImageError.message)
        } else {
          console.log(`✅ Immagine rimossa dallo storage per ${member.name}`)
        }
      }

      // Rimuovi il membro dal database
      const { error: deleteError } = await supabase
        .from('team_members')
        .delete()
        .eq('id', member.id)

      if (deleteError) {
        console.error(`❌ Errore durante la rimozione di ${member.name}:`, deleteError)
      } else {
        console.log(`✅ ${member.name} (ID: ${member.id}) rimosso con successo!`)
      }
    }

    console.log('✅ Rimozione completata!')
  } catch (error) {
    console.error('Errore inaspettato:', error)
  }
}

removeMattia()














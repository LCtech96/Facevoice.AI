// Script per inserire i membri del team nel database
// Eseguire con: node scripts/insert-team-members.js
// Oppure chiama direttamente: POST /api/team/reinsert

const API_URL = process.env.API_URL || 'http://localhost:3000/api/team/reinsert';

async function insertTeamMembers() {
  try {
    console.log('Inserimento membri del team...');
    console.log(`Chiamando: ${API_URL}`);
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok) {
      console.error('Errore:', data);
      process.exit(1);
    }

    console.log('✅ Successo!');
    console.log(`Messaggio: ${data.message}`);
    console.log(`Membri inseriti/aggiornati: ${data.data?.length || 0}`);
    
    if (data.errors && data.errors.length > 0) {
      console.warn('⚠️ Errori:', data.errors);
    }
  } catch (error) {
    console.error('Errore nella chiamata API:', error.message);
    console.error('Assicurati che il server sia in esecuzione e che l\'URL sia corretto.');
    process.exit(1);
  }
}

insertTeamMembers();


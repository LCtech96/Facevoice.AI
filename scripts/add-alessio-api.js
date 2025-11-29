// Script per aggiungere Alessio via API
// Esegui questo script quando il server Next.js è in esecuzione
// node scripts/add-alessio-api.js

const fetch = require('node-fetch');

async function addAlessio() {
  try {
    const response = await fetch('http://localhost:3000/api/team', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Alessio',
        role: 'Client Success Manager',
        description: 'Dedicated to ensuring client satisfaction and success, building strong relationships and driving value for our partners',
        email: 'alessio@facevoice.ai',
        linkedin: null,
        image_url: '/team/Alessio professionale fv.png',
      }),
    });

    const data = await response.json();

    if (response.ok) {
      console.log('✅ Alessio aggiunto con successo!');
      console.log('Dettagli:', data);
    } else {
      console.error('❌ Errore:', data.error);
    }
  } catch (error) {
    console.error('❌ Errore di connessione:', error.message);
    console.log('Assicurati che il server Next.js sia in esecuzione (pnpm dev)');
  }
}

addAlessio();


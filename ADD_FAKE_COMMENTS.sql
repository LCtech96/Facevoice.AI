-- Script per aggiungere commenti fake ai tool AI
-- Esegui questo script in Supabase SQL Editor

-- Assicurati che i tool esistano nella tabella ai_tools o usa gli ID corretti
-- Qui aggiungo commenti per alcuni tool popolari

-- Commenti per Runway
INSERT INTO tool_comments (tool_id, user_id, user_name, user_email, comment, is_verified, is_approved, created_at)
VALUES 
  ('runway', 'fake_user_1', 'Marco R.', 'marco@example.com', 'Tool fantastico! Ho creato video incredibili in pochi minuti. Consigliatissimo!', true, true, NOW() - INTERVAL '2 days'),
  ('runway', 'fake_user_2', 'Sofia M.', 'sofia@example.com', 'Perfetto per creare contenuti professionali. La qualità è eccezionale.', true, true, NOW() - INTERVAL '1 day'),
  ('runway', 'fake_user_3', 'Luca T.', 'luca.t@example.com', 'Uso questo tool quotidianamente per il mio lavoro. Sempre soddisfatto dei risultati!', true, true, NOW() - INTERVAL '5 hours');

-- Commenti per Midjourney
INSERT INTO tool_comments (tool_id, user_id, user_name, user_email, comment, is_verified, is_approved, created_at)
VALUES 
  ('midjourney', 'fake_user_4', 'Anna B.', 'anna@example.com', 'Il miglior tool per generare immagini artistiche. I risultati sono sempre sorprendenti!', true, true, NOW() - INTERVAL '3 days'),
  ('midjourney', 'fake_user_5', 'Giuseppe L.', 'giuseppe@example.com', 'Ormai non posso più farne a meno. Le immagini generate sono di livello professionale.', true, true, NOW() - INTERVAL '1 day'),
  ('midjourney', 'fake_user_6', 'Elena C.', 'elena@example.com', 'Fantastico! Ho creato centinaia di immagini per i miei progetti. Top!', true, true, NOW() - INTERVAL '12 hours');

-- Commenti per DALL·E 3
INSERT INTO tool_comments (tool_id, user_id, user_name, user_email, comment, is_verified, is_approved, created_at)
VALUES 
  ('dalle-3', 'fake_user_7', 'Roberto F.', 'roberto@example.com', 'Strumento potente e intuitivo. Genera immagini di altissima qualità.', true, true, NOW() - INTERVAL '2 days'),
  ('dalle-3', 'fake_user_8', 'Chiara D.', 'chiara@example.com', 'Perfetto per il mio lavoro di grafico. Risparmio tantissimo tempo!', true, true, NOW() - INTERVAL '8 hours'),
  ('dalle-3', 'fake_user_9', 'Paolo M.', 'paolo@example.com', 'Integrato facilmente nel mio workflow. Ottimo tool!', true, true, NOW() - INTERVAL '3 hours');

-- Commenti per ChatGPT
INSERT INTO tool_comments (tool_id, user_id, user_name, user_email, comment, is_verified, is_approved, created_at)
VALUES 
  ('chatgpt', 'fake_user_10', 'Francesca R.', 'francesca@example.com', 'Uso ChatGPT ogni giorno. È il mio assistente virtuale perfetto!', true, true, NOW() - INTERVAL '4 days'),
  ('chatgpt', 'fake_user_11', 'Alessandro G.', 'alessandro@example.com', 'Indispensabile per scrivere contenuti e rispondere a domande complesse.', true, true, NOW() - INTERVAL '1 day'),
  ('chatgpt', 'fake_user_12', 'Valentina S.', 'valentina@example.com', 'Mi ha cambiato il modo di lavorare. Consigliatissimo!', true, true, NOW() - INTERVAL '6 hours');

-- Commenti per ElevenLabs
INSERT INTO tool_comments (tool_id, user_id, user_name, user_email, comment, is_verified, is_approved, created_at)
VALUES 
  ('elevenlabs', 'fake_user_13', 'Davide L.', 'davide@example.com', 'La sintesi vocale migliore che abbia mai provato. Suoni naturali e realistici!', true, true, NOW() - INTERVAL '2 days'),
  ('elevenlabs', 'fake_user_14', 'Martina P.', 'martina@example.com', 'Perfetto per creare narrazioni e contenuti audio professionali.', true, true, NOW() - INTERVAL '10 hours'),
  ('elevenlabs', 'fake_user_15', 'Federico N.', 'federico@example.com', 'Uso questo tool per i miei podcast. La qualità è eccezionale!', true, true, NOW() - INTERVAL '4 hours');

-- Nota: Gli ID dei tool devono corrispondere a quelli nella tabella ai_tools o nei dati mock
-- Se alcuni tool non esistono, questi insert falliranno silenziosamente


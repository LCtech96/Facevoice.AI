-- ═══════════════════════════════════════════════════════════════════════════
-- FIX DUPLICATI payment_shares - Rimuove condivisioni duplicate
-- ═══════════════════════════════════════════════════════════════════════════
-- 
-- Questo script rimuove le condivisioni duplicate mantenendo solo la prima.
-- Esegui in Supabase SQL Editor.
--
-- ═══════════════════════════════════════════════════════════════════════════

-- Verifica duplicati (esegui per vedere cosa verrà eliminato)
SELECT 
  payment_id, 
  shared_with_email, 
  COUNT(*) as count
FROM payment_shares
GROUP BY payment_id, shared_with_email
HAVING COUNT(*) > 1;

-- Elimina duplicati mantenendo solo il più recente
DELETE FROM payment_shares
WHERE id IN (
  SELECT id
  FROM (
    SELECT id,
           ROW_NUMBER() OVER (
             PARTITION BY payment_id, shared_with_email 
             ORDER BY created_at DESC
           ) as rn
    FROM payment_shares
  ) t
  WHERE t.rn > 1
);

-- Verifica che non ci siano più duplicati
SELECT 
  payment_id, 
  shared_with_email, 
  COUNT(*) as count
FROM payment_shares
GROUP BY payment_id, shared_with_email
HAVING COUNT(*) > 1;
-- Se questo query ritorna 0 righe, i duplicati sono stati eliminati

-- Schema per la tabella bookings
-- Esegui questo script in Supabase SQL Editor

CREATE TABLE IF NOT EXISTS bookings (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  whatsapp TEXT NOT NULL,
  service TEXT NOT NULL,
  datetime TIMESTAMP WITH TIME ZONE,
  address JSONB,
  status TEXT DEFAULT 'pending' CHECK (status IN ('pending', 'contacted', 'completed', 'cancelled')),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indice per email per ricerche più veloci
CREATE INDEX IF NOT EXISTS idx_bookings_email ON bookings(email);

-- Indice per status per filtri
CREATE INDEX IF NOT EXISTS idx_bookings_status ON bookings(status);

-- Indice per created_at per ordinamento
CREATE INDEX IF NOT EXISTS idx_bookings_created_at ON bookings(created_at DESC);

-- RLS Policies
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;

-- Policy: Solo gli admin possono vedere tutte le prenotazioni
CREATE POLICY "Admin can view all bookings"
  ON bookings
  FOR SELECT
  USING (
    auth.jwt() ->> 'email' = 'luca@facevoice.ai'
  );

-- Policy: Chiunque può creare prenotazioni (pubblico)
CREATE POLICY "Anyone can create bookings"
  ON bookings
  FOR INSERT
  WITH CHECK (true);

-- Policy: Solo gli admin possono aggiornare le prenotazioni
CREATE POLICY "Admin can update bookings"
  ON bookings
  FOR UPDATE
  USING (
    auth.jwt() ->> 'email' = 'luca@facevoice.ai'
  );

-- Policy: Solo gli admin possono eliminare le prenotazioni
CREATE POLICY "Admin can delete bookings"
  ON bookings
  FOR DELETE
  USING (
    auth.jwt() ->> 'email' = 'luca@facevoice.ai'
  );

-- Trigger per aggiornare updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_bookings_updated_at
  BEFORE UPDATE ON bookings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();


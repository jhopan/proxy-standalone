-- Schema proxy_pool untuk CFVPN Hub + Proxy Standalone
-- Jalankan di Supabase SQL Editor (aman diulang)

CREATE TABLE IF NOT EXISTS proxy_pool (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  ip TEXT NOT NULL,
  port TEXT NOT NULL,
  country TEXT,
  org TEXT,
  is_active BOOLEAN DEFAULT true,
  protocol TEXT DEFAULT 'http',
  ping INTEGER,
  check_ok BOOLEAN,
  check_stage TEXT,
  last_checked TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT proxy_pool_ip_port_key UNIQUE (ip, port)
);

-- Tambah kolom baru kalau tabel sudah ada (untuk upgrade)
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS protocol TEXT DEFAULT 'http';
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS ping INTEGER;
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS check_ok BOOLEAN;
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS check_stage TEXT;
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ DEFAULT NOW();

-- Index untuk query cepat
CREATE INDEX IF NOT EXISTS proxy_pool_active_idx ON proxy_pool (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS proxy_pool_checked_idx ON proxy_pool (last_checked DESC);
CREATE INDEX IF NOT EXISTS proxy_pool_country_idx ON proxy_pool (country);
CREATE INDEX IF NOT EXISTS proxy_pool_ping_idx ON proxy_pool (ping) WHERE ping IS NOT NULL;

-- RLS: anon boleh baca, service_role bebas (default service_role bypass RLS)
ALTER TABLE proxy_pool ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "anon read proxy_pool" ON proxy_pool;
CREATE POLICY "anon read proxy_pool" ON proxy_pool
  FOR SELECT TO anon
  USING (true);

-- Tidak ada policy untuk INSERT/UPDATE dari anon.
-- Update hanya bisa lewat service_role key (dipakai Checker).

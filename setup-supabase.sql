-- ============================================================================
--  SQL UNTUK CFVPN HUB — jalankan di Supabase SQL Editor
--  Project: cgflrpjavyotvolnvcnl
--  Aman diulang (idempotent)
-- ============================================================================

-- 1. Kolom baru untuk proxy_pool
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS protocol TEXT DEFAULT 'http';
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS check_ok BOOLEAN;
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS check_stage TEXT;

-- 2. Role user (kalau belum ada)
ALTER TABLE users_custom ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';

-- 3. Set admin
UPDATE users_custom SET role = 'admin' WHERE username = 'jhopanstore';

-- 4. Index untuk query cepat
CREATE INDEX IF NOT EXISTS proxy_pool_active_idx ON proxy_pool (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS proxy_pool_checked_idx ON proxy_pool (last_checked DESC);
CREATE INDEX IF NOT EXISTS proxy_pool_country_idx ON proxy_pool (country);
CREATE INDEX IF NOT EXISTS proxy_pool_ping_idx ON proxy_pool (ping) WHERE ping IS NOT NULL;

-- 5. Bersihkan proxy yang datanya sudah basi (lebih dari 30 hari tanpa cek)
--    Jalankan SETELAH Checker selesai sekali, supaya tidak ada proxy yang
--    ditandai "aktif" padahal sudah lama mati.
-- UPDATE proxy_pool
--    SET is_active = false, check_ok = false, check_stage = 'stale'
--    WHERE last_checked < NOW() - INTERVAL '30 days';

-- 6. Verifikasi (jalankan setelah semua di atas)
-- SELECT is_active, COUNT(*) FROM proxy_pool GROUP BY is_active;
-- SELECT protocol, COUNT(*) FROM proxy_pool WHERE is_active GROUP BY protocol;
-- SELECT COUNT(*) FROM proxy_pool WHERE is_active AND ping < 800;

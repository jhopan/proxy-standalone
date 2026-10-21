#!/usr/bin/env node
/**
 * Setup Supabase: tambah kolom baru ke proxy_pool.
 *
 * Pakai:
 *   node setup/setup-db.js            -> tampilkan SQL siap salin
 *   node setup/setup-db.js --exec     -> coba jalankan via RPC (kalau ada)
 *
 * Catatan: ALTER TABLE butuh service_role key atau akses SQL Editor.
 * Tanpa itu, script hanya mencetak SQL untuk dijalankan manual.
 */

import { SUPABASE_URL, SUPABASE_KEY, HAS_SERVICE_KEY } from "../core/config.js";

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const SQL = `-- Kolom baru untuk proxy checker
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS protocol TEXT DEFAULT 'http';
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS check_ok BOOLEAN;
ALTER TABLE proxy_pool ADD COLUMN IF NOT EXISTS check_stage TEXT;

-- Index
CREATE INDEX IF NOT EXISTS proxy_pool_active_idx ON proxy_pool (is_active) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS proxy_pool_checked_idx ON proxy_pool (last_checked DESC);
CREATE INDEX IF NOT EXISTS proxy_pool_country_idx ON proxy_pool (country);
CREATE INDEX IF NOT EXISTS proxy_pool_ping_idx ON proxy_pool (ping) WHERE ping IS NOT NULL;

-- Role user (kalau belum ada)
ALTER TABLE users_custom ADD COLUMN IF NOT EXISTS role TEXT DEFAULT 'user';
UPDATE users_custom SET role = 'admin' WHERE username = 'jhopanstore';`;

async function checkColumns() {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/proxy_pool?select=*&limit=1`, {
      headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return Array.isArray(data) && data[0] ? Object.keys(data[0]) : [];
  } catch {
    return null;
  }
}

async function main() {
  console.log(C.bold(C.cyan("\n🛠  Setup Supabase\n")));

  const cols = await checkColumns();
  if (!cols) {
    console.log(C.yellow("   Tidak bisa konek ke Supabase. Cek .env.\n"));
  } else {
    console.log(C.dim("   Kolom saat ini: " + cols.join(", ")));
    const need = ["protocol", "check_ok", "check_stage"];
    const missing = need.filter((c) => !cols.includes(c));
    if (!missing.length) {
      console.log(C.green("\n   Semua kolom sudah ada. Tidak perlu action.\n"));
      return;
    }
    console.log(C.yellow(`\n   Kolom belum ada: ${missing.join(", ")}\n`));
  }

  console.log(C.bold("   Jalankan SQL ini di Supabase SQL Editor:\n"));
  console.log(C.cyan("   " + SUPABASE_URL.replace("/rest/v1", "") + "/ > SQL Editor > New query\n"));
  console.log(SQL);
  console.log("");

  if (!HAS_SERVICE_KEY) {
    console.log(C.dim("   Catatan: SUPABASE_SERVICE_KEY belum diisi di .env."));
    console.log(C.dim("   Untuk update otomatis, isi service_role key (Settings > API).\n"));
  }

  if (process.argv.includes("--exec")) {
    console.log(C.yellow("   Eksekusi otomatis butuh RPC exec_sql yang belum dibuat di project."));
    console.log(C.dim("   Jalankan SQL manual di atas (paling aman).\n"));
  }
}

main().catch((e) => {
  console.error(C.red(`\n❌ ${e?.message || e}\n`));
  process.exit(1);
});

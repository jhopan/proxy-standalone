// Loader .env + konfigurasi global. Nol dependency.
import { readFileSync, existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ROOT = resolve(__dirname, "..");

function loadEnv() {
  const envPath = resolve(ROOT, ".env");
  const vars = {};
  if (existsSync(envPath)) {
    for (const raw of readFileSync(envPath, "utf-8").split("\n")) {
      const line = raw.trim();
      if (!line || line.startsWith("#")) continue;
      const eq = line.indexOf("=");
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      vars[key] = val;
    }
  }
  return vars;
}

const fileEnv = loadEnv();

// Env proses menang atas file .env
export const env = { ...fileEnv, ...process.env };

export const SUPABASE_URL = env.SUPABASE_URL || "";
export const SUPABASE_KEY = env.SUPABASE_SERVICE_KEY || env.SUPABASE_ANON_KEY || "";
export const HAS_SERVICE_KEY = Boolean(env.SUPABASE_SERVICE_KEY);

export const CONFIG = {
  // Batas concurrency saat cek proxy (pembatas socket OS)
  concurrency: Number(env.PROXY_CONCURRENCY || 60),
  // Timeout TCP connect (ms)
  connectTimeout: Number(env.PROXY_CONNECT_TIMEOUT || 8000),
  // Timeout keseluruhan per proxy (ms)
  totalTimeout: Number(env.PROXY_TOTAL_TIMEOUT || 15000),
  // Timeout HTTP CONNECT test (ms)
  httpTimeout: Number(env.PROXY_HTTP_TIMEOUT || 12000),
  // Ambil sample acak dari DB (0 = semua)
  sampleSize: Number(env.PROXY_SAMPLE || 0),
  // Batch size untuk update Supabase
  dbBatch: Number(env.PROXY_DB_BATCH || 200),
  // Batas bawah / atas latency yang dianggap bagus (ms)
  pingGood: Number(env.PROXY_PING_GOOD || 1000),
  pingOk: Number(env.PROXY_PING_OK || 3000),
  // Quad
  geoBatch: Number(env.GEO_BATCH || 100),
  geoUrl: env.GEO_API || "http://ip-api.com/batch",
};

export function die(msg) {
  console.error(`\x1b[31m❌ ${msg}\x1b[0m`);
  process.exit(1);
}

export function requireSupabase() {
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    die("SUPABASE_URL / SUPABASE_KEY belum diisi. Salin .env.example ke .env lalu isi.");
  }
}

// Client Supabase REST tanpa dependency (pakai fetch bawaan Node).
import { SUPABASE_URL, SUPABASE_KEY } from "./config.js";

const BASE = SUPABASE_URL ? `${SUPABASE_URL}/rest/v1` : "";

function headers(extra = {}) {
  return {
    apikey: SUPABASE_KEY,
    Authorization: `Bearer ${SUPABASE_KEY}`,
    "Content-Type": "application/json",
    ...extra,
  };
}

async function request(path, { method = "GET", body, prefer, range, onCount } = {}) {
  if (!BASE) throw new Error("SUPABASE_URL kosong");
  const h = headers();
  if (prefer) h.Prefer = prefer;
  if (range) h.Range = range;

  const url = `${BASE}/${path.replace(/^\/+/, "")}`;

  // Retry untuk koneksi flaky (Cloudflare bisa rate-limit / timeout)
  let res = null;
  let lastErr = null;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      res = await fetch(url, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(20000),
      });
      break;
    } catch (e) {
      lastErr = e;
      await new Promise((res2) => setTimeout(res2, 600 * (attempt + 1)));
    }
  }
  if (!res) {
    return { data: null, error: `Koneksi gagal: ${lastErr?.message || "unknown"}`, status: 0 };
  }

  if (onCount) {
    const cr = res.headers.get("content-range") || "";
    const total = Number(cr.split("/")[1] || 0);
    return { data: null, count: total, error: null };
  }

  const text = await res.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }
  }

  if (!res.ok) {
    const msg = data?.message || data?.hint || data?.error || text || `HTTP ${res.status}`;
    return { data: null, error: msg, status: res.status };
  }
  return { data, error: null, status: res.status };
}

// Cache kolom yang tersedia per tabel (deteksi sekali, pakai seterusnya).
const columnCache = new Map();

export async function getColumns(table) {
  if (columnCache.has(table)) return columnCache.get(table);
  // Ambil satu baris, ambil key-nya. Kalau gagal, coba lagi 2x.
  let cols = new Set();
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await request(`${table}?select=*&limit=1`);
      if (Array.isArray(r.data) && r.data[0]) {
        cols = new Set(Object.keys(r.data[0]));
        break;
      }
      if (r.error) {
        await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
        continue;
      }
      break;
    } catch {
      await new Promise((res) => setTimeout(res, 800 * (attempt + 1)));
    }
  }
  columnCache.set(table, cols);
  return cols;
}

/** Ambil daftar kolom, gagal = throw (jangan diam-diam lanjut). */
export async function requireColumns(table) {
  let cols = await getColumns(table);
  if (cols.size === 0) {
    columnCache.delete(table);
    cols = await getColumns(table);
  }
  if (cols.size === 0) {
    throw new Error(`Tidak bisa ambil daftar kolom tabel "${table}". Cek koneksi / kredensial Supabase.`);
  }
  return cols;
}

export function filterToColumns(payload, cols) {
  // cols kosong = tidak tahu -> jangan kirim apa-apa (lebih baik error jelas daripada diam)
  if (!cols || cols.size === 0) return {};
  const out = {};
  for (const [k, v] of Object.entries(payload)) {
    if (cols.has(k)) out[k] = v;
  }
  return out;
}

export async function select(table, query = "", { count = false, range } = {}) {
  const q = query ? `?${query}` : "";
  if (count) {
    const r = await request(`${table}${q}`, {
      prefer: "count=exact",
      range: range || "0-0",
      onCount: true,
    });
    return { data: [], count: r.count, error: r.error };
  }
  return request(`${table}${q}`, { range });
}

/**
 * Ambil semua baris dengan pagination (PostgREST limit default = 1000).
 * @param {string} table
 * @param {string} query  contoh: "select=ip,port"
 * @param {number} pageSize
 */
export async function selectAll(table, query, pageSize = 1000) {
  const base = query ? `${table}?${query}` : table;
  const out = [];
  for (let offset = 0; ; offset += pageSize) {
    // Range header menentukan window, jadi JANGAN set limit di query juga
    const r = await request(`${base}&offset=${offset}`, {
      range: `${offset}-${offset + pageSize - 1}`,
    });
    if (r.error) return { data: out, error: r.error };
    const batch = Array.isArray(r.data) ? r.data : [];
    out.push(...batch);
    if (batch.length < pageSize) break;
    if (out.length > 200000) break; // batas aman
  }
  return { data: out, error: null };
}

export async function insert(table, rows) {
  return request(`/${table}`, { method: "POST", body: rows });
}

export async function upsert(table, rows, onConflict) {
  return request(`/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    body: rows,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

export async function update(table, filter, patch) {
  return request(`/${table}?${filter}`, { method: "PATCH", body: patch });
}

export async function remove(table, filter) {
  return request(`/${table}?${filter}`, { method: "DELETE", prefer: "return=minimal" });
}

// Upsert bulk pakai pipeline: kirim array, konflikt di-resolve server-side.
export async function upsertBulk(table, rows, onConflict) {
  if (!rows.length) return { data: null, error: null };

  // Buang kolom yang tidak ada di tabel (schema cache PostgREST error kalau tidak cocok)
  let cols = null;
  try {
    cols = await getColumns(table);
  } catch {
    cols = null;
  }
  const clean = cols && cols.size
    ? rows.map((r) => filterToColumns(r, cols))
    : rows;

  return request(`/${table}?on_conflict=${encodeURIComponent(onConflict)}`, {
    method: "POST",
    body: clean,
    prefer: "resolution=merge-duplicates,return=minimal",
  });
}

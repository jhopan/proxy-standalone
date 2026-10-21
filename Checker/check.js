#!/usr/bin/env node
/**
 * Proxy Checker - cek status proxy di database.
 *
 * Pakai:
 *   node Checker/check.js              -> cek semua proxy
 *   node Checker/check.js --all        -> cek semua (eksplisit)
 *   node Checker/check.js --limit 500  -> cek 500 proxy (acak)
 *   node Checker/check.js --dead 300   -> tandai mati 300 proxy lama
 *   node Checker/check.js --shallow    -> hanya TCP connect (lebih cepat)
 *   node Checker/check.js --dry-run    -> tidak menulis ke DB
 *
 * Nol dependency. Cek proxy langsung via TCP socket (bukan API pihak ketiga).
 */

import { CONFIG, requireSupabase, HAS_SERVICE_KEY } from "../core/config.js";
import { select, selectAll, update, requireColumns, filterToColumns } from "../core/db.js";
import { checkOne, workerCompatCheck, tcpCheck } from "../core/checker.js";
import { pool } from "../core/pool.js";

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const out = { limit: 0, dead: 0, stale: 0, staleOnly: false, shallow: false, dryRun: false, all: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i] || 0);
    else if (a === "--dead") out.dead = Number(argv[++i] || 0);
    else if (a === "--stale") { out.stale = Number(argv[++i] || 0); out.staleOnly = true; }
    else if (a === "--stale-then-check") out.stale = Number(argv[++i] || 0);
    else if (a === "--shallow") out.shallow = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--all") out.all = true;
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.log(`
${C.bold("Proxy Checker")} - cek status proxy di Supabase

  node Checker/check.js [opsi]

  --limit N     cek N proxy (acak). 0 = semua
  --dead N      tandai N proxy paling lama dicek sebagai mati
  --shallow     hanya TCP connect (cepat, tanpa uji forward)
  --dry-run     tidak menulis hasil ke database
  --all         cek semua proxy
  --help        tampilkan bantuan ini
`);
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

async function markStaleDead(hours) {
  const cutoff = new Date(Date.now() - hours * 3600 * 1000).toISOString();
  console.log(C.cyan(`\n   Menandai proxy yang dicek > ${hours} jam lalu sebagai mati...`));

  // Ambil ID proxy basi. Filter waktu di JS (filter OR PostgREST fragile).
  const ids = [];
  const r = await selectAll("proxy_pool", "select=id,last_checked&is_active=eq.true");
  if (r.error) {
    console.log(C.red(`   Error: ${r.error}`));
    return 0;
  }
  for (const row of r.data || []) {
    if (!row.last_checked || row.last_checked < cutoff) ids.push(row.id);
  }

  if (!ids.length) {
    console.log(C.dim("   Tidak ada proxy basi."));
    return 0;
  }

  const now = new Date().toISOString();
  const cols = await requireColumns("proxy_pool");
  const patch = filterToColumns(
    { is_active: false, check_ok: false, check_stage: "stale", last_checked: now },
    cols
  );
  let n = 0;
  for (let i = 0; i < ids.length; i += CONFIG.dbBatch) {
    const chunk = ids.slice(i, i + CONFIG.dbBatch);
    const { error } = await update("proxy_pool", `id=in.(${chunk.join(",")})`, patch);
    if (error) { console.log(C.red(`   Error update: ${error}`)); break; }
    n += chunk.length;
  }
  console.log(C.green(`   ${n} proxy basi ditandai mati.`));
  return n;
}

async function markOldestDead(n) {
  console.log(C.cyan(`\n   Menandai ${n} proxy paling lama dicek sebagai mati...`));
  const { data, error } = await select(
    "proxy_pool",
    "select=id,ip,port,last_checked&order=last_checked.asc&limit=" + n
  );
  if (error) {
    console.log(C.red(`   Error: ${error}`));
    return 0;
  }
  if (!data?.length) {
    console.log(C.dim("   Tidak ada proxy untuk ditandai."));
    return 0;
  }
  const ids = data.map((p) => p.id);
  const now = new Date().toISOString();
  const colsOld = await requireColumns("proxy_pool");
  const { error: upErr } = await update(
    "proxy_pool",
    `id=in.(${ids.join(",")})`,
    filterToColumns({ is_active: false, check_ok: false, check_stage: "stale", last_checked: now }, colsOld)
  );
  if (upErr) {
    console.log(C.red(`   Error update: ${upErr}`));
    return 0;
  }
  console.log(C.green(`   ${ids.length} proxy ditandai mati.`));
  return ids.length;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  requireSupabase();

  console.log(C.bold(C.cyan("\n🔍 Proxy Checker\n")));
  console.log(C.dim(`   Concurrency : ${CONFIG.concurrency}`));
  console.log(C.dim(`   TCP timeout : ${CONFIG.connectTimeout}ms`));
  console.log(C.dim(`   HTTP timeout: ${CONFIG.httpTimeout}ms`));
  console.log(C.dim(`   Mode        : ${args.shallow ? "shallow (TCP only)" : "deep (TCP + CONNECT)"}`));
  console.log(C.dim(`   Service key : ${HAS_SERVICE_KEY ? "YA (bypass RLS)" : "TIDAK (pakai anon key)"}`));
  if (args.dryRun) console.log(C.yellow(`   DRY RUN - tidak menulis ke database`));

  // Bersihkan proxy yang basi
  if (args.stale > 0) {
    await markStaleDead(args.stale);
    if (args.staleOnly) {
      console.log(C.dim("\n   Mode --stale: selesai (tidak lanjut cek proxy).\n"));
      return;
    }
  }
  if (args.dead > 0) {
    await markOldestDead(args.dead);
  }

  // Ambil proxy dari DB (kolom opsional: protocol)
  let cols;
  try {
    cols = await requireColumns("proxy_pool");
  } catch (e) {
    console.log(C.red(`\n❌ ${e.message}\n`));
    process.exit(1);
  }
  const want = ["id", "ip", "port", "country", "org", "is_active", "ping", "last_checked"];
  const optCols = ["protocol"];
  const selCols = [...want.filter((c) => cols.has(c)), ...optCols.filter((c) => cols.has(c))];
  const query = "select=" + selCols.join(",");

  const { data: all, error: err2 } = await selectAll("proxy_pool", query);
  if (err2) {
    console.log(C.red(`\n❌ Error baca DB: ${err2}\n`));
    process.exit(1);
  }

  if (!all?.length) {
    console.log(C.yellow("\n   Database proxy_pool kosong. Jalankan scraping dulu.\n"));
    process.exit(0);
  }

  console.log(C.dim(`\n   Total proxy di DB: ${all.length}\n`));

  let targets = all;
  if (args.limit > 0 && args.limit < all.length) {
    targets = shuffle([...all]).slice(0, args.limit);
    console.log(C.dim(`   Sample ${targets.length} proxy (acak)\n`));
  } else {
    console.log(C.dim(`   Cek semua ${targets.length} proxy\n`));
  }

  const started = Date.now();
  let alive = 0;
  let dead = 0;
  const pingSum = [];
  const failures = new Map();

  const results = await pool(
    targets,
    CONFIG.concurrency,
    async (row) => {
      if (args.shallow) {
        const t = await tcpCheck(row.ip, row.port);
        return { row, is_active: t.ok, ping: t.ms, check_ok: t.ok, check_stage: "tcp", err: t.err };
      }
      const r = await workerCompatCheck(row.ip, row.port);
      return {
        row,
        is_active: r.ok,
        ping: r.ms ?? null,
        check_ok: r.ok,
        check_stage: r.ok ? "ok" : (r.err || "fail").split(":")[0],
        err: r.err || null,
      };
    },
    (done, total, r) => {
      if (r?.is_active) {
        alive++;
        if (typeof r.ping === "number") pingSum.push(r.ping);
      } else {
        dead++;
        const key = r?.err || "unknown";
        failures.set(key, (failures.get(key) || 0) + 1);
      }
      // Progress compact
      if (done % 50 === 0 || done === total) {
        const pct = ((done / total) * 100).toFixed(1);
        process.stdout.write(`\r   ${C.dim(`[${done}/${total}] ${pct}%  hidup=${alive} mati=${dead}   `)}`);
      }
    }
  );
  process.stdout.write("\n");

  const elapsed = ((Date.now() - started) / 1000).toFixed(1);
  const avgPing = pingSum.length
    ? Math.round(pingSum.reduce((a, b) => a + b, 0) / pingSum.length)
    : null;

  console.log(C.bold(`\n📊 HASIL (${elapsed}s)\n`));
  console.log(`   ${C.green(`Hidup : ${alive}`)}`);
  console.log(`   ${C.red(`Mati  : ${dead}`)}`);
  console.log(`   ${C.dim(`Rasio : ${((alive / results.length) * 100).toFixed(1)}%`)}`);
  if (avgPing !== null) console.log(`   ${C.dim(`Rata-rata ping: ${avgPing}ms`)}`);

  if (failures.size) {
    console.log(C.bold(`\n   Penyebab gagal:\n`));
    const sorted = [...failures.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8);
    for (const [err, n] of sorted) {
      console.log(C.dim(`   ${String(n).padStart(5)}x  ${err}`));
    }
  }

  // Tulis ke DB
  if (!args.dryRun) {
    console.log(C.cyan(`\n   Menyimpan hasil ke database...`));
    const now = new Date().toISOString();
    let cols;
    try {
      cols = await requireColumns("proxy_pool");
    } catch (e) {
      console.log(C.red(`   Error: ${e.message}`));
      process.exit(1);
    }
    const missing = ["protocol", "check_ok", "check_stage"].filter((c) => !cols.has(c));
    if (missing.length) {
      console.log(C.yellow(`   Peringatan: kolom belum ada: ${missing.join(", ")} (lewati kolom itu)`));
    }
    let saved = 0;
    let failed = 0;

    for (let i = 0; i < results.length; i += CONFIG.dbBatch) {
      const chunk = results.slice(i, i + CONFIG.dbBatch);
      for (const r of chunk) {
        if (!r || r.error || !r.row?.id) continue;
        const { error: upErr } = await update(
          "proxy_pool",
          `id=eq.${r.row.id}`,
          filterToColumns({
            is_active: r.is_active,
            ping: typeof r.ping === "number" ? r.ping : null,
            check_ok: r.check_ok,
            check_stage: r.check_stage,
            last_checked: now,
          }, cols)
        );
        if (upErr) failed++;
        else saved++;
      }
      process.stdout.write(`\r   ${C.dim(`saved ${saved}/${results.length}`)}`);
    }
    process.stdout.write("\n");
    if (failed) console.log(C.yellow(`   ${failed} row gagal di-update`));
    console.log(C.green(`   ${saved} proxy ter-update.\n`));
  } else {
    console.log(C.yellow(`\n   Dry run - tidak ada yang ditulis.\n`));
  }
}

main().catch((err) => {
  console.error(C.red(`\n❌ Fatal: ${err?.stack || err}\n`));
  process.exit(1);
});

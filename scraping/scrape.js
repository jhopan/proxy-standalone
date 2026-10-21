#!/usr/bin/env node
/**
 * Proxy Scraper - cari proxy gratis yang hidup, lalu simpan ke database.
 *
 * Pakai:
 *   node scraping/scrape.js                    -> scrape + cek + simpan
 *   node scraping/scrape.js --list             -> hanya tampil daftar, tidak cek/simpan
 *   node scraping/scrape.js --limit 2000       -> batas jumlah proxy yang dicek
 *   node scraping/scrape.js --no-check         -> tidak cek, langsung simpan semua
 *   node scraping/scrape.js --shallow          -> cek TCP saja (cepat)
 *   node scraping/scrape.js --no-geo           -> lewati geolokasi
 *   node scraping/scrape.js --dry-run          -> tidak tulis ke database
 *   node scraping/scrape.js --file out.txt     -> simpan daftar ke file lokal
 *
 * Nol dependency. Cek proxy langsung via TCP socket.
 */

import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { CONFIG, requireSupabase, ROOT } from "../core/config.js";
import { select, upsertBulk, requireColumns, filterToColumns } from "../core/db.js";
import { checkOne, workerCompatCheck, tcpCheck } from "../core/checker.js";
import { geoLookup } from "../core/geo.js";
import { pool } from "../core/pool.js";
import { fetchAllSources, SOURCES } from "../core/sources.js";

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function parseArgs(argv) {
  const out = {
    limit: 1000, check: true, geo: true, dryRun: false, shallow: false,
    list: false, file: "", only: [],
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--limit") out.limit = Number(argv[++i] || 1000);
    else if (a === "--no-check") out.check = false;
    else if (a === "--no-geo") out.geo = false;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--shallow") out.shallow = true;
    else if (a === "--list") out.list = true;
    else if (a === "--file") out.file = argv[++i] || "";
    else if (a === "--source") out.only.push(...String(argv[++i] || "").split(","));
    else if (a === "--help" || a === "-h") out.help = true;
  }
  return out;
}

function usage() {
  console.log(`
${C.bold("Proxy Scraper")} - cari proxy gratis yang hidup

  node scraping/scrape.js [opsi]

  --limit N       jumlah proxy yang dicek (default 1000)
  --no-check      lewati cek, simpan semua hasil scrape
  --shallow       cek TCP connect saja (cepat)
  --no-geo        lewati geolokasi country/ISP
  --dry-run       tidak tulis ke database
  --list          hanya tampil ringkasan sumber
  --file PATH     tulis daftar proxy ke file lokal
  --source IDS    hanya sumber tertentu (pisah koma)
  --help          tampilkan bantuan ini

  ID sumber:
${SOURCES.map((s) => `    ${s.id.padEnd(22)} ${s.url}`).join("\n")}
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return usage();

  if (!args.list) requireSupabase();

  console.log(C.bold(C.cyan("\n🌐 Proxy Scraper\n")));

  // 1. Ambil semua sumber
  console.log(C.dim("   Mengambil daftar proxy dari sumber..."));
  const { results, merged } = await fetchAllSources(args.only.length ? args.only : null);

  console.log(C.bold(`\n   Sumber:\n`));
  for (const r of results) {
    const status = r.ok ? C.green(`${r.count} proxy`) : C.red(`GAGAL (${r.error})`);
    console.log(C.dim(`   ${r.id.padEnd(24)} ${status}`));
  }
  console.log(C.bold(`\n   Total unik: ${C.cyan(String(merged.length))} proxy\n`));

  if (args.list) {
    console.log(C.dim("   Mode --list: berhenti di sini.\n"));
    return;
  }

  if (!merged.length) {
    console.log(C.red("   Tidak ada proxy yang bisa diambil.\n"));
    process.exit(1);
  }

  // Shuffle supaya sample tidak bias ke satu sumber
  for (let i = merged.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [merged[i], merged[j]] = [merged[j], merged[i]];
  }

  let candidates = merged;
  if (args.limit > 0 && args.limit < merged.length) {
    candidates = merged.slice(0, args.limit);
    console.log(C.dim(`   Akan cek ${candidates.length} proxy (limit ${args.limit})\n`));
  }

  // 2. Cek status
  let alive = [];
  if (args.check) {
    console.log(C.dim(`   Mengecek dengan konkurensi ${CONFIG.concurrency}...`));
    const started = Date.now();
    let ok = 0;
    let bad = 0;

    const checked = await pool(
      candidates,
      CONFIG.concurrency,
      async (p) => {
        // Cek kompatibilitas worker: proxy HTTP/SOCKS5 yang benar-benar bisa forward
        if (args.shallow) {
          const t = await tcpCheck(p.ip, p.port);
          return { ...p, is_active: t.ok, ping: t.ms, check_ok: t.ok, check_stage: "tcp", err: t.err, protocol: p.protocol || "http" };
        }
        const r = await workerCompatCheck(p.ip, p.port);
        return {
          ...p,
          is_active: r.ok,
          ping: r.ms ?? null,
          check_ok: r.ok,
          check_stage: r.err ? (r.err.startsWith("socks5") ? "socks5" : "http") : "ok",
          err: r.err || null,
          protocol: p.protocol || "http",
        };
      },
      (done, total, r) => {
        if (r?.is_active) ok++;
        else bad++;
        if (done % 50 === 0 || done === total) {
          process.stdout.write(`\r   ${C.dim(`[${done}/${total}] hidup=${ok} mati=${bad}   `)}`);
        }
      }
    );
    process.stdout.write("\n");

    alive = checked.filter((r) => r && r.is_active).map((r) => ({
      ip: r.ip, port: r.port, ping: r.ping, protocol: r.protocol || "http",
    }));

    const elapsed = ((Date.now() - started) / 1000).toFixed(1);
    console.log(C.green(`   ${alive.length} proxy hidup dari ${checked.length} (${elapsed}s)\n`));
  } else {
    console.log(C.dim("   Mode --no-check: semua proxy dianggap hidup.\n"));
    alive = candidates.map((p) => ({ ip: p.ip, port: p.port, ping: null, protocol: p.protocol || "http" }));
  }

  if (!alive.length) {
    console.log(C.red("   Tidak ada proxy hidup. Selesai.\n"));
    return;
  }

  // 3. Geolokasi
  if (args.geo) {
    console.log(C.dim(`   Mengambil geolokasi untuk ${alive.length} IP...`));
    const geo = await geoLookup(alive.map((p) => p.ip));
    for (const p of alive) {
      const g = geo.get(p.ip);
      p.country = g?.country || null;
      p.org = g?.org || null;
      p.asn = g?.asn || null;
    }
    const withGeo = alive.filter((p) => p.country).length;
    console.log(C.dim(`   ${withGeo}/${alive.length} dapat geolokasi\n`));
  }

  // 4. Filter
  const good = alive.filter((p) => p.ping === null || p.ping <= CONFIG.pingOk);
  console.log(C.dim(`   Setelah filter ping <= ${CONFIG.pingOk}ms: ${good.length} proxy\n`));

  // 5. Simpan ke file lokal
  if (args.file) {
    const path = resolve(ROOT, args.file);
    const text = good.map((p) => `${p.ip}:${p.port}`).join("\n");
    writeFileSync(path, text + "\n");
    console.log(C.green(`   Ditulis: ${path} (${good.length} baris)\n`));
  }

  // 6. Simpan ke database
  if (args.dryRun) {
    console.log(C.yellow("   Dry run - tidak menulis ke database."));
    console.log(C.dim("   Contoh data yang akan disimpan:\n"));
    for (const p of good.slice(0, 10)) {
      console.log(C.dim(`     ${p.ip}:${p.port}  ${p.country || "??"}  ${p.org || "-"}  ${p.ping ?? "-"}ms`));
    }
    console.log("");
    return;
  }

  console.log(C.cyan("   Menyimpan ke database..."));
  const now = new Date().toISOString();

  // Hanya kirim kolom yang benar-benar ada di tabel
  let cols;
  try {
    cols = await requireColumns("proxy_pool");
  } catch (e) {
    console.log(C.red(`   Error: ${e.message}`));
    process.exit(1);
  }
  const missing = ["protocol", "check_ok", "check_stage"].filter((c) => !cols.has(c));
  if (missing.length) {
    console.log(C.yellow(`   Peringatan: kolom belum ada di DB: ${missing.join(", ")}`));
    console.log(C.dim("   Jalankan schema.sql di Supabase SQL Editor untuk menambahkannya.\n"));
  }

  const rows = good.map((p) => filterToColumns({
    ip: p.ip,
    port: p.port,
    country: p.country ?? null,
    org: p.org ?? null,
    protocol: p.protocol || "http",
    is_active: true,
    check_ok: true,
    check_stage: p.protocol || "http",
    ping: typeof p.ping === "number" ? p.ping : null,
    last_checked: now,
  }, cols));

  // upsert butuh unique constraint pada (ip,port)
  const { error } = await upsertBulk("proxy_pool", rows, "ip,port");
  if (error) {
    console.log(C.red(`   Error simpan: ${error}`));
    console.log(C.dim("   Pastikan tabel punya UNIQUE(ip, port). Lihat schema.sql\n"));
    process.exit(1);
  }

  console.log(C.green(`   ${rows.length} proxy tersimpan.\n`));

  // 7. Ringkasan per negara
  const byCountry = new Map();
  for (const p of good) {
    const c = p.country || "??";
    byCountry.set(c, (byCountry.get(c) || 0) + 1);
  }
  const top = [...byCountry.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (top.length) {
    console.log(C.bold("   Distribusi negara:\n"));
    for (const [cc, n] of top) {
      const bar = "█".repeat(Math.min(30, Math.ceil(n / 5)));
      console.log(C.dim(`   ${cc}  ${String(n).padStart(4)}  ${C.cyan(bar)}`));
    }
    console.log("");
  }
}

main().catch((err) => {
  console.error(C.red(`\n❌ Fatal: ${err?.stack || err}\n`));
  process.exit(1);
});

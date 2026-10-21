#!/usr/bin/env node
/**
 * Proxy Manager - menu interaktif untuk scraper + checker.
 *
 * Jalankan: node cli.js
 */

import { spawn } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import * as readline from "readline";

const __dirname = dirname(fileURLToPath(import.meta.url));

const C = {
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const ask = (q) => new Promise((r) => rl.question(q, r));

function run(script, args) {
  return new Promise((resolve) => {
    const p = spawn(process.execPath, [resolve(__dirname, script), ...args], {
      stdio: "inherit",
      cwd: __dirname,
    });
    p.on("close", (code) => resolve(code));
  });
}

function header() {
  console.log(C.bold(C.cyan("\n╔══════════════════════════════════════════╗")));
  console.log(C.bold(C.cyan("║      🌐 Proxy Manager - Standalone       ║")));
  console.log(C.bold(C.cyan("╚══════════════════════════════════════════╝")));
}

function menu() {
  console.log(C.bold("\n📋 Menu:\n"));
  console.log(`   ${C.cyan("1.")} Scrape proxy baru   (cek + simpan ke DB)`);
  console.log(`   ${C.cyan("2.")} Cek proxy di DB     (update status)`);
  console.log(`   ${C.cyan("2b")} Bersihkan proxy basi (tandai mati yang belum dicek)`);
  console.log(`   ${C.cyan("3.")} Lihat status sumber  (cek list tersedia)`);
  console.log(`   ${C.cyan("4.")} Test kompatibilitas worker`);
  console.log(`   ${C.cyan("5.")} Setup database     (tambah kolom)`);
  console.log(`   ${C.cyan("0.")} Keluar\n`);
}

async function main() {
  header();
  while (true) {
    menu();
    const c = (await ask(C.bold("   Pilih [0-5]: "))).trim();

    if (c === "1") {
      const limit = (await ask("   Berapa proxy yang dicek? [500]: ")).trim() || "500";
      // geolokasi default ON di scrape.js, jadi tidak perlu flag tambahan
      await run("scraping/scrape.js", ["--limit", limit]);
    } else if (c === "2") {
      const limit = (await ask("   Berapa proxy dicek? [semua]: ")).trim();
      const args = ["--limit", limit || "0"];
      await run("Checker/check.js", args);
    } else if (c === "2b") {
      const hours = (await ask("   Proxy basi (> jam) ditandai mati? [24]: ")).trim() || "24";
      await run("Checker/check.js", ["--stale", hours]);
    } else if (c === "3") {
      await run("scraping/scrape.js", ["--list"]);
    } else if (c === "4") {
      const n = (await ask("   Sample berapa? [200]: ")).trim() || "200";
      await run("test/worker-compat.js", [n]);
    } else if (c === "5") {
      await run("setup/setup-db.js", []);
    } else if (c === "0") {
      console.log(C.dim("\n   Sampai jumpa! 👋\n"));
      rl.close();
      process.exit(0);
    } else {
      console.log(C.red("   Pilihan tidak valid!\n"));
    }
  }
}

main().catch((e) => {
  console.error(C.red(`\n❌ ${e?.message || e}\n`));
  process.exit(1);
});

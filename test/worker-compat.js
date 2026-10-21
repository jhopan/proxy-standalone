#!/usr/bin/env node
/**
 * Test proxy yang PERSIS kompatibel dengan worker VPN.
 *
 * Worker fallback menulis raw bytes (TLS ClientHello) ke proxy.
 * Jadi proxy harus meneruskan traffic mentah ke target.
 *
 * Usage: node test/worker-compat.js [jumlah] [port-list]
 */
import { fetchAllSources } from "../core/sources.js";
import { workerCompatCheck, tcpCheck } from "../core/checker.js";
import { pool } from "../core/pool.js";

const N = Number(process.argv[2] || 200);

const { merged } = await fetchAllSources(null);
for (let i = merged.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [merged[i], merged[j]] = [merged[j], merged[i]];
}

// Fokus ke port yang dipakai worker untuk proxy: 443, 8080, 3128, 1080
const COMMON_PORTS = new Set([443, 8080, 3128, 1080, 8000, 8888, 8118]);
const list = merged.slice(0, N);

console.log(`Sample ${list.length} proxy, cek kompatibilitas worker\n`);

const t0 = Date.now();
const res = await pool(list, 50, async (p) => {
  const tcp = await tcpCheck(p.ip, p.port);
  if (!tcp.ok) return { ip: p.ip, port: p.port, ok: false, stage: "tcp", err: tcp.err, ms: null };

  const w = await workerCompatCheck(p.ip, p.port);
  return {
    ip: p.ip, port: p.port, ok: w.ok, stage: w.stage, err: w.err, ms: w.ms,
    commonPort: COMMON_PORTS.has(Number(p.port)),
  };
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const cnt = (pred) => res.filter(pred).length;

console.log(`Selesai ${elapsed}s\n`);
console.log(`  TCP ok                 : ${cnt((r) => r.stage !== "tcp")} / ${res.length}`);
console.log(`  Worker-compatible      : ${cnt((r) => r.ok)} / ${res.length}`);
console.log(`  ...dari port umum      : ${cnt((r) => r.ok && r.commonPort)}`);

const errs = {};
for (const r of res) {
  const k = r.ok ? "OK" : r.err || r.stage;
  errs[k] = (errs[k] || 0) + 1;
}
console.log("\n  Distribusi:");
for (const [k, v] of Object.entries(errs).sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`    ${String(v).padStart(4)}x  ${k}`);
}

const good = res.filter((r) => r.ok);
if (good.length) {
  const pings = good.map((r) => r.ms).sort((a, b) => a - b);
  console.log(`\n  Ping: min ${pings[0]}ms  median ${pings[Math.floor(pings.length / 2)]}ms  max ${pings[pings.length - 1]}ms`);
  console.log("\n  Proxy yang bisa dipakai worker:");
  for (const r of good.slice(0, 20)) {
    console.log(`    ${r.ip}:${r.port}  ${r.ms}ms`);
  }
}

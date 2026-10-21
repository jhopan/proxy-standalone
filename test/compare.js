#!/usr/bin/env node
/**
 * Bandingkan kapabilitas proxy: TLS (dipakai worker VPN) vs HTTP vs SOCKS.
 * Usage: node test/compare.js [jumlah]
 */
import { fetchAllSources } from "../core/sources.js";
import { tcpCheck, tlsCheck, httpConnectCheck, socks5Check, socks4Check } from "../core/checker.js";
import { pool } from "../core/pool.js";

const N = Number(process.argv[2] || 150);

const { merged } = await fetchAllSources(null);
for (let i = merged.length - 1; i > 0; i--) {
  const j = Math.floor(Math.random() * (i + 1));
  [merged[i], merged[j]] = [merged[j], merged[i]];
}
const list = merged.slice(0, N);

console.log(`Sample ${list.length} dari ${merged.length} proxy unik\n`);

const t0 = Date.now();
const res = await pool(list, 50, async (p) => {
  const out = { ip: p.ip, port: p.port, src: p.protocol, tcp: false, tls: false, http: false, socks: false, ms: null, err: null };

  const tcp = await tcpCheck(p.ip, p.port);
  if (!tcp.ok) {
    out.err = "tcp:" + tcp.err;
    return out;
  }
  out.tcp = true;

  const tls = await tlsCheck(p.ip, p.port);
  if (tls.ok) {
    out.tls = true;
    out.ms = tls.ms;
    return out;
  }

  const http = await httpConnectCheck(p.ip, p.port);
  if (http.ok) {
    out.http = true;
    out.ms = http.ms;
    return out;
  }

  const s5 = await socks5Check(p.ip, p.port);
  if (s5.ok) {
    out.socks = true;
    out.ms = s5.ms;
    return out;
  }

  const s4 = await socks4Check(p.ip, p.port);
  if (s4.ok) {
    out.socks = true;
    out.ms = s4.ms;
    return out;
  }

  out.err = "no-handshake";
  return out;
});

const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const cnt = (pred) => res.filter(pred).length;

console.log(`Selesai ${elapsed}s\n`);
console.log(`  TCP connect ok   : ${cnt((r) => r.tcp)} / ${res.length}`);
console.log(`  TLS ok (worker)  : ${cnt((r) => r.tls)}`);
console.log(`  HTTP CONNECT ok  : ${cnt((r) => r.http)}`);
console.log(`  SOCKS ok         : ${cnt((r) => r.socks)}`);
console.log(`  Bisa dipakai worker (TLS): ${cnt((r) => r.tls)} / ${res.length}`);

const errs = {};
for (const r of res) {
  const key = r.err || "ok";
  errs[key] = (errs[key] || 0) + 1;
}
console.log("\n  Distribusi:");
for (const [k, v] of Object.entries(errs).sort((a, b) => b[1] - a[1])) {
  console.log(`    ${String(v).padStart(4)}x  ${k}`);
}

const usable = res.filter((r) => r.tls);
if (usable.length) {
  console.log("\n  Contoh yang bisa dipakai worker:");
  for (const r of usable.slice(0, 15)) {
    console.log(`    ${r.ip}:${r.port}  ${r.ms}ms`);
  }
}

#!/usr/bin/env node
/**
 * Benchmark sumber list: cek hit-rate worker-compat per sumber.
 * Usage: node test/source-bench.js [sample-per-source]
 */
import net from "node:net";
import { pool } from "../core/pool.js";

const SAMPLE = Number(process.argv[2] || 60);

const SOURCES = {
  "hookzof-socks5": "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt",
  "ALIILAPRO-socks5": "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt",
  "ALIILAPRO-http": "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt",
  "jetkai-https": "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt",
  "jetkai-http": "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt",
  "ShiftyTR-socks5": "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt",
  "ErcinDedeoglu": "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt",
  "proxifly-socks5": "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/socks5/data.txt",
};

function socks5Handshake(ip, port, timeout = 6000) {
  return new Promise((resolve) => {
    let settled = false;
    const s = net.connect({ host: ip, port: Number(port) });
    const done = (v) => { if (!settled) { settled = true; try { s.destroy(); } catch {} resolve(v); } };
    const to = setTimeout(() => done({ r: "timeout" }), timeout);
    s.on("connect", () => s.write(Buffer.from([0x05, 0x01, 0x00])));
    s.on("data", (d) => {
      clearTimeout(to);
      if (d[0] === 0x05) {
        if (d[1] === 0x00) done({ r: "socks5", auth: false });
        else if (d[1] === 0xff) done({ r: "socks5-auth" });
        else done({ r: "socks5-method" });
      } else if (d.length > 4 && d[0] === 0x48) done({ r: "cdn" });
      else done({ r: "other" });
    });
    s.on("error", (e) => { clearTimeout(to); done({ r: "err:" + e.code }); });
    s.on("close", () => { clearTimeout(to); done({ r: "closed" }); });
  });
}

console.log(`Benchmark sumber, sample ${SAMPLE} per sumber\n`);

for (const [id, url] of Object.entries(SOURCES)) {
  let all = [];
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(20000) });
    const txt = await res.text();
    all = txt.split(/\r?\n/).map((l) => l.trim()).filter((l) => /^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}:\d+$/.test(l));
  } catch (e) {
    console.log(`${id.padEnd(18)} GAGAL: ${e.message.slice(0, 40)}`);
    continue;
  }

  if (!all.length) {
    console.log(`${id.padEnd(18)} 0 proxy`);
    continue;
  }

  for (let i = all.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [all[i], all[j]] = [all[j], all[i]];
  }
  const samp = all.slice(0, SAMPLE);

  const t0 = Date.now();
  const res = await pool(samp, 40, async (line) => {
    const [ip, port] = line.split(":");
    return await socks5Handshake(ip, port);
  });
  const secs = ((Date.now() - t0) / 1000).toFixed(1);

  const cnt = {};
  for (const r of res) {
    if (r && r.r) cnt[r.r] = (cnt[r.r] || 0) + 1;
  }
  const socks = cnt.socks5 || 0;
  const rate = ((socks / samp.length) * 100).toFixed(1);

  console.log(
    `${id.padEnd(18)} total=${String(all.length).padStart(6)}  socks5=${String(socks).padStart(3)} (${rate}%)  ${secs}s  ${JSON.stringify(cnt)}`
  );
}

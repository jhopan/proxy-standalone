// Daftar sumber list proxy gratis + parser.
// Format list: satu "ip:port" atau "ip" per baris (port default 443).

export const SOURCES = [
  // --- Tier 1: high yield (hasil benchmark 21 Okt 2026) ---
  // ALIILAPRO: 55% SOCKS5 hidup, 2600 proxy, di-refresh harian
  { id: "aliilapro-socks5", protocol: "socks5", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks5.txt", port: "1080", yield: 0.55 },
  { id: "aliilapro-socks4", protocol: "socks4", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/socks4.txt", port: "1080", yield: 0.30 },
  { id: "aliilapro-http", protocol: "http", url: "https://raw.githubusercontent.com/ALIILAPRO/Proxy/main/http.txt", port: "8080", yield: 0.02 },
  // ShiftyTR: 30% SOCKS5 hidup, kecil tapi segar
  { id: "shiftytr-socks5", protocol: "socks5", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/socks5.txt", port: "1080", yield: 0.30 },
  { id: "shiftytr-http", protocol: "http", url: "https://raw.githubusercontent.com/ShiftyTR/Proxy-List/master/http.txt", port: "8080", yield: 0.02 },

  // --- Tier 2: volume besar, yield rendah ---
  { id: "hookzof-socks5", protocol: "socks5", url: "https://raw.githubusercontent.com/hookzof/socks5_list/master/proxy.txt", port: "1080", yield: 0.05 },
  { id: "ercin-http", protocol: "http", url: "https://raw.githubusercontent.com/ErcinDedeoglu/proxies/main/proxies/http.txt", port: "8080", yield: 0.08 },
  { id: "speedx-socks5", protocol: "socks5", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/socks5.txt", port: "1080", yield: 0.03 },
  { id: "speedx-http", protocol: "http", url: "https://raw.githubusercontent.com/TheSpeedX/PROXY-List/master/http.txt", port: "8080", yield: 0.02 },
  { id: "monosans-socks5", protocol: "socks5", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/socks5.txt", port: "1080", yield: 0.03 },
  { id: "monosans-http", protocol: "http", url: "https://raw.githubusercontent.com/monosans/proxy-list/main/proxies/http.txt", port: "8080", yield: 0.02 },
  { id: "proxy4parsing-http", protocol: "http", url: "https://raw.githubusercontent.com/proxy4parsing/proxy-list/main/http.txt", port: "8080", yield: 0.01 },
  { id: "mmpx12-socks4", protocol: "socks4", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/socks4.txt", port: "1080", yield: 0.03 },
  { id: "mmpx12-http", protocol: "http", url: "https://raw.githubusercontent.com/mmpx12/proxy-list/master/http.txt", port: "8080", yield: 0.02 },
  { id: "zloi-socks4", protocol: "socks4", url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/socks4.txt", port: "1080", yield: 0.03 },
  { id: "zloi-http", protocol: "http", url: "https://raw.githubusercontent.com/zloi-user/hideip.me/main/http.txt", port: "8080", yield: 0.02 },
  { id: "jetkai-http", protocol: "http", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-http.txt", port: "8080", yield: 0.02 },
  { id: "jetkai-https", protocol: "https", url: "https://raw.githubusercontent.com/jetkai/proxy-list/main/online-proxies/txt/proxies-https.txt", port: "443", yield: 0.02 },
  { id: "clarketm", protocol: "http", url: "https://raw.githubusercontent.com/clarketm/proxy-list/master/proxy-list-raw.txt", port: "8080", yield: 0.02 },
  { id: "proxifly-http", protocol: "http", url: "https://raw.githubusercontent.com/proxifly/free-proxy-list/main/proxies/protocols/http/data.txt", port: "8080", yield: 0.01 },
  { id: "roosterkid-https", protocol: "https", url: "https://raw.githubusercontent.com/roosterkid/openproxylist/main/HTTPS_RAW.txt", port: "443", yield: 0.01 },
];

/**
 * Sumber yang paling produktif (diurutkan by yield historis).
 * Pakai ini untuk mode harvest: cek sumber high-yield dulu.
 */
export const SOURCES_BY_YIELD = [...SOURCES].sort((a, b) => (b.yield || 0) - (a.yield || 0));

export const GEO_SOURCES = [
  { id: "geonode", protocol: "http", url: "http://proxylist.geonode.com/api/proxy-list?limit=500&page=1&sort_by=lastChecked&sort_type=desc" },
  { id: "openproxyspace", protocol: "http", url: "https://api.openproxylist.xyz/http.txt" },
];

const IPV4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;

// --- Deteksi IP CDN/Cloudflare (bukan proxy) ---
// List proxy gratisan banyak tercampur IP Cloudflare Anycast yang salah
// diklasifikasi. Filter ini membuangnya sebelum cek (hemat waktu).
const CDN_RANGES = [
  // Cloudflare IPv4
  { start: [104, 16, 0, 0], end: [104, 31, 255, 255] },
  { start: [172, 64, 0, 0], end: [172, 71, 255, 255] },
  { start: [173, 245, 48, 0], end: [173, 245, 48, 255] },
  { start: [103, 21, 244, 0], end: [103, 22, 200, 255] },
  { start: [103, 31, 4, 0], end: [103, 31, 4, 255] },
  { start: [141, 101, 64, 0], end: [141, 101, 127, 255] },
  { start: [108, 162, 192, 0], end: [108, 162, 255, 255] },
  { start: [190, 93, 240, 0], end: [190, 93, 240, 255] },
  { start: [188, 114, 96, 0], end: [188, 114, 97, 255] },
  { start: [197, 234, 240, 0], end: [197, 234, 241, 255] },
  { start: [198, 41, 128, 0], end: [198, 41, 132, 255] },
  { start: [162, 158, 0, 0], end: [162, 159, 255, 255] },
  { start: [199, 27, 128, 0], end: [199, 29, 255, 255] },
  { start: [192, 0, 0, 0], end: [192, 0, 0, 255] },
  { start: [162, 254, 0, 0], end: [162, 254, 255, 255] },
  { start: [199, 45, 0, 0], end: [199, 45, 255, 255] },
  // Fastly / Akamai / Google (sering muncul juga)
  { start: [23, 235, 32, 0], end: [23, 235, 47, 255] },
  { start: [104, 156, 224, 0], end: [104, 156, 239, 255] },
  { start: [151, 101, 0, 0], end: [151, 101, 255, 255] },
  { start: [142, 250, 0, 0], end: [142, 251, 255, 255] },
];

function ipToInt(ip) {
  const p = ip.split(".").map(Number);
  if (p.length !== 4 || p.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return ((p[0] << 24) >>> 0) + (p[1] << 16) + (p[2] << 8) + p[3];
}

export function isCdnIp(ip) {
  const v = ipToInt(ip);
  if (v === null) return false;
  for (const r of CDN_RANGES) {
    const s = ((r.start[0] << 24) >>> 0) + (r.start[1] << 16) + (r.start[2] << 8) + r.start[3];
    const e = ((r.end[0] << 24) >>> 0) + (r.end[1] << 16) + (r.end[2] << 8) + r.end[3];
    if (v >= s && v <= e) return true;
  }
  return false;
}

export function isIPv4(s) {
  const m = IPV4.exec(s);
  if (!m) return false;
  for (let i = 1; i <= 4; i++) {
    const n = Number(m[i]);
    if (n < 0 || n > 255) return false;
  }
  return true;
}

/**
 * Parse isi list proxy.
 * Terima: "ip:port", "ip", "ip:port:user:pass" (ambil ip:port saja)
 * @returns {Array<{ip:string,port:string}>}
 */
export function parseList(text, defaultPort = "443", protocol = "http") {
  const out = [];
  const seen = new Set();
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    // buang komentar
    if (line.startsWith("#")) continue;
    // ambil kolom pertama bila format CSV/tab
    line = line.split(/[\s,;\t]+/)[0];
    if (!line) continue;

    // protocol://ip:port
    if (line.includes("://")) line = line.slice(line.indexOf("://") + 3);
    // buang path/query
    line = line.split("/")[0].split("?")[0];

    let ip = line;
    let port = defaultPort;
    const parts = line.split(":");
    if (parts.length >= 2) {
      ip = parts[0];
      port = parts[1];
    }
    if (!isIPv4(ip)) continue;
    if (isCdnIp(ip)) continue; // buang IP CDN (bukan proxy)
    if (!/^\d{2,5}$/.test(port)) continue;
    const p = Number(port);
    if (p < 1 || p > 65535) continue;

    const key = `${ip}:${port}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ ip, port: String(port), protocol });
  }
  return out;
}

/**
 * Download satu sumber list.
 * @returns {Promise<{id:string, ok:boolean, count:number, error:string|null}>}
 */
export async function fetchSource(source, { retries = 2 } = {}) {
  let lastErr = null;
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(source.url, {
        signal: AbortSignal.timeout(25000),
        headers: {
          "User-Agent": "Mozilla/5.0 (proxy-standalone)",
          "Accept": "text/plain, */*",
        },
      });
      if (!res.ok) {
        lastErr = `HTTP ${res.status}`;
        // 404 = tidak ada retry, 429/5xx = retry
        if (res.status === 404) return { id: source.id, ok: false, count: 0, error: lastErr };
        await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
        continue;
      }
      const text = await res.text();
      const protocol = source.protocol || "http";
      const parsed = parseList(text, source.port, protocol);
      return { id: source.id, ok: true, count: parsed.length, error: null, parsed };
    } catch (err) {
      lastErr = err?.message || String(err);
      await new Promise((r) => setTimeout(r, 1200 * (attempt + 1)));
    }
  }
  return { id: source.id, ok: false, count: 0, error: lastErr };
}

/**
 * Ambil semua sumber (atau subset).
 * @param {string[]|null} onlyIds
 */
export async function fetchAllSources(onlyIds = null) {
  const list = onlyIds && onlyIds.length
    ? SOURCES.filter((s) => onlyIds.includes(s.id))
    : SOURCES;

  // Sequential + jeda: GitHub raw rate limit kalau parallel many sources
  const results = [];
  for (const src of list) {
    results.push(await fetchSource(src));
    await new Promise((r) => setTimeout(r, 250));
  }
  const merged = new Map();
  for (const r of results) {
    if (!r.parsed) continue;
    for (const p of r.parsed) {
      const key = `${p.ip}:${p.port}`;
      if (!merged.has(key)) merged.set(key, { ...p, sources: [r.id] });
      else {
        const cur = merged.get(key);
        cur.sources.push(r.id);
        // kalau ada versi socks, ambil yang lebih spesifik
        if (p.protocol && p.protocol !== "http" && cur.protocol === "http") {
          cur.protocol = p.protocol;
        }
      }
    }
  }
  return { results, merged: [...merged.values()] };
}

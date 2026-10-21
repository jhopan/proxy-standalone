// Geolokasi proxy (country + ISP/org) via batch API.
// ip-api.com: 15 request/menit per IP, 100 IP per batch POST.
// Fallback: ipwho.is satu-per-satu (free, 10k/bulan).

import { CONFIG } from "./config.js";

/**
 * Ambil geo untuk daftar IP.
 * @param {string[]} ips
 * @returns {Promise<Map<string, {country:string,org:string,asn:string,proxy:boolean,hosting:boolean}>>}
 */
export async function geoLookup(ips) {
  const out = new Map();
  if (!ips.length) return out;

  const uniq = [...new Set(ips.filter(Boolean))];
  const batchSize = CONFIG.geoBatch;

  for (let i = 0; i < uniq.length; i += batchSize) {
    const chunk = uniq.slice(i, i + batchSize);
    const got = await geoBatch(chunk);
    if (got) {
      for (const [ip, info] of Object.entries(got)) out.set(ip, info);
    } else {
      // fallback satu-satu
      for (const ip of chunk) {
        const info = await geoSingle(ip);
        if (info) out.set(ip, info);
      }
    }
  }
  return out;
}

async function geoBatch(chunk) {
  try {
    const res = await fetch(CONFIG.geoUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(chunk),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data)) return null;

    const map = {};
    let any = false;
    for (const row of data) {
      if (!row || row.status !== "success" || !row.query) continue;
      any = true;
      map[row.query] = {
        country: row.countryCode || null,
        org: row.isp || row.org || row.as || null,
        asn: row.as || null,
        proxy: row.proxy === true,
        hosting: row.hosting === true,
      };
    }
    return any ? map : null;
  } catch {
    return null;
  }
}

async function geoSingle(ip) {
  try {
    const res = await fetch(`https://ipwho.is/${encodeURIComponent(ip)}`, {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) return null;
    const d = await res.json();
    if (!d || d.success === false) return null;
    return {
      country: d.country_code || null,
      org: d.connection?.isp || d.connection?.org || null,
      asn: d.connection?.asn ? `AS${d.connection.asn}` : null,
      proxy: Boolean(d.security?.proxy ?? d.security?.vpn ?? false),
      hosting: Boolean(d.connection?.hosting ?? false),
    };
  } catch {
    return null;
  }
}

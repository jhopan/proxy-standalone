// Proxy checker mandiri — tanpa API pihak ketiga.
// Lapis 1: TCP connect (port Proxy)  -> penentu utama hidup/mati
// Lapis 2: handshake sesuai protokol   -> apakah benar-benar proxy yang bisa forward
// Lapis 3: latency                    -> ping proxy ke target internet

import net from "node:net";
import tls from "node:tls";
import { CONFIG } from "./config.js";

/**
 * TCP connect test.
 * @returns {{ok:boolean, ms:number|null, err:string|null}}
 */
export function tcpCheck(ip, port, timeout = CONFIG.connectTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;

    const done = (ok, err = null) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, ms: ok ? Date.now() - started : null, err });
    };

    const socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    socket.setTimeout(timeout);

    socket.once("connect", () => done(true, null));
    socket.once("timeout", () => done(false, "connect-timeout"));
    socket.once("error", (e) => done(false, e.code || e.message));
  });
}

/**
 * HTTP CONNECT test — cek proxy benar-benar bisa meneruskan ke target luar.
 * Kirim: CONNECT 1.1.1.1:443 HTTP/1.1 lalu baca response header pertama.
 */
export function httpConnectCheck(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let buf = "";

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    const socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    socket.setTimeout(timeout);

    socket.once("connect", () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `User-Agent: Mozilla/5.0\r\n` +
        `Proxy-Connection: keep-alive\r\n\r\n`
      );
    });

    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const idx = buf.indexOf("\r\n");
      if (idx === -1) {
        if (buf.length > 512) done({ ok: false, code: null, ms: Date.now() - started, err: "no-header" });
        return;
      }
      const statusLine = buf.slice(0, idx);
      const m = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/);
      const code = m ? Number(m[1]) : 0;
      // 200 = CONNECT berhasil. 403/407 = hidup tapi butuh auth (still usable untukumeration)
      if (code === 200) {
        done({ ok: true, code, ms: Date.now() - started, err: null });
      } else if (code === 403 || code === 407) {
        done({ ok: true, code, ms: Date.now() - started, err: "auth-required" });
      } else if (code > 0) {
        done({ ok: false, code, ms: Date.now() - started, err: `http-${code}` });
      } else {
        done({ ok: false, code: 0, ms: Date.now() - started, err: "bad-status" });
      }
    });

    socket.once("timeout", () => done({ ok: false, code: null, ms: null, err: "http-timeout" }));
    socket.once("error", (e) => done({ ok: false, code: null, ms: null, err: e.code || e.message }));
    socket.once("close", () => done({ ok: false, code: null, ms: null, err: "closed" }));
  });
}

/**
 * Ukur latency ke target lewat proxy (CONNECT + TLS-ish handshake minimal).
 * Dipakai untuk mendapatkan angka ping yang representatif.
 */
export function latencyCheck(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.totalTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let buf = "";

    const done = (ms, err = null) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ms, err });
    };

    const socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    socket.setTimeout(timeout);

    socket.once("connect", () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `User-Agent: Mozilla/5.0\r\n\r\n`
      );
    });

    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const idx = buf.indexOf("\r\n");
      if (idx === -1) return;
      const m = buf.slice(0, idx).match(/^HTTP\/1\.[01]\s+(\d{3})/);
      const code = m ? Number(m[1]) : 0;
      if (code === 200) {
        // Kirim TLS ClientHello minimal supaya proxy benar-benar relay data
        socket.write(Buffer.from([0x16, 0x03, 0x01, 0x00, 0x50, 0x01, 0x00, 0x00, 0x4c]));
        // Tunggu balasan proxy (server TLS) -> proxy benar-benar relay payload
        socket.once("data", () => done(Date.now() - started, null));
      } else {
        done(null, `http-${code}`);
      }
    });

    socket.once("timeout", () => done(null, "timeout"));
    socket.once("error", (e) => done(null, e.code || e.message));
    socket.once("close", () => { if (!settled) done(null, "closed"); });
  });
}

/** SOCKS5 handshake + CONNECT ke target. */
export function socks5Check(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let stage = "greeting";

    const socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    socket.setTimeout(timeout);

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    const sendConnect = () => {
      stage = "connect";
      const b = Buffer.alloc(10);
      b[0] = 0x05; b[1] = 0x01; b[2] = 0x00; b[3] = 0x01;
      b.writeUInt32BE(0x01010101, 4);
      b.writeUInt16BE(targetPort, 8);
      socket.write(b);
    };

    socket.once("connect", () => {
      socket.write(Buffer.from([0x05, 0x01, 0x00]));
    });

    socket.on("data", (d) => {
      if (stage === "greeting") {
        if (d[0] !== 0x05) return done({ ok: false, code: null, ms: null, err: "not-socks5" });
        if (d[1] === 0x00) sendConnect();
        else if (d[1] === 0xff) done({ ok: false, code: null, ms: null, err: "auth-required" });
        else done({ ok: false, code: null, ms: null, err: "socks5-auth-unsupported" });
        return;
      }
      if (d.length < 4) return;
      const rep = d[1];
      if (rep === 0x00) {
        done({ ok: true, code: 0, ms: Date.now() - started, err: null });
      } else if (rep === 0x05) {
        done({ ok: false, code: rep, ms: null, err: "connection-refused" });
      } else {
        done({ ok: false, code: rep, ms: null, err: `socks5-rep-${rep}` });
      }
    });

    socket.once("timeout", () => done({ ok: false, code: null, ms: null, err: `socks5-${stage}-timeout` }));
    socket.once("error", (e) => done({ ok: false, code: null, ms: null, err: e.code || e.message }));
    socket.once("close", () => done({ ok: false, code: null, ms: null, err: "closed" }));
  });
}

/** SOCKS4 CONNECT ke target (IPv4). */
export function socks4Check(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;

    const socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    socket.setTimeout(timeout);

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    socket.once("connect", () => {
      const b = Buffer.alloc(9);
      b[0] = 0x04;
      b[1] = 0x01;
      b.writeUInt16BE(targetPort, 2);
      b.writeUInt32BE(0x01010101, 4);
      b.write("jhopan", 8, "latin1");
      socket.write(b);
    });

    socket.on("data", (d) => {
      if (d.length < 2) return;
      const rep = d[1];
      if (rep === 0x5a) done({ ok: true, code: rep, ms: Date.now() - started, err: null });
      else if (rep === 0x5b) done({ ok: false, code: rep, ms: null, err: "connection-refused" });
      else done({ ok: false, code: rep, ms: null, err: `socks4-rep-${rep}` });
    });

    socket.once("timeout", () => done({ ok: false, code: null, ms: null, err: "socks4-timeout" }));
    socket.once("error", (e) => done({ ok: false, code: null, ms: null, err: e.code || e.message }));
    socket.once("close", () => done({ ok: false, code: null, ms: null, err: "closed" }));
  });
}

/**
 * Cek lengkap satu proxy.
 * @returns {{ip,port,is_active,ping,check_stage,check_ok,err}}
 */
/**
 * TLS handshake check.
 * Worker VPN connect ke proxy dengan secureTransport:"on" -> proxy harus
 * bisa negotiating TLS. Proxy HTTP/SOCKS plaintext TIDAK bisa dipakai worker.
 */
export function tlsCheck(ip, port, timeout = CONFIG.connectTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;

    const done = (ok, err = null) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, ms: ok ? Date.now() - started : null, err });
    };

    let socket;
    try {
      socket = tls.connect({
        host: ip,
        port: Number(port),
        rejectUnauthorized: false, // proxy gratis punya sertifikat self-signed
        ALPNProtocols: ["http/1.1"],
        // jangan set servername = IP (Node tolak), dan tanpa SNI handshake
        // tetap jalan untuk proxy yang tidak butuh hostname
      });
    } catch (e) {
      done(false, e.code || e.message);
      return;
    }

    socket.setTimeout(timeout);
    socket.once("secureConnect", () => done(true, null));
    socket.once("timeout", () => done(false, "tls-timeout"));
    socket.once("error", (e) => done(false, e.code || e.message));
  });
}

/**
 * TLS + HTTP CONNECT combined: TLS ke proxy, lalu minta CONNECT ke target.
 * Ini persis yang dilakukan worker VPN (TLS transport ke proxy).
 */
export function tlsProxyCheck(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let buf = "";

    let socket;
    try {
      socket = tls.connect({
        host: ip,
        port: Number(port),
        rejectUnauthorized: false,
      });
    } catch (e) {
      done({ ok: false, code: null, ms: null, err: e.code || e.message });
      return;
    }
    socket.setTimeout(timeout);

    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };

    socket.once("secureConnect", () => {
      socket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `User-Agent: Mozilla/5.0\r\n\r\n`
      );
    });

    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const idx = buf.indexOf("\r\n");
      if (idx === -1) {
        if (buf.length > 512) done({ ok: false, code: null, ms: Date.now() - started, err: "no-header" });
        return;
      }
      const m = buf.slice(0, idx).match(/^HTTP\/1\.[01]\s+(\d{3})/);
      const code = m ? Number(m[1]) : 0;
      // Header block = semua baris sebelum baris kosong
      const headEnd = buf.indexOf("\r\n\r\n");
      const head = (headEnd === -1 ? buf : buf.slice(0, headEnd)).toString("latin1");

      if (code === 200) {
        done({ ok: true, code, ms: Date.now() - started, err: null });
      } else if (code === 403 || code === 407) {
        done({ ok: true, code, ms: Date.now() - started, err: "auth-required" });
      } else if (code > 0) {
        // Deteksi CDN/edge: "Server: cloudflare" dll -> ini BUKAN proxy
        const srv = (head.match(/^server:\s*(.+)$/im) || [])[1] || "";
        if (/cloudflare|nginx|envoy|awselb|akamai|alibaba/i.test(srv) ||
            /cloudflare/i.test(head)) {
          done({ ok: false, code, ms: Date.now() - started, err: "cdn:" + srv.trim().split(/\s/)[0] });
        } else {
          done({ ok: false, code, ms: Date.now() - started, err: `http-${code}` });
        }
      } else {
        done({ ok: false, code: 0, ms: Date.now() - started, err: "bad-status" });
      }
    });

    socket.once("timeout", () => done({ ok: false, code: null, ms: null, err: "tls-connect-timeout" }));
    socket.once("error", (e) => done({ ok: false, code: null, ms: null, err: e.code || e.message }));
    socket.once("close", () => done({ ok: false, code: null, ms: null, err: "closed" }));
  });
}

/**
 * Worker-compatible check.
 *
 * Worker VPN fallback path menulis RAW bytes ke proxy (tanpa HTTP CONNECT,
 * tanpa SOCKS handshake). Jadi proxy yang cocok harus:
 *   1. terima koneksi TCP
 *   2. (kalau port 443/8443) TLS handshake dulu, karena worker pakai secureTransport:"on"
 *   3. forward bytes mentah ke tujuan
 *
 * Cara cek: kirim TLS ClientHello untuk 1.1.1.1:443. Kalau dapat ServerHello
 * balik, proxy benar-benar meneruskan traffic -> bisa dipakai worker.
 */
/**
 * Worker-compatible check.
 *
 * Worker VPN (versi baru) fallback lewat proxy memakai handshake proxy:
 *   - port 1080/9050/1081/9051 -> SOCKS5
 *   - selain itu                 -> HTTP CONNECT
 * Jadi proxy yang cocok = proxy HTTP/SOCKS5 yang benar-benar bisa forward.
 *
 * Test: CONNECT ke 1.1.1.1:443, expect 200 (HTTP) / rep 0x00 (SOCKS5).
 */
export function workerCompatCheck(ip, port, timeout = CONFIG.totalTimeout) {
  const p = Number(port);
  const isSocks = [1080, 9050, 1081, 9051].includes(p);
  return isSocks
    ? socks5Check(ip, port, "1.1.1.1", 443, timeout)
    : httpConnectCheck(ip, port, "1.1.1.1", 443, timeout);
}
export async function checkOne(ip, port, { protocol = "http", deep = true } = {}) {
  const tcp = await tcpCheck(ip, port);
  if (!tcp.ok) {
    return {
      ip, port: String(port), protocol,
      is_active: false, ping: null, check_ok: false, check_stage: "tcp", err: tcp.err,
    };
  }

  if (!deep) {
    return {
      ip, port: String(port), protocol,
      is_active: true, ping: tcp.ms, check_ok: true, check_stage: "tcp", err: null,
    };
  }

  let res;
  if (protocol === "tls") {
    // Mode worker: TLS ke proxy + CONNECT lewat TLS
    res = await tlsProxyCheck(ip, port);
  } else if (protocol === "socks5") {
    res = await socks5Check(ip, port);
  } else if (protocol === "socks4") {
    res = await socks4Check(ip, port);
  } else {
    res = await httpConnectCheck(ip, port);
  }

  if (!res.ok) {
    return {
      ip, port: String(port), protocol,
      is_active: false, ping: tcp.ms, check_ok: false,
      check_stage: protocol, err: res.err,
    };
  }

  // ping = latency ke proxy itu sendiri (relevan untuk tunnel).
  // handshake_ms = waktu full handshake (lebih besar, buat info).
  return {
    ip, port: String(port), protocol,
    is_active: true,
    ping: tcp.ms,
    handshake_ms: res.ms ?? null,
    check_ok: true,
    check_stage: protocol === "http" && res.err === "auth-required" ? "http-auth" : protocol,
    err: res.err === "auth-required" ? null : res.err,
  };
}

// Proxy checker mandiri — tanpa API pihak ketiga.
//
// PRINSIP: "port terbuka" BUKAN berarti proxy.
//
// Banyak IP di list gratis cuma web server / CDN edge yang kebetulan punya
// port terbuka. Dulu checker menandai proxy hidup hanya dari TCP connect,
// hasilnya ratusan "proxy aktif" yang ternyata bukan proxy sama sekali —
// worker VPN gagal connect, user dapat proxy mati.
//
// Sekarang proxy dianggap hidup HANYA kalau dia berhasil meneruskan traffic
// ke tujuan lewat handshake protokol yang benar (HTTP CONNECT / SOCKS4 /
// SOCKS5). Protokol dideteksi dari RESPON, bukan dari nomor port, karena
// proxy SOCKS5 sering muncul di 443 dan proxy HTTP sering di 1080.

import net from "node:net";
import tls from "node:tls";
import { CONFIG } from "./config.js";

/** TCP connect test — bukti port terbuka, BUKAN bukti proxy. */
export function tcpCheck(ip, port, timeout = CONFIG.connectTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let socket;
    try {
      socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    } catch (e) {
      return resolve({ ok: false, ms: null, err: e.code || e.message });
    }
    socket.setTimeout(timeout);
    const done = (ok, err = null) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, ms: ok ? Date.now() - started : null, err });
    };
    socket.once("connect", () => done(true, null));
    socket.once("timeout", () => done(false, "connect-timeout"));
    socket.once("error", (e) => done(false, e.code || e.message));
  });
}

/**
 * HTTP CONNECT test — proxy HTTP yang benar menjawab status line HTTP.
 * 200 = meneruskan. 407/403 = hidup tapi butuh auth.
 * Respons non-HTTP = bukan proxy HTTP.
 */
export function httpConnectCheck(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let buf = "";
    let socket;
    try {
      socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    } catch (e) {
      return resolve({ ok: false, code: null, ms: null, err: e.code || e.message });
    }
    socket.setTimeout(timeout);
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };
    socket.once("connect", () => {
      socket.write(
        "CONNECT " + targetHost + ":" + targetPort + " HTTP/1.1\r\n" +
        "Host: " + targetHost + ":" + targetPort + "\r\n" +
        "User-Agent: Mozilla/5.0\r\n" +
        "Proxy-Connection: keep-alive\r\n\r\n"
      );
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const idx = buf.indexOf("\r\n");
      if (idx === -1) {
        if (buf.length > 1024) done({ ok: false, code: null, ms: Date.now() - started, err: "no-header" });
        return;
      }
      const statusLine = buf.slice(0, idx);
      const m = statusLine.match(/^HTTP\/1\.[01]\s+(\d{3})/);
      if (!m) {
        done({ ok: false, code: null, ms: Date.now() - started, err: "not-http" });
        return;
      }
      const code = Number(m[1]);
      if (code === 200) {
        done({ ok: true, code, ms: Date.now() - started, err: null, proto: "http" });
      } else if (code === 407 || code === 403) {
        done({ ok: true, code, ms: Date.now() - started, err: "auth-required", proto: "http" });
      } else {
        done({ ok: false, code, ms: Date.now() - started, err: "http-" + code });
      }
    });
    socket.once("timeout", () => done({ ok: false, code: null, ms: null, err: "http-timeout" }));
    socket.once("error", (e) => done({ ok: false, code: null, ms: null, err: e.code || e.message }));
    socket.once("close", () => done({ ok: false, code: null, ms: null, err: "closed" }));
  });
}

/** SOCKS5 test: greeting (05 01 00) lalu CONNECT. */
export function socks5Check(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let stage = "greeting";
    let socket;
    try {
      socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    } catch (e) {
      return resolve({ ok: false, code: null, ms: null, err: e.code || e.message });
    }
    socket.setTimeout(timeout);
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };
    socket.once("connect", () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
    socket.on("data", (d) => {
      if (stage === "greeting") {
        if (d[0] !== 0x05) return done({ ok: false, code: null, ms: null, err: "not-socks5" });
        if (d[1] === 0x00) {
          stage = "connect";
          const b = Buffer.alloc(10);
          b[0] = 0x05; b[1] = 0x01; b[2] = 0x00; b[3] = 0x01;
          b.writeUInt32BE(0x01010101, 4);
          b.writeUInt16BE(targetPort, 8);
          socket.write(b);
        } else if (d[1] === 0xff) {
          done({ ok: false, code: null, ms: null, err: "socks5-no-method" });
        } else {
          done({ ok: true, code: null, ms: Date.now() - started, err: "auth-required", proto: "socks5" });
        }
        return;
      }
      if (d.length < 2) return;
      if (d[1] === 0x00) {
        done({ ok: true, code: 0, ms: Date.now() - started, err: null, proto: "socks5" });
      } else {
        done({ ok: false, code: d[1], ms: null, err: "socks5-rep-" + d[1] });
      }
    });
    socket.once("timeout", () => done({ ok: false, code: null, ms: null, err: "socks5-" + stage + "-timeout" }));
    socket.once("error", (e) => done({ ok: false, code: null, ms: null, err: e.code || e.message }));
    socket.once("close", () => done({ ok: false, code: null, ms: null, err: "closed" }));
  });
}

/** SOCKS4 test: request 04 01 + port + IP, expect 0x5A. */
export function socks4Check(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let socket;
    try {
      socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    } catch (e) {
      return resolve({ ok: false, code: null, ms: null, err: e.code || e.message });
    }
    socket.setTimeout(timeout);
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };
    socket.once("connect", () => {
      const b = Buffer.alloc(9);
      b[0] = 0x04; b[1] = 0x01;
      b.writeUInt16BE(targetPort, 2);
      b.writeUInt32BE(0x01010101, 4);
      socket.write(b);
    });
    socket.on("data", (d) => {
      if (d.length < 2) return;
      if (d[1] === 0x5a) {
        done({ ok: true, code: 0x5a, ms: Date.now() - started, err: null, proto: "socks4" });
      } else {
        done({ ok: false, code: d[1], ms: null, err: "socks4-rep-" + d[1] });
      }
    });
    socket.once("timeout", () => done({ ok: false, code: null, ms: null, err: "socks4-timeout" }));
    socket.once("error", (e) => done({ ok: false, code: null, ms: null, err: e.code || e.message }));
    socket.once("close", () => done({ ok: false, code: null, ms: null, err: "closed" }));
  });
}

/**
 * Deteksi + verifikasi proxy: coba SOCKS5, SOCKS4, HTTP CONNECT.
 * Berhenti pada protokol pertama yang berhasil.
 */
export async function detectProxy(ip, port, timeout = CONFIG.httpTimeout) {
  const tried = [];
  const candidates = [
    ["socks5", () => socks5Check(ip, port, "1.1.1.1", 443, timeout)],
    ["socks4", () => socks4Check(ip, port, "1.1.1.1", 443, timeout)],
    ["http", () => httpConnectCheck(ip, port, "1.1.1.1", 443, timeout)],
  ];
  for (const [name, fn] of candidates) {
    const r = await fn();
    tried.push(name + ":" + (r.err || "ok"));
    if (r.ok) return { ok: true, proto: name, ms: r.ms, err: r.err, tried };
  }
  return { ok: false, proto: null, ms: null, err: tried.join(" | "), tried };
}

/** Worker-compatible check: proxy layak dipakai worker kalau handshake berhasil. */
export async function workerCompatCheck(ip, port, timeout = CONFIG.httpTimeout) {
  const r = await detectProxy(ip, port, timeout);
  return { ok: r.ok, ms: r.ms, err: r.err, proto: r.proto, stage: r.proto || "fail" };
}

/** Cek satu proxy. */
export async function checkOne(ip, port, { protocol = null, deep = true } = {}) {
  const tcp = await tcpCheck(ip, port);
  if (!tcp.ok) {
    return { ip, port: String(port), protocol: protocol || "unknown",
      is_active: false, ping: null, check_ok: false, check_stage: "tcp", err: tcp.err };
  }
  if (!deep) {
    // shallow = hanya bukti port hidup. TIDAK boleh menandai is_active.
    return { ip, port: String(port), protocol: protocol || "unknown",
      is_active: false, ping: tcp.ms, check_ok: false, check_stage: "tcp-only",
      err: "shallow-tcp-only" };
  }
  const det = await detectProxy(ip, port);
  if (!det.ok) {
    return { ip, port: String(port), protocol: protocol || "unknown",
      is_active: false, ping: tcp.ms, check_ok: false, check_stage: "handshake", err: det.err };
  }
  return { ip, port: String(port), protocol: det.proto,
    is_active: true, ping: tcp.ms, check_ok: true, check_stage: det.proto, err: det.err || null };
}

/** Buka tunnel lewat SOCKS5 / HTTP CONNECT, kembalikan socket siap pakai. */
export function openTunnel(ip, port, targetHost, targetPort, proto, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    let socket;
    try {
      socket = net.connect({ host: ip, port: Number(port), noDelay: true });
    } catch (e) {
      return resolve({ ok: false, socket: null, err: e.code || e.message });
    }
    socket.setTimeout(timeout);
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok: false, socket: null, err });
    };
    const pass = () => {
      if (settled) return;
      settled = true;
      socket.setTimeout(0);
      resolve({ ok: true, socket, err: null });
    };
    if (proto === "socks5") {
      let stage = "greeting";
      socket.once("connect", () => socket.write(Buffer.from([0x05, 0x01, 0x00])));
      socket.on("data", (d) => {
        if (stage === "greeting") {
          if (d[0] !== 0x05) return fail("not-socks5");
          if (d[1] !== 0x00) return fail("socks5-auth");
          stage = "connect";
          const nameBuf = Buffer.from(targetHost, "utf8");
          const req = Buffer.alloc(7 + nameBuf.length);
          req[0] = 0x05; req[1] = 0x01; req[2] = 0x00; req[3] = 0x03;
          req[4] = nameBuf.length;
          nameBuf.copy(req, 5);
          req.writeUInt16BE(targetPort, 5 + nameBuf.length);
          socket.write(req);
          return;
        }
        if (d.length >= 2 && d[1] === 0x00) return pass();
        fail("socks5-rep-" + d[1]);
      });
    } else {
      socket.once("connect", () => {
        socket.write("CONNECT " + targetHost + ":" + targetPort + " HTTP/1.1\r\n" +
                     "Host: " + targetHost + ":" + targetPort + "\r\n\r\n");
      });
      let buf = "";
      const onData = (d) => {
        buf += d.toString("latin1");
        const i = buf.indexOf("\r\n\r\n");
        if (i === -1) {
          if (buf.length > 1024) fail("no-header");
          return;
        }
        const code = Number((buf.match(/^HTTP\/1\.[01]\s+(\d{3})/) || [])[1] || 0);
        if (code !== 200) return fail("http-" + code);
        const rest = Buffer.from(buf.slice(i + 4), "latin1");
        socket.removeListener("data", onData);
        if (rest.length) socket.unshift(rest);
        pass();
      };
      socket.on("data", onData);
    }
    socket.once("timeout", () => fail(proto + "-timeout"));
    socket.once("error", (e) => fail(e.code || e.message));
  });
}

/**
 * Verifikasi internet lewat proxy: buka tunnel ke target TLS, tunggu
 * ServerHello. Bukti paling kuat bahwa proxy bisa dipakai browsing.
 */
export function internetCheck(ip, port, proto, targetHost = "cloudflare.com", timeout = CONFIG.totalTimeout) {
  return new Promise(async (resolve) => {
    const t0 = Date.now();
    const t = await openTunnel(ip, port, targetHost, 443, proto, timeout);
    if (!t.ok) return resolve({ ok: false, ms: null, err: t.err });
    const sock = t.socket;
    let settled = false;
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { sock.destroy(); } catch {}
      resolve(result);
    };
    const timer = setTimeout(() => done({ ok: false, ms: null, err: "tls-timeout" }), timeout);
    const tlsSock = tls.connect({ socket: sock, servername: targetHost, rejectUnauthorized: false });
    tlsSock.once("secureConnect", () => {
      clearTimeout(timer);
      done({ ok: true, ms: Date.now() - t0, err: null, target: targetHost });
    });
    tlsSock.once("error", (e) => {
      clearTimeout(timer);
      done({ ok: false, ms: null, err: e.code || e.message });
    });
  });
}

/** TLS handshake check (endpoint TLS biasa, bukan proxy). */
export function tlsCheck(ip, port, timeout = CONFIG.connectTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let socket;
    try {
      socket = tls.connect({
        host: ip, port: Number(port), rejectUnauthorized: false,
        ALPNProtocols: ["http/1.1"],
      });
    } catch (e) {
      return resolve({ ok: false, ms: null, err: e.code || e.message });
    }
    const done = (ok, err = null) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve({ ok, ms: ok ? Date.now() - started : null, err });
    };
    socket.setTimeout(timeout);
    socket.once("secureConnect", () => done(true, null));
    socket.once("timeout", () => done(false, "tls-timeout"));
    socket.once("error", (e) => done(false, e.code || e.message));
  });
}

/** TLS + HTTP CONNECT (proxy yang listen di port TLS, jarang). */
export function tlsProxyCheck(ip, port, targetHost = "1.1.1.1", targetPort = 443, timeout = CONFIG.httpTimeout) {
  return new Promise((resolve) => {
    const started = Date.now();
    let settled = false;
    let buf = "";
    let socket;
    try {
      socket = tls.connect({ host: ip, port: Number(port), rejectUnauthorized: false });
    } catch (e) {
      return resolve({ ok: false, code: null, ms: null, err: e.code || e.message });
    }
    socket.setTimeout(timeout);
    const done = (result) => {
      if (settled) return;
      settled = true;
      try { socket.destroy(); } catch {}
      resolve(result);
    };
    socket.once("secureConnect", () => {
      socket.write("CONNECT " + targetHost + ":" + targetPort + " HTTP/1.1\r\n" +
                   "Host: " + targetHost + ":" + targetPort + "\r\n\r\n");
    });
    socket.on("data", (chunk) => {
      buf += chunk.toString("latin1");
      const idx = buf.indexOf("\r\n");
      if (idx === -1) {
        if (buf.length > 1024) done({ ok: false, code: null, ms: Date.now() - started, err: "no-header" });
        return;
      }
      const m = buf.slice(0, idx).match(/^HTTP\/1\.[01]\s+(\d{3})/);
      const code = m ? Number(m[1]) : 0;
      const headEnd = buf.indexOf("\r\n\r\n");
      const head = (headEnd === -1 ? buf : buf.slice(0, headEnd)).toString("latin1");
      if (code === 200) {
        done({ ok: true, code, ms: Date.now() - started, err: null });
      } else if (code === 403 || code === 407) {
        done({ ok: true, code, ms: Date.now() - started, err: "auth-required" });
      } else if (code > 0) {
        const srv = (head.match(/^server:\s*(.+)$/im) || [])[1] || "";
        if (/cloudflare|nginx|envoy|awselb|akamai|alibaba/i.test(srv) || /cloudflare/i.test(head)) {
          done({ ok: false, code, ms: Date.now() - started, err: "cdn:" + srv.trim().split(/\s/)[0] });
        } else {
          done({ ok: false, code, ms: Date.now() - started, err: "http-" + code });
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

#!/usr/bin/env node
/**
 * Test end-to-end worker VPN: WebSocket upgrade + VLESS header.
 *
 * Pakai: node test/ws-vless.js <worker-host> <proxy-ip> <proxy-port> [uuid]
 *
 * Cek:
 * 1. HTTP 101 (WebSocket upgrade)
 * 2. Worker bisa parse VLESS header (tidak 500 / 1101)
 * 3. Data mengalir (opsional)
 */

import net from "node:net";
import crypto from "node:crypto";

const host = process.argv[2];
const proxyIP = process.argv[3];
const proxyPort = process.argv[4] || "1080";
const uuid = process.argv[5] || crypto.randomUUID();

if (!host || !proxyIP) {
  console.error("Usage: node ws-vless.js <worker-host> <proxy-ip> <proxy-port> [uuid]");
  process.exit(1);
}

console.log(`worker : ${host}`);
console.log(`proxy  : ${proxyIP}:${proxyPort}`);
console.log(`uuid   : ${uuid}\n`);

// Build VLESS header: version(1) uuid(16) addons(0) cmd(1) port(2) addrType(1) addr(4)
function buildVlessHeader(targetHost, targetPort) {
  const uuidHex = uuid.replace(/-/g, "");
  const uuidBytes = Buffer.from(uuidHex, "hex");
  const ipParts = targetHost.split(".").map(Number);
  const addr = Buffer.from(ipParts);

  const header = Buffer.alloc(24);
  header[0] = 0x00;                    // version
  uuidBytes.copy(header, 1);          // uuid
  header[17] = 0x00;                  // addon length
  header[18] = 0x01;                  // cmd = TCP
  header.writeUInt16BE(targetPort, 19); // port
  header[21] = 0x01;                  // atyp = IPv4
  addr.copy(header, 22);

  // payload: minimal TLS ClientHello supaya tunnel benar-benar terjadi
  const payload = Buffer.from([
    0x16, 0x03, 0x01, 0x00, 0x50, 0x01, 0x00, 0x00, 0x4c,
    0x03, 0x03, 0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07,
    0x08, 0x09, 0x0a, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
    0x00, 0x00, 0x00, 0x00,
    0x00, 0x17, 0x00, 0x00, 0x00, 0x14, 0x63, 0x6c, 0x6f, 0x75,
    0x64, 0x66, 0x6c, 0x61, 0x72, 0x65, 0x2d, 0x64, 0x6e, 0x73,
    0x2e, 0x63, 0x6f, 0x6d, 0x00, 0x00, 0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00,
  ]);

  return Buffer.concat([header, payload]);
}

const wsKey = crypto.randomBytes(16).toString("base64");
const path = `/${proxyIP}-${proxyPort}`;

const sock = net.connect({ host, port: 443 });
let buf = Buffer.alloc(0);
let upgraded = false;
let gotData = false;

const timer = setTimeout(() => {
  console.log(`\n⏱ timeout 20s`);
  console.log(`   upgraded=${upgraded}  data=${gotData}`);
  sock.destroy();
  process.exit(upgraded ? 0 : 1);
}, 20000);

sock.on("connect", () => {
  const req =
    `GET ${path} HTTP/1.1\r\n` +
    `Host: ${host}\r\n` +
    `Upgrade: websocket\r\n` +
    `Connection: Upgrade\r\n` +
    `Sec-WebSocket-Key: ${wsKey}\r\n` +
    `Sec-WebSocket-Version: 13\r\n\r\n`;
  sock.write(req);
});

sock.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);

  if (!upgraded) {
    const idx = buf.indexOf("\r\n\r\n");
    if (idx === -1) return;
    const head = buf.slice(0, idx).toString("latin1");
    console.log("--- HTTP response ---");
    console.log(head.split("\r\n").slice(0, 3).join("\n"));
    buf = buf.slice(idx + 4);

    if (!/101/.test(head)) {
      console.log("\n❌ WebSocket upgrade GAGAL");
      clearTimeout(timer);
      sock.destroy();
      process.exit(1);
    }
    upgraded = true;
    console.log("\n✅ 101 Switching Protocols");

    // Kirim VLESS header + payload
    const vless = buildVlessHeader("1.1.1.1", 443);
    const mask = crypto.randomBytes(4);
    const masked = Buffer.from(vless.map((b, i) => b ^ mask[i % 4]));
    const frame = Buffer.concat([
      Buffer.from([0x82, 0x80 | vless.length]), // FIN + binary, MASK
      mask,
      masked,
    ]);
    sock.write(frame);
    console.log(`→ VLESS header dikirim (${vless.length} bytes), tunnel ke 1.1.1.1:443 via proxy ${proxyIP}:${proxyPort}`);
  }

  if (upgraded && buf.length > 0) {
    gotData = true;
    // parse WS frame minimal: byte0 opcode, byte1 len
    const b0 = buf[0], b1 = buf[1];
    const opcode = b0 & 0x0f;
    const masked = b1 & 0x80;
    let len = b1 & 0x7f;
    let off = 2;
    if (len === 126) { len = buf.readUInt16BE(2); off = 4; }
    else if (len === 127) { len = Number(buf.readBigUInt64BE(2)); off = 10; }
    const payload = buf.slice(off, off + len);

    if (opcode === 0x02 && payload.length >= 5) {
      console.log(`\n📦 WS binary frame ${payload.length} bytes`);
      console.log(`   5 bytes awal: ${payload.slice(0, 5).toString("hex")}`);
      if (payload[0] === 0x16) {
        console.log("   → TLS ServerHello (0x16) = TUNNEL BERHASIL, proxy meneruskan data");
      } else {
        console.log(`   → payload bukan TLS (${payload[0].toString(16)})`);
      }
    } else if (opcode === 0x08) {
      console.log("\n❌ WebSocket CLOSE frame (worker tutup koneksi)");
    } else {
      console.log(`\n📦 WS opcode=0x${opcode.toString(16)} len=${payload.length}`);
    }
    clearTimeout(timer);
    sock.destroy();
    process.exit(gotData ? 0 : 1);
  }
});

sock.on("error", (e) => {
  console.log(`\n❌ Error: ${e.code || e.message}`);
  clearTimeout(timer);
  process.exit(1);
});

sock.on("close", () => {
  if (!upgraded) {
    console.log("\n❌ Koneksi ditutup sebelum upgrade");
    clearTimeout(timer);
    process.exit(1);
  }
});

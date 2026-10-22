
const tls = require("tls");
const crypto = require("crypto");
const net = require("net");
const host = process.argv[2], proxyIP = process.argv[3], proxyPort = process.argv[4];
const uuid = crypto.randomUUID();

// --- Generate a REAL TLS ClientHello (capture from a real tls handshake) ---
function captureClientHello() {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      sock.once("data", (d) => { srv.close(); resolve(d); sock.destroy(); });
      setTimeout(() => { srv.close(); resolve(Buffer.alloc(0)); }, 3000);
    });
    srv.listen(0, "127.0.0.1", () => {
      const port = srv.address().port;
      const c = tls.connect({ host: "127.0.0.1", port, servername: "cloudflare-dns.com", rejectUnauthorized: false });
      c.on("error", () => {});
    });
  });
}

function buildVless(th, tp, clientHello) {
  const ub = Buffer.from(uuid.replace(/-/g,""), "hex");
  const h = Buffer.alloc(24);
  h[0]=0x00; ub.copy(h,1); h[17]=0x00; h[18]=0x01;
  h.writeUInt16BE(tp,19); h[21]=0x01;
  Buffer.from(th.split(".").map(Number)).copy(h,22);
  return Buffer.concat([h, clientHello]);
}

function maskFrame(payload) {
  const mask = crypto.randomBytes(4);
  const masked = Buffer.from(payload.map((b,i)=>b ^ mask[i%4]));
  const len = payload.length;
  let header;
  if (len < 126) header = Buffer.from([0x82, 0x80 | len]);
  else if (len < 65536) { header = Buffer.alloc(4); header[0]=0x82; header[1]=0x80|126; header.writeUInt16BE(len,2); }
  else { header = Buffer.alloc(10); header[0]=0x82; header[1]=0x80|127; header.writeBigUInt64BE(BigInt(len),2); }
  return Buffer.concat([header, mask, masked]);
}

(async () => {
  const hello = await captureClientHello();
  console.log("ClientHello asli:", hello.length, "bytes");

  const key = crypto.randomBytes(16).toString("base64");
  const s = tls.connect({host:host, port:443, servername:host, rejectUnauthorized:false}, () => {
    s.write("GET /"+proxyIP+"-"+proxyPort+" HTTP/1.1\r\nHost: "+host+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: "+key+"\r\nSec-WebSocket-Version: 13\r\n\r\n");
  });
  let buf = Buffer.alloc(0), up=false;
  s.on("data", d => {
    buf = Buffer.concat([buf, d]);
    if (!up) {
      const t = buf.toString("latin1"), i = t.indexOf("\r\n\r\n");
      if (i === -1) return;
      console.log("HTTP:", t.split("\r\n")[0]);
      if (!/101/.test(t)) { console.log("FAIL:", t.slice(0,200)); s.destroy(); process.exit(1); }
      up = true; buf = buf.slice(i+4);
      s.write(maskFrame(buildVless("1.1.1.1", 443, hello)));
      console.log("VLESS + ClientHello dikirim");
    }
    if (up && buf.length) {
      const b1=buf[1], op=buf[0]&0x0f;
      let len=b1&0x7f, off=2;
      if (len===126){len=buf.readUInt16BE(2);off=4;} else if (len===127){len=Number(buf.readBigUInt64BE(2));off=10;}
      const pay=buf.slice(off,off+len);
      if (op===0x8) {
        const code = pay.length>=2 ? pay.readUInt16BE(0) : 0;
        console.log("CLOSE code="+code+" reason="+JSON.stringify(pay.slice(2).toString('utf8')));
      } else {
        console.log("frame op=0x"+op.toString(16)+" len="+len+" hex="+pay.slice(0,10).toString("hex"));
        if (pay[0]===0x16) console.log("  => TLS ServerHello! TUNNEL BERHASIL, proxy meneruskan data");
      }
      s.destroy(); process.exit(0);
    }
  });
  s.on("error", e=>{console.log("ERR",e.code,e.message); process.exit(1);});
  setTimeout(()=>{console.log("TIMEOUT up="+up); s.destroy(); process.exit(1);}, 25000);
})();

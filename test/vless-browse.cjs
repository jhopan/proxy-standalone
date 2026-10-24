
const tls = require("tls");
const crypto = require("crypto");
const net = require("net");
const host = process.argv[2], proxyIP = process.argv[3], proxyPort = process.argv[4];
const target = process.argv[5] || "cloudflare.com";
const targetPort = Number(process.argv[6] || 443);
const uuid = crypto.randomUUID();

// ClientHello asli untuk SNI = target
function captureHello(sni) {
  return new Promise((resolve) => {
    const srv = net.createServer((sock) => {
      sock.once("data", (d) => { srv.close(); resolve(d); sock.destroy(); });
      setTimeout(() => { srv.close(); resolve(Buffer.alloc(0)); }, 3000);
    });
    srv.listen(0, "127.0.0.1", () => {
      const c = tls.connect({ host: "127.0.0.1", port: srv.address().port, servername: sni, rejectUnauthorized: false });
      c.on("error", () => {});
    });
  });
}

// VLESS header dengan atyp=2 (domain name)
function vlessDomain(sni, port) {
  const ub = Buffer.from(uuid.replace(/-/g,""), "hex");
  const nameBuf = Buffer.from(sni, "utf8");
  const h = Buffer.alloc(19 + nameBuf.length + 2);
  h[0] = 0x00;                        // version
  ub.copy(h, 1);                      // uuid
  h[17] = 0x00;                       // opt len
  h[18] = 0x01;                       // cmd TCP
  h.writeUInt16BE(port, 19);          // port
  h[21] = 0x02;                       // atyp = domain
  h[22] = nameBuf.length;             // domain length
  nameBuf.copy(h, 23);                // domain
  return h;
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
  const hello = await captureHello(target);
  const key = crypto.randomBytes(16).toString("base64");
  const t0 = Date.now();
  const s = tls.connect({host:host, port:443, servername:host, rejectUnauthorized:false}, () => {
    s.write("GET /"+proxyIP+"-"+proxyPort+" HTTP/1.1\r\nHost: "+host+"\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Key: "+key+"\r\nSec-WebSocket-Version: 13\r\n\r\n");
  });
  let buf = Buffer.alloc(0), up=false, sent=false;
  s.on("data", d => {
    buf = Buffer.concat([buf, d]);
    if (!up) {
      const t = buf.toString("latin1"), i = t.indexOf("\r\n\r\n");
      if (i === -1) return;
      if (!/101/.test(t)) { console.log("FAIL upgrade:", t.split("\r\n")[0]); s.destroy(); process.exit(1); }
      up = true; buf = buf.slice(i+4);
      const payload = Buffer.concat([vlessDomain(target, targetPort), hello]);
      s.write(maskFrame(payload));
      sent = true;
      console.log("→ VLESS atyp=domain sni="+target+" :"+targetPort+" ("+payload.length+"B)");
    }
    if (up && buf.length) {
      const b1=buf[1], op=buf[0]&0x0f;
      let len=b1&0x7f, off=2;
      if (len===126){len=buf.readUInt16BE(2);off=4;} else if(len===127){len=Number(buf.readBigUInt64BE(2));off=10;}
      const pay=buf.slice(off,off+len);
      const ms = Date.now()-t0;
      if (op===0x8) {
        const c = pay.length>=2?pay.readUInt16BE(0):0;
        console.log("CLOSE code="+c+" reason="+JSON.stringify(pay.slice(2).toString('utf8')));
      } else {
        // VLESS response: 2 byte header dulu, lalu payload
        let data = pay;
        if (data.length >= 2) data = data.slice(2);
        const isTLS = data.length >= 2 && data[0]===0x16 && data[1]===0x03;
        console.log("frame len="+len+" total="+ms+"ms");
        console.log("  payload awal:", data.slice(0,8).toString("hex"));
        console.log(isTLS ? "  ✅ TLS ServerHello — INTERNET BERJALAN" : "  ❌ bukan TLS");
      }
      s.destroy(); process.exit(0);
    }
  });
  s.on("error", e=>{console.log("ERR",e.code,e.message); process.exit(1);});
  setTimeout(()=>{console.log("TIMEOUT up="+up+" sent="+sent); s.destroy(); process.exit(1);}, 25000);
})();

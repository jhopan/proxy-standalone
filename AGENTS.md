# AGENTS.md — Proxy Standalone

Scraper + checker proxy gratis. Node.js, **nol dependency** (cuma built-in), **nihil API pihak ketiga** untuk pengecekan proxy.

## Perintah

```bash
node cli.js                                          # menu interaktif
node scraping/scrape.js --harvest --top 200          # scrape + cek + simpan
node scraping/scrape.js --limit 4000 --dry-run       # cek tanpa tulis DB
node scraping/scrape.js --list                      # status sumber
node Checker/check.js --stale 6                      # tandai proxy basi jadi mati
node Checker/check.js --limit 500                    # cek status proxy di DB
node setup/setup-db.js                               # cetak SQL tambah kolom
node test/source-bench.js 60                         # benchmark hit-rate per sumber
node test/worker-compat.js 200                       # cek proxy yang bisa dipakai worker
```

## Struktur

```
core/
  checker.js     # TCP + HTTP CONNECT + SOCKS4/5 + workerCompatCheck
  sources.js     # 19 sumber list + filter IP CDN + metadata yield
  db.js          # client Supabase REST (fetch), pagination, retry, column detect
  geo.js         # geolokasi batch (ip-api batch, fallback ipwho.is)
  pool.js        # limiter konkurensi
  config.js      # loader .env
Checker/check.js # CLI update status proxy di DB
scraping/scrape.js # CLI scrape -> cek -> geo -> simpan
setup/setup-db.js  # cetak SQL
test/            # benchmark + perbandingan protokol
```

## Aturan wajib

1. **Jangan** tambah dependency. Semua pakai Node built-in (`node:net`, `node:tls`, `fetch`).
2. **Jangan** pakai API pihak ketiga untuk cek proxy. Cuma DB (Supabase) + geolokasi.
3. **Port terbuka BUKAN proxy.** Deteksi protokol dari RESPON (`detectProxy`), bukan dari nomor port. Proxy SOCKS5 sering di 443, proxy HTTP sering di 1080.
   - `detectProxy(ip, port)` coba SOCKS5 -> SOCKS4 -> HTTP CONNECT, berhenti di yang berhasil.
   - `workerCompatCheck` = wrapper `detectProxy`.
   - `internetCheck(ip, port, proto)` bukti paling kuat: buka tunnel TLS ke cloudflare.com, tunggu ServerHello.
   - `--shallow` hanya ukur port, **TIDAK boleh** menandai `is_active`.
4. Ambang default: `pingOk` 3000ms, `pingGood` 1000ms. Proxy gratis lambat, jangan filter ketat.
5. `db.js` wajib filter payload by available columns — PostgREST error kalau kirim kolom yang belum ada di DB.
6. PostgREST `or=(a.is.null,b.lt.X)` tidak bisa parse → filter waktu di JS, bukan query.
7. `pool()` harus pakai loop `for` untuk spawn worker. `Array.from({length:N}, fn)`hanya 1 worker jalan (fn dipanggil dengan `(undefined, index)`).
8. `tls.connect` **tidak boleh** `servername` = IP address (Node throw). Omit saja.
9. Sebelum simpan: `node --check` semua file yang diubah.

## DB (Supabase)

Tabel `proxy_pool`:
```
id, ip, port, country, org, is_active, protocol, ping, check_ok, check_stage, last_checked
UNIQUE(ip, port)
```

Kolom `protocol`, `check_ok`, `check_stage` belum ada di project `cgflrpjavyotvolnvcnl`. Jalankan `setup-supabase.sql` di Supabase SQL Editor. Script tetap jalan tanpa itu (auto-filter kolom).

`is_active = true` hanya kalau handshake proxy sukses. `last_checked` = kapan dicek (pakai untuk filter freshness).

## Fakta penting (hasil benchmark 21 Okt 2026)

- Mayoritas "proxy" di list gratis = **IP Cloudflare/CDN**, bukan proxy. Balas `HTTP/1.1 400 Bad Request` + `Server: cloudflare`. Checker deteksi dari header `Server:` → label `cdn:<nama>`.
- Proxy gratis **mati dalam hitungan menit**. ALIILAPRO 55% hidup → 20 menit kemudian 0%.
- Yang hidup hampir semua **SOCKS5** (port 1080/9050).
- Yield realistis (checker LAMA, false positive): 0.35% – 1.3%. Sample 4000 → 14.
- Yield realistis (checker BARU, verifikasi handshake): ALIILAPRO **44%** (22/50 probe).
  Sample 450 → 124 hidup → 67 tersimpan. Jauh lebih baik karena proxy palsu tersaring.
- Verifikasi internet: 5/8 proxy tercepat benar-benar bisa buka TLS ke cloudflare.com.
- `--harvest` wajib pakai: cek per sumber urut by yield, probe dulu, early-stop saat target tercapai.

## Verifikasi

```bash
node --check core/*.js Checker/*.js scraping/*.js setup/*.js test/*.js cli.js
node cli.js check
```

Cek hasil nyata di DB:
```bash
node -e "import('./core/db.js').then(async m=>{
  const a=await m.selectAll('proxy_pool','select=id,ip,port,ping,country&is_active=eq.true');
  console.log('AKTIF:',a.data.length); a.data.forEach(x=>console.log(' ',x.ip+':'+x.port,x.country,x.ping+'ms'));
})"
```

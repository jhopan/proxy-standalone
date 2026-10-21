# Proxy Standalone

Tooling mandiri untuk cari dan verifikasi proxy gratis. **Nol dependency** cuma Node.js built-in), **nihil API pihak ketiga** untuk pengecekan proxy.

## Kenapa mandiri?

Checker bawaan project CFVPN Hub sebelumnya pakai API pihak ketiga:

```
https://id1.foolvpn.web.id/api/v1/check?ip=...
```

Endpoint itu sekarang **mati** timeout 8 detik, tidak merespons). Akibatnya status `is_active` di database jadi basi — 2162 proxy ditandai "aktif" padahal `last_checked` sudah 2 bulan lalu. User pun sering dapat proxy mati.

Tool ini mengganti ketergantungan itu: cek proxy langsung lewat **TCP socket** dari Node, plus handshake protokol yang sesuai HTTP CONNECT / SOCKS4 / SOCKS5).

## Struktur

```
Proxy/
├── core/                  # shared, nol dependency
│   ├── config.js          # loader .env + konfigurasi
│   ├── db.js              # client Supabase REST fetch bawaan)
│   ├── checker.js         # TCP + HTTP CONNECT + SOCKS4/5 + worker-compat
│   ├── geo.js             # geolokasi country/ISP batch)
│   ├── pool.js            # limiter konkurensi
│   └── sources.js         # daftar list proxy gratis + filter IP CDN
├── Checker/
│   └── check.js           # CLI: cek status proxy di DB
├── scraping/
│   └── scrape.js          # CLI: scrape -> cek -> geo -> simpan
├── setup/
│   └── setup-db.js        # cetak SQL tambah kolom
├── test/
│   ├── compare.js         # bandingkan TLS / HTTP / SOCKS
│   └── worker-compat.js   # cek proxy yang bisa dipakai worker VPN
├── cli.js                 # menu interaktif
├── run-check.bat          # wrapper untuk Task Scheduler
├── run-scrape.bat         # wrapper untuk Task Scheduler
├── schema.sql             # kolom baru untuk proxy_pool
├── setup-supabase.sql     # SQL siap salin gabungan)
├── package.json
└── .env.example
```

## Menu interaktif

```bash
node cli.js
```

```
1. Scrape proxy baru   cek + simpan ke DB)
2. Cek proxy di DB     update status)
3. Lihat status sumber  cek list tersedia)
4. Test kompatibilitas worker
5. Setup database     tambah kolom)
0. Keluar
```

## Setup

```bash
cd Documents/Project/Proxy
cp .env.example .env
```

Isi `.env`:

```env
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
# WAJIB untuk update status proxy bypass RLS)
SUPABASE_SERVICE_KEY=eyJ...
```

Lalu jalankan `schema.sql` di Supabase SQL Editor tambah kolom `protocol`, `check_ok`, `check_stage` + index).

## Pemakaian

### Scrape proxy baru

```bash
node scraping/scrape.js                      # default: cek 1000, simpan yang hidup
node scraping/scrape.js --limit 5000          # cek 5000 proxy
node scraping/scrape.js --list                # hanya lihat status sumber
node scraping/scrape.js --source speedx-http,jetkai
node scraping/scrape.js --no-check            # simpan semua tanpa cek
node scraping/scrape.js --shallow             # cek TCP saja cepat)
node scraping/scrape.js --no-geo              # lewati geolokasi
node scraping/scrape.js --dry-run             # tidak tulis DB
node scraping/scrape.js --file proxies.txt    # sekalian tulis ke file
```

### Cek proxy yang sudah ada di DB

```bash
node Checker/check.js                  # cek semua
node Checker/check.js --limit 500      # sample 500 acak)
node Checker/check.js --shallow        # TCP only
node Checker/check.js --dead 300       # tandai 300 proxy paling lama dicek sbg mati
node Checker/check.js --dry-run        # tidak tulis DB
```

## Cara kerja checker

Tiga lapis, sesuai cara worker VPN memakai proxy:

| Lapis | Uji | Arti |
|---|---|---|
| 1 | TCP connect ke `ip:port` | port hidup? |
| 2 | Handshake proxy | benar-benar proxy yang bisa forward? |
| 3 | Latency | berapa ms relevan untuk tunnel) |

Handshake per protokol:

- **HTTP** — `CONNECT 1.1.1.1:443 HTTP/1.1`, expect `200`
- **SOCKS5** — greeting `05 01 00`, lalu `CONNECT` ke 1.1.1.1:443, expect rep `0x00`
- **SOCKS4** — request `0x04 0x01` + port + IP + userid, expect `0x5A`

Proxy yang TCP-nya hidup tapi handshake gagal ditandai **mati** `check_ok=false`). Ini yang sebelumnya bikin proxy "aktif tapi mati" lolos ke user.

### Fakta penting soal list proxy gratis

Ditemukan saat pengujian 21 Okt 2026, sample 600 proxy):

```
  hidup              : 8 / 600   1.3%)
  http-400           : 234       <- Cloudflare/CDN, bukan proxy
  http-timeout       : 237
  socks5-timeout     : 11
  auth-required      : 1
```

**Sebagian besar "proxy" di list gratis itu IP Cloudflare/CDN**, bukan proxy sungguhan. They jawab `HTTP/1.1 400 Bad Request` dengan header `Server: cloudflare`. Checker mendeteksi ini lewat header `Server:` dan menandainya `cdn:<nama>`, bukan `http-400`.

Filter IP CDN di `core/sources.js` membuang IP Anycast Cloudflare/Fastly/Google sebelum cek, supaya tidak buang waktu. Sisa yang lolos dideteksi lagi dari respons HTTP.

**Konsekuensi:** rate hitRate proxy gratis yang benar-benar bisa dipakai worker cuma ~1%. Butuh sample besar 4000+) supaya dapat-proxy yang cukup.

Kolom yang ditulis:

| Kolom | Isi |
|---|---|
| `is_active` | true hanya kalau handshake sukses |
| `ping` | latency ke proxy dalam ms |
| `check_ok` | hasil uji forward |
| `check_stage` | `tcp` / `ok` / `http` / `socks5` / `cdn` |
| `last_checked` | waktu cek terakhir |

Kolom `protocol`, `check_ok`, `check_stage` belum ada di Supabase project `cgflrpjavyotvolnvcnl`. Jalankan `node setup/setup-db.js` untuk menampilkan SQL, atau `setup-supabase.sql` langsung. Script otomatis mendeteksi kolom yang ada dan hanya mengirim yang cocok, jadi tetap jalan sebelum SQL dijalankan.

## Sumber list

14 sumber GitHub aktif dicek terakhir 21 Okt 2026, ~29.000 proxy unik):

```
speedx-http  speedx-socks5  monosans-http  monosans-socks5
proxy4parsing-http  proxy4parsing-socks4  mmpx12-http  mmpx12-socks4
zloi-http  zloi-socks4  roosterkid-https  jetkai  clarketm  proxifly
```

Tambah sumber baru: edit `core/sources.js`, tambahkan `{ id, protocol, url, port }`.

## Rasio hidup

Ditemukan saat pengujian 21 Okt 2026):

| Sample | Hidup | Rate | Keterangan |
|--------|-------|------|------------|
| 250 | 5 | 2.0% | acak, tanpa filter CDN |
| 600 | 8 | 1.3% | dengan filter CDN |
| 4000 | 14 | 0.35% | sampel besar,+SOCKS5 dominan |

Semuanya **SOCKS5** port 1080 / 9050). HTTP proxy gratis nyaris tidak ada yang benar-benar bisa forward — majority "proxy" di list itu Cloudflare/CDN edge, bukan proxy.

Untuk jumlah proxy yang layak dipakai, jalankan scrape dengan limit besar:

```bash
node scraping/scrape.js --limit 4000
```

Hasil realistis: **10-20 proxy hidup** per scrape besar. Untuk produksi, jalankan scheduler harian lihat `run-scrape.bat`).

## Pembersihan data basi

Proxy yang di-markup "aktif" tapi belum dicek > 6 jam harus ditandai mati, supaya panel tidak memberi proxy basi ke user:

```bash
node Checker/check.js --stale 6
```

Perintah ini berdiri sendiri tidak lanjut cek proxy).

## Integrasi CFVPN Hub

Checker ini mengisi kolom `proxy_pool` yang dibaca generator CFVPN Hub. Supaya generator hanya memakai proxy yang benar-benar hidup, tambahkan filter ping di query generator:

```js
// sebelum: hanya is_active
supabase.from'proxy_pool').select'*').eq'is_active', true)
// sesudah: hanya is_active + ping bagus + checked segar
supabase.from'proxy_pool').select'*')
  .eq'is_active', true)
  .lt'ping', 800)
  .gt'last_checked', new DateDate.now) - 2 * 3600e3).toISOString))
```

## Author

**jhopanstore**


## Cron Otomatis Windows Task Scheduler)

Supaya proxy selalu fresh, jalankan checker tiap 30 menit:

```bat
:: C:\Users\ACER\Documents\Project\Proxy\run-check.bat
@echo off
cd /d C:\Users\ACER\Documents\Project\Proxy
node Checker\check.js --limit 1200 >> logs\check.log 2>&1
```

Daftarkan lewat Task Scheduler:
- Trigger: every 30 minutes
- Action: `C:\Users\ACER\Documents\Project\Proxy\run-check.bat`
- Start in: `C:\Users\ACER\Documents\Project\Proxy`

Scrape baru minimal 1x sehari proxy gratis cepat mati):

```bat
node scraping\scrape.js --limit 2000 >> logs\scrape.log 2>&1
```

## Integrasi CFVPN Hub lanjutan)

Panel CFVPN Hub sudah di-patch supaya generator hanya memakai proxy yang:
- `is_active = true`
- `last_checked` < 6 jam fresh)
- ping bagus limit 800ms, opsional)

Worker VPN sudah di-patch supaya `prxIP` per-koneksi sebelumnya global, jadi user saling menimpa proxy).

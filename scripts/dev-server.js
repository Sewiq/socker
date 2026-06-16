#!/usr/bin/env node
/* Mini serwer HTTP dla www/.
 *
 * `npm run dev`       → http://localhost:8765
 * `npm run dev:lan`   → bonus: pokaże adres IP, by można było wejść z telefonu w tej samej sieci Wi-Fi
 *
 * Bez zależności (czysty Node) — działa zaraz po `npm install`.
 *
 * UWAGA: AdMob / haptyka / UMP są ukryte za `isNativePlatform()` — w przeglądarce
 * po prostu się nie pokażą. To OK, bo iterujesz tu logikę gry + UI + i18n.
 */
"use strict";

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

const PORT = Number(process.env.PORT) || 8765;
const ROOT = path.resolve(__dirname, "..", "www");
const LAN = process.argv.includes("--lan");

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js":   "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css":  "text/css; charset=utf-8",
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".txt":  "text/plain; charset=utf-8"
};

const server = http.createServer((req, res) => {
  let url = decodeURIComponent(req.url.split("?")[0]);
  if (url === "/") url = "/index.html";
  const filePath = path.join(ROOT, url);

  // bezpieczeństwo: nie dawaj wyjść z www/
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403); res.end("forbidden"); return;
  }

  fs.stat(filePath, (err, st) => {
    if (err || !st.isFile()) {
      res.writeHead(404, { "Content-Type": "text/plain" });
      res.end("404 not found: " + url);
      return;
    }
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      "Content-Type": TYPES[ext] || "application/octet-stream",
      "Cache-Control": "no-store"   // ZAWSZE świeże podczas dev
    });
    fs.createReadStream(filePath).pipe(res);
  });
});

const HOST = LAN ? "0.0.0.0" : "127.0.0.1";
server.listen(PORT, HOST, () => {
  console.log(`\n  ⚽ Piłkarzyki dev server\n`);
  console.log(`  Lokalnie:   http://localhost:${PORT}`);
  if (LAN) {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter(i => i && i.family === "IPv4" && !i.internal)
      .map(i => i.address);
    if (ips.length) {
      ips.forEach(ip => console.log(`  Sieć:       http://${ip}:${PORT}    ← otwórz na telefonie w tej samej Wi-Fi`));
    } else {
      console.log("  Sieć:       brak interfejsów IPv4");
    }
  } else {
    console.log("  (Wejście z telefonu? Odpal: npm run dev:lan)");
  }
  console.log(`\n  Edytuj www/index.html → Ctrl+R w przeglądarce → widzisz zmiany.\n  Stop: Ctrl+C\n`);
});

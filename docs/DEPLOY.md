# Deploy ProStriker na VPS

Pełny plan postawienia produkcyjnego stacka na własnym VPS.

**Stack docelowy:** wszystko pod `prostriker.online` (1 domena, 1 serwer):
- `https://prostriker.online/` — gra (PWA, statyki z Nginx)
- `https://prostriker.online/ws` — multiplayer (WebSocket, Node przez reverse proxy)
- `https://prostriker.online/legal/privacy.html` — polityka prywatności
- `https://prostriker.online/app-ads.txt` — autoryzacja AdMob

---

## Wymagania na VPS

| Komponent | Wersja | Po co |
|---|---|---|
| Debian 12 / Ubuntu 22.04+ | — | system bazowy |
| Docker + Compose plugin | 24+ | uruchomienie `socker-server` |
| Nginx | 1.22+ | reverse proxy + statyki + TLS |
| Certbot | dowolny | Let's Encrypt cert auto-odnawialny |
| Git | 2.30+ | clone repo |

Minimum sprzętowe: **1 vCPU / 1 GB RAM / 10 GB SSD**. To wystarcza na setki równoczesnych pokoi.

---

## Krok 0 — DNS (zanim ruszysz na VPS)

W panelu rejestratora domeny `prostriker.online` ustaw:

```
A     prostriker.online           → <IP_TWOJEGO_VPS>
A     www.prostriker.online       → <IP_TWOJEGO_VPS>
```

Czas propagacji: 5 min – 24h. Sprawdź: `dig prostriker.online +short` na VPS.

---

## Krok 1 — przygotowanie VPS (jednorazowo)

Po `ssh user@vps` jako root (lub przez `sudo`):

```bash
# system update + podstawy
apt update && apt upgrade -y
apt install -y git curl ufw

# firewall
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw --force enable

# Docker (oficjalny skrypt)
curl -fsSL https://get.docker.com | sh
systemctl enable --now docker

# Nginx + Certbot
apt install -y nginx certbot python3-certbot-nginx
systemctl enable --now nginx
```

Sprawdź: `docker --version`, `nginx -v`, `certbot --version`.

---

## Krok 2 — wgranie kodu

```bash
mkdir -p /opt && cd /opt

# Serwer multiplayer
git clone https://github.com/Sewiq/socker-server.git
cd socker-server
cp .env.example .env
nano .env
# Ustaw:
#   PORT=3000
#   BIND_HOST=127.0.0.1                                 (Nginx proxy_pass, nie bezpośrednio)
#   ALLOWED_ORIGINS=https://prostriker.online,https://www.prostriker.online
#   LOG_LEVEL=info
docker compose up -d --build

# sprawdź że serwer wstał
curl http://127.0.0.1:3000/health
# {"ok":true,"rooms":0,"queued":0,"uptimeSec":...}

# Gra (statyki)
cd /opt
git clone https://github.com/Sewiq/socker.git prostriker-web
# nic więcej - Nginx serwuje pliki bezpośrednio z prostriker-web/
```

---

## Krok 3 — Nginx (root domain → gra + /ws → multiplayer)

```bash
nano /etc/nginx/sites-available/prostriker.online
```

Wklej:

```nginx
server {
    listen 80;
    server_name prostriker.online www.prostriker.online;
    # certbot wypełni przekierowanie na HTTPS po krok 4
    return 301 https://prostriker.online$request_uri;
}

# HTTPS (Certbot doda blok lub uzupełni; tu szablon docelowy)
server {
    listen 443 ssl http2;
    server_name www.prostriker.online;
    # ssl_certificate / ssl_certificate_key — wklei Certbot
    return 301 https://prostriker.online$request_uri;
}

server {
    listen 443 ssl http2;
    server_name prostriker.online;

    # ssl_certificate     /etc/letsencrypt/live/prostriker.online/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/prostriker.online/privkey.pem;
    # (wstawi Certbot)

    # ROOT → landing page (index.html w korzeniu repo); gra w /www/
    root /opt/prostriker-web;
    index index.html;

    # WebSocket multiplayer
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
    }

    # Health-check serwera (opcjonalnie publiczne)
    location = /health {
        proxy_pass http://127.0.0.1:3000/health;
    }

    # app-ads.txt - AdMob crawler szuka w root
    location = /app-ads.txt {
        try_files /app-ads.txt =404;
    }

    # Statyki: cache długi dla wersjonowanych assetów, no-cache dla index.html
    # / → landing (index.html), /www/ → gra. Nieznane ścieżki → landing.
    location / {
        try_files $uri $uri/ /index.html;
    }
    location ~* \.(png|jpg|svg|woff2)$ {
        expires 30d;
        add_header Cache-Control "public, immutable";
    }
    location ~* \.(html|js|json)$ {
        expires -1;
        add_header Cache-Control "no-cache, must-revalidate";
    }
}
```

```bash
ln -s /etc/nginx/sites-available/prostriker.online /etc/nginx/sites-enabled/
nginx -t   # walidacja
systemctl reload nginx
```

---

## Krok 4 — HTTPS przez Let's Encrypt

```bash
certbot --nginx -d prostriker.online -d www.prostriker.online
# wybierz: zgoda na ToS, e-mail, redirect HTTP→HTTPS (zalecane: tak)
```

Po sukcesie Certbot dopisuje ścieżki do certów w Nginx, restartuje go i ustawia auto-odnawianie (cron / systemd timer).

Test:
```bash
curl -I https://prostriker.online/
curl https://prostriker.online/health
curl https://prostriker.online/app-ads.txt
```

---

## Krok 5 — aktualizacje produkcji

### Update gry (statyki)
```bash
cd /opt/prostriker-web
git pull origin main
# nginx serwuje pliki on the fly — bez restartu
```

### Update serwera multiplayer
```bash
cd /opt/socker-server
git pull origin main
docker compose up -d --build
# down-time: ~5s (rebuild + restart)
```

### Restart bez deploya
```bash
docker compose restart           # serwer mp
systemctl reload nginx           # statyki + proxy
```

---

## Krok 6 — monitoring (lekki, na start)

### Logi
```bash
docker compose logs -f           # logi serwera mp (na żywo)
tail -f /var/log/nginx/access.log
tail -f /var/log/nginx/error.log
```

### Auto-odnawianie certów (sprawdź)
```bash
systemctl status certbot.timer
certbot renew --dry-run
```

### Healthcheck zewnętrzny (opcjonalnie)
Wskaż UptimeRobot / Better Uptime na `https://prostriker.online/health` (co 5 min).

---

## Anty-DoS (podstawowe)

W `nginx.conf` (lub osobny include):

```nginx
limit_req_zone $binary_remote_addr zone=mp_ws:10m rate=5r/s;
limit_conn_zone $binary_remote_addr zone=mp_conn:10m;

server {
    # …
    location /ws {
        limit_req zone=mp_ws burst=20 nodelay;
        limit_conn mp_conn 10;
        # …reszta jak wyżej
    }
}
```

Serwer ma już własne rate-limity per IP — to dodatkowa warstwa.

---

## Backup (gdy będą dane)

Na razie serwer trzyma pokoje w pamięci — restart = czysto. Backup nie jest potrzebny.
**Wraz z Fazą 3 (turnieje + ranking ELO)** dojdzie Postgres → wtedy dorobimy `docker compose` ze
`pg_dump | aws s3 cp` cron daily.

---

## Checklist deployu (po Krok 1-4)

- [ ] `dig prostriker.online +short` → IP VPS
- [ ] `curl https://prostriker.online/` → otwiera grę
- [ ] `curl https://prostriker.online/health` → `{"ok":true,...}`
- [ ] `curl https://prostriker.online/app-ads.txt` → linijka z pub-ID
- [ ] `curl https://prostriker.online/legal/privacy.html` → polityka
- [ ] Otwórz w 2 przeglądarkach → tryb Online → utwórz pokój → dołącz po kodzie → grajcie
- [ ] HTTPS pad-lock zielony, brak ostrzeżeń o certyfikacie
- [ ] W AdMob → Apps → Socker → **app-ads.txt** → wpisz `https://prostriker.online/`
  (Google sam dopaszuje `/app-ads.txt`, weryfikacja do 24h)
- [ ] W Play Console: Privacy policy URL = `https://prostriker.online/legal/privacy.html`

Po wszystkim — gra dostępna publicznie, AdMob zweryfikowany, multiplayer działa z dowolnego urządzenia.

---

## Co dalej

- Build APK z `MP_SERVER_URL=undefined` (automatycznie weźmie `wss://prostriker.online/ws`,
  bo `location.host` = `prostriker.online`)
- Wgranie AAB do Play Console → closed testing → produkcja
- Faza 3: turnieje (wtedy dochodzi Postgres)

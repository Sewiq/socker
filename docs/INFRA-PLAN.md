# 🌐 Plan infrastruktury — 2× VM + 1 IP publiczny

Decyzyjny plan jak rozłożyć usługi ProStriker na dwóch maszynach, z których
**tylko jedna ma publiczny adres IP** (drugi VM osiągalny przez sieć prywatną).

> **Założenia z ustaleń:**
> - 2× VM (podobne specy, wolny wybór alokacji)
> - 1 publiczny IPv4 (drugi VM **bez** publicznego IP, ale **prywatna sieć** je łączy)
> - Strategia: **VM1 = prod, VM2 = staging + narzędzia**
> - Domena: użytkownik ma `prostriker.online` + opcjonalnie inne domeny do wyboru pod staging/narzędzia

---

## 0. TL;DR — co gdzie ląduje

```
                  Internet (publiczny IP X.X.X.X)
                          │
                          ▼
        ┌─────────────────────────────────────────┐
        │  VM1  (PROD — frontend wszystkiego)     │
        │  Nginx 80/443 → SNI po domenie:         │
        │    prostriker.online       → prod stack │
        │    staging.prostriker.online → VM2:3001 │
        │    metrics.prostriker.online → VM2:3000 │
        │  Kontenery:                              │
        │   • mp-server-prod  (Node WS :3000)     │
        │   • prostriker-web  (statyki /opt/web)  │
        │   • postgres-prod   :5432  (private)    │
        │  Certbot + Let's Encrypt na Nginx       │
        └────────────┬────────────────────────────┘
                     │  prywatna sieć (10.x)
                     ▼
        ┌─────────────────────────────────────────┐
        │  VM2  (STAGING + NARZĘDZIA)             │
        │  Brak publicznego IP — tylko privatka   │
        │  Kontenery:                              │
        │   • mp-server-staging :3001             │
        │   • postgres-staging  :5432             │
        │   • Grafana/Prometheus :3000 (metrics)  │
        │   • backupy (pg_dump → wolumin/S3)      │
        │   • CI/runner GitHub Actions (opcjon.)  │
        └─────────────────────────────────────────┘
```

Reguła: **VM1 jest jedynym punktem wejścia** dla użytkowników. Wszystko z internetu wpada
przez Nginx na VM1; jeśli zasób żyje na VM2, Nginx robi `proxy_pass` przez prywatną sieć.

---

## 1. Domeny — rekomendacja

Skoro masz `prostriker.online` + inne domeny do potencjalnego wykorzystania:

### ✅ Rekomendacja: trzymaj wszystko pod `prostriker.online` (subdomeny)

```
prostriker.online              → prod (gra + landing + mp)
staging.prostriker.online      → staging (ten sam stack, dane testowe)
metrics.prostriker.online      → monitoring (Grafana, dostęp tylko z whitelist IP / basic auth)
api.prostriker.online          → opcjonalnie, gdy chcemy oddzielić API od front-end
                                 (na razie /v1/* na głównej domenie wystarcza)
```

**Dlaczego nie inna domena dla staging?**
- Cookies, CORS, OAuth callback URLs są per-domena. Jeśli staging jest na `staging.prostriker.online`,
  konfiguracja produkcyjna **różni się tylko nazwą subdomeny** — prosty `.env` z `BASE_URL`.
- Brand spójny — użytkownicy widzą tylko `prostriker.online`, staging/metrics są wewnętrzne.

**Kiedy użyć innej domeny:**
- **Tylko jeśli** ma być publicznie marketingowo niezależne (np. `prostrikergame.com` jako alias),
  albo jeśli kupiona była z myślą o przekierowaniu (`prostriker.app` → 301 → `prostriker.online`).
- Dla narzędzi wewnętrznych (Grafana, GitLab, własny GitHub mirror) **lepiej osobna domena**,
  np. `tools.kynologic.pl` — nie ujawnia, jakimi narzędziami obsługujesz produkt.

### Co zrobić z innymi domenami, które masz
- **Jedna jako alias produktowa** (np. krótsza, łatwiejsza do dyktowania) → 301 redirect na `prostriker.online`.
- **Jedna na narzędzia firmowe** (`tools.kynologic.pl` lub `infra.tchorzewski.pl`) → tu Grafana,
  backupy, CI dashboardy. Dzięki temu wewnętrzne metryki nie są pod marką gry.
- Reszta — zostaw nieskonfigurowaną, niech leży na przyszłość.

> **Konkretna sugestia:** powiedz mi nazwy innych domen i powiem czy je użyć teraz vs zostawić
> na potem. Na ten moment **`prostriker.online` w pełni wystarcza** dla całego stacka.

---

## 2. Sieć i bezpieczeństwo

### Publiczna powierzchnia ataku (VM1)
Otwieramy **tylko 3 porty** światu:
- `22/tcp` — SSH (z fail2ban + klucz SSH only, brak haseł). Najlepiej zmienić na niestandardowy port (np. 2222) i wpuścić tylko z Twoich IP.
- `80/tcp` — HTTP (Certbot challenge + redirect na HTTPS).
- `443/tcp` — HTTPS (cała gra, multiplayer WS, /v1 API).

### Prywatna sieć (VM1 ↔ VM2)
Zakładam że dostawca daje prywatne IP-ki w VLAN-ie (typowe u Hetznera, OVH, DigitalOcean).
Jeśli **nie ma natywnej prywatnej sieci**, używamy **WireGuard / Tailscale**:
- Hostowo, między VM1 i VM2 — szyfrowany tunel, oba widzą się po prywatnym IP `10.0.0.1` ↔ `10.0.0.2`.
- Tailscale = łatwiej (zero config), ale uzależnia od ich kontroli.
- WireGuard = self-hosted, w 100% Twój — polecam.

### Reguły firewall (przykładowy `ufw`)
**VM1 (publiczny):**
```bash
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp        # albo 2222 jeśli zmienisz
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow from 10.0.0.0/24 to any port 5432  # Postgres tylko z prywatnej sieci
ufw enable
```

**VM2 (prywatny):**
```bash
ufw default deny incoming
ufw allow from 10.0.0.0/24       # cały ruch z prywatnej sieci OK
ufw allow 22/tcp                  # SSH (lub tylko z VM1 via bastion)
ufw enable
```

---

## 3. Alokacja usług — co gdzie

| Usługa | VM1 (prod) | VM2 (staging+narzędzia) | Uzasadnienie |
|---|:---:|:---:|---|
| Nginx reverse proxy | ✅ | — | Jedyny VM z publicznym IP |
| Statyki gry (PWA + landing) | ✅ | — (mirror dla stagingu) | Najmniejsze obciążenie, blisko Nginx |
| Multiplayer Node (`socker-server`) prod | ✅ | — | Niskie opóźnienie — bezpośrednio za proxy |
| PostgreSQL prod | ✅ | — | Niskie opóźnienie dla Node MP. Backupy lecą na VM2. |
| Multiplayer Node staging | — | ✅ | Eksperymentalne, niech nie psuje prodowego procesora |
| PostgreSQL staging | — | ✅ | Inne dane = inna instancja |
| Backupy (`pg_dump`) | — | ✅ (cron) | Backupy z VM1 pull-em przez prywatną sieć, lądują na VM2 + opcjonalnie S3 |
| Monitoring (Grafana + Prometheus) | exporters | ✅ (UI) | UI na VM2, exportery na obu — nie blokujemy prod CPU/RAM dla wykresów |
| Logi (Loki + Promtail) | promtail | ✅ (Loki) | Tak samo, agregacja na VM2 |
| Certbot (Let's Encrypt) | ✅ | — | Tylko VM1 ma TLS na zewnątrz |
| `npm run landing` / dev | — | — | Tu nie istnieje — dev jest tylko lokalnie u programisty |

### Zmienne `.env` per środowisko
**Prod (VM1, `/opt/prostriker-mp/.env`):**
```
NODE_ENV=production
PORT=3000
BIND_HOST=127.0.0.1
DATABASE_URL=postgres://app:***@127.0.0.1:5432/prostriker_prod
JWT_SECRET=<256-bit random>
ALLOWED_ORIGINS=https://prostriker.online
GOOGLE_OAUTH_CLIENT_ID=<klient-id-google>
GOOGLE_SERVICE_ACCOUNT_JSON=/run/secrets/play_service_account.json
```

**Staging (VM2, `/opt/prostriker-mp/.env`):**
```
NODE_ENV=staging
PORT=3001
BIND_HOST=10.0.0.2
DATABASE_URL=postgres://app:***@127.0.0.1:5432/prostriker_staging
JWT_SECRET=<inny 256-bit random>
ALLOWED_ORIGINS=https://staging.prostriker.online
GOOGLE_OAUTH_CLIENT_ID=<INNY klient-id-google (osobny projekt na test)>
```

> ⚠️ **Klucze prod NIGDY na staging i odwrotnie.** Osobne JWT secrety, osobne Google OAuth (osobny projekt Google Cloud Console), osobny Play Developer Service Account.

---

## 4. Nginx — szkic konfiguracji

`/etc/nginx/sites-available/prostriker.conf` na VM1:

```nginx
# Wspólne mapowanie do upgrade WebSocket
map $http_upgrade $connection_upgrade { default upgrade; '' close; }

# --- PROD: prostriker.online ---
server {
    listen 80;
    server_name prostriker.online www.prostriker.online;
    return 301 https://prostriker.online$request_uri;
}
server {
    listen 443 ssl http2;
    server_name prostriker.online;
    ssl_certificate     /etc/letsencrypt/live/prostriker.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/prostriker.online/privkey.pem;

    root /opt/prostriker-web;
    index index.html;

    # Multiplayer WS — lokalnie na VM1
    location /ws {
        proxy_pass http://127.0.0.1:3000/ws;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 86400;
    }
    # API v1 — lokalnie na VM1
    location /v1/ {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
    # Statyki + landing (root = index.html, gra w /www/)
    location / { try_files $uri $uri/ /index.html; }
}

# --- STAGING: staging.prostriker.online → VM2 przez prywatną sieć ---
server {
    listen 443 ssl http2;
    server_name staging.prostriker.online;
    ssl_certificate     /etc/letsencrypt/live/staging.prostriker.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/staging.prostriker.online/privkey.pem;

    # ZABEZPIECZENIE: staging tylko dla Ciebie/testerów (whitelist + basic auth opcjonalnie)
    # allow 1.2.3.4;          # Twoje IP domowe / firmowe
    # allow 5.6.7.8;          # IP testerów
    # deny all;
    # auth_basic "Staging"; auth_basic_user_file /etc/nginx/.htpasswd-staging;

    location /ws {
        proxy_pass http://10.0.0.2:3001/ws;   # WireGuard private IP VM2
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_read_timeout 86400;
    }
    location /v1/ {
        proxy_pass http://10.0.0.2:3001;
        proxy_set_header Host $host;
    }
    # Statyki staging — kopia repo na VM2, ale można też serwować to samo co prod
    location / {
        proxy_pass http://10.0.0.2:8081;       # nginx wewnętrzny na VM2 serwujący staging statyki
    }
}

# --- METRICS: metrics.prostriker.online → Grafana na VM2 (whitelist IP) ---
server {
    listen 443 ssl http2;
    server_name metrics.prostriker.online;
    ssl_certificate     /etc/letsencrypt/live/metrics.prostriker.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/metrics.prostriker.online/privkey.pem;

    # allow 1.2.3.4; deny all;
    auth_basic "Metrics"; auth_basic_user_file /etc/nginx/.htpasswd-metrics;

    location / {
        proxy_pass http://10.0.0.2:3000;       # Grafana na VM2
        proxy_set_header Host $host;
    }
}
```

> Po pierwszym `nginx -t && systemctl reload nginx`, Certbot wstawia `ssl_certificate*` automatycznie:
> `certbot --nginx -d prostriker.online -d www.prostriker.online -d staging.prostriker.online -d metrics.prostriker.online`

---

## 5. PostgreSQL — gdzie i jak

### Decyzja: **prod-DB na VM1**, staging-DB na VM2

**Powód:** Node MP prod pisze do bazy przy każdym meczu — lokalna baza (localhost) =
0.5ms latency. Sieć prywatna do VM2 = 1-2ms (drobiazg, ale czemu nie). Główne: jeśli
VM2 padnie/zostanie restartowany, prod żyje.

**Trade-off:** backupy są krytyczne — odbywają się **z VM2 pullem** przez prywatną sieć:

```bash
# crontab na VM2, codziennie 03:00
0 3 * * * pg_dump -h 10.0.0.1 -U backup prostriker_prod \
  | gzip > /var/backups/prostriker/prod-$(date +\%Y\%m\%d).sql.gz && \
  find /var/backups/prostriker -name "prod-*.sql.gz" -mtime +30 -delete
```

**Bonus:** jeśli kiedyś rozważymy replikację, prosty `pg_basebackup` z VM1 do VM2 ustanowi
read-replica (przyda się na staty/analytics dashboardu).

---

## 6. Monitoring

Minimum opłacalne (lekkie, samohostowane na VM2):
- **Prometheus** — scrapes `node_exporter` z obu VM-ów + `nginx-exporter` z VM1 + custom `/metrics` z Node MP
- **Grafana** — dashboardy (CPU/RAM/dysk per VM, RPS Nginx, aktywni gracze online, RTT WS)
- **Loki + Promtail** — agregacja logów (Node MP → Loki, Nginx access/error → Loki)
- **Alertmanager** → Telegram/Discord webhook gdy:
  - CPU > 80% przez 5 min
  - dysk > 85%
  - Postgres niedostępny
  - Brak healthcheck `/health` przez 2 min

**Co WAŻNE:** dashboard `metrics.prostriker.online` MUSI być za whitelist IP albo basic auth.
Grafana w domyśle pokazuje dużo informacji o stack-u.

---

## 7. Plan wdrożenia — kolejność

Każdy krok testowalny w izolacji. Zatrzymujemy się i sprawdzamy.

| # | Krok | Czas | Zewnętrzne |
|---|---|---|---|
| 1 | **Provisioning VM-ów** (Ubuntu 22.04 lub Debian 12, klucz SSH, fail2ban, ufw, swap) | 30 min × 2 | Dostawca VPS |
| 2 | **Prywatna sieć VM1↔VM2** (natywna, lub WireGuard) | 20 min | — |
| 3 | **Docker + docker-compose** na obu VM | 10 min × 2 | — |
| 4 | **DNS** — A-records: `prostriker.online`, `www`, `staging`, `metrics` → publiczny IP VM1 | 5 min (+propagacja) | Panel rejestratora |
| 5 | **Nginx + Certbot** na VM1 (HTTP only, certy via DNS-01 albo HTTP-01) | 30 min | — |
| 6 | **Deploy gry (statyki)** na VM1 (`git clone socker` → `/opt/prostriker-web`) | 15 min | — |
| 7 | **Deploy mp-server prod** na VM1 (docker-compose, `.env`, healthcheck) | 30 min | — |
| 8 | **Deploy mp-server staging** na VM2 (analogicznie, na :3001) | 30 min | — |
| 9 | **Certy dla wszystkich subdomen** (Certbot rozszerza istniejący cert) | 5 min | — |
| 10 | **Postgres prod na VM1** (Docker, wolumin, password, backupy pull-em) | 45 min | — |
| 11 | **Postgres staging na VM2** | 20 min | — |
| 12 | **Monitoring** (Prometheus + Grafana + Loki na VM2) | 1-2 h | — |
| 13 | **Cron backupów** | 15 min | — |
| 14 | **Test pełny** — gra publiczna, multiplayer 2 urządzeń, staging, metryki | — | — |

**Łącznie**: 1-2 dni roboty na pełny stack. **Krok 1-9 (~3-4h) wystarcza** żeby gra była publiczna pod `prostriker.online` z działającym multiplayerem.

> **Postgres (krok 10-11) wchodzi DOPIERO przy Fazie 3** (konta + ranking). Na MVP nie potrzeba —
> serwer trzyma pokoje w pamięci. Można odłożyć i pierwsze 4 tygodnie zbierać tylko anonimowych graczy.

---

## 8. Bezpieczeństwo — checklist

- [ ] **Hasła SSH wyłączone** (`PasswordAuthentication no` w `/etc/ssh/sshd_config`)
- [ ] **Root SSH wyłączony** (`PermitRootLogin no`)
- [ ] **fail2ban** zainstalowany na obu VM-ach
- [ ] **`ufw` skonfigurowany** wg sekcji 2
- [ ] **Niestandardowy port SSH** (np. 2222)
- [ ] **Unattended-upgrades** włączone dla security patches (Ubuntu/Debian)
- [ ] **Certbot auto-renew** w cron (Let's Encrypt wygasają co 90 dni)
- [ ] **Backupy testowane** — co 3 miesiące zrób test restore na staging
- [ ] **Sekrety w `.env`** chmod 600, NIGDY w git
- [ ] **Logi rotowane** (`logrotate` dla Nginx, Docker)
- [ ] **VM2 nie ma żadnego publicznego portu** (sprawdź: `nmap` z zewnątrz)
- [ ] **Grafana/metrics** za whitelist + basic auth
- [ ] **Service account Play Developer API** — JSON w `/run/secrets/`, nie w obrazie Docker

---

## 9. Koszty operacyjne (orientacyjnie)

| Koszt | Wartość | Uwaga |
|---|---|---|
| 2× VM (1 vCPU / 2 GB / 20 GB) | ~30-50 zł/mc | Hetzner, OVH, Mevspace |
| Domena `prostriker.online` | ~50 zł/rok | masz |
| Let's Encrypt cert | 0 zł | auto-renew |
| Backupy S3 (opcjonalnie zewnętrzne) | ~5 zł/mc do 10 GB | Wasabi/Backblaze |
| **RAZEM** | **~35-60 zł/mc** | Bardzo niskie |

> Hetznerowski CX22 (2 vCPU / 4 GB / 40 GB) to ~15 zł/mc i bez problemu utrzyma cały prod stack + Postgres. Dwa po ~15 zł = ~30 zł/mc na całość. Dużo zapasu.

---

## 10. Co potrzebuję od Ciebie żeby zacząć

Po Twojej stronie:
1. **Dostawca VPS + 2× VM provisioned** (Ubuntu 22.04 LTS albo Debian 12)
2. **Publiczny IP + dostęp SSH** do VM1 (klucz SSH od Ciebie, ja dostaję komendy → wklejasz)
3. **Decyzja**: czy używamy natywnej prywatnej sieci (jeśli dostawca daje), czy WireGuard
4. **DNS-y**: panel rejestratora `prostriker.online`, gotowość ustawienia A-records
5. **Lista innych domen** które masz (na decyzję czy jedna z nich = tools/metrics)

Po naszej (mojej) stronie:
- Wszystkie pliki konfiguracyjne (`docker-compose.yml`, `nginx.conf`, scripts) już są w repo
  `socker-server` (DEPLOY.md) i `socker` (DEPLOY.md) — zaktualizuję pod 2-VM setup w osobnym PR
- Skrypty bootstrap (`./scripts/vm1-bootstrap.sh`, `./scripts/vm2-bootstrap.sh`) — przygotuję

---

## 11. Open questions (mniejsze, ale ważne)

1. **Backupy off-site** — chcesz dodatkowo wysyłać do S3/Backblaze (~5 zł/mc, ale ratuje przed całkowitą katastrofą u dostawcy VPS)?
2. **Monitoring od razu czy później** — Prometheus/Grafana dodaje ~30 min konfigu, ale **dawkuje spokój** (alarmy gdy coś pada). Polecam od razu.
3. **CI/CD** — GitHub Actions z deployem przez SSH (`appleboy/ssh-action`) na każdy push do `main`? Czy ręczny deploy?
4. **Zmiana SSH portu i admin notification** — chcesz Telegram bot powiadamiający o nieudanych logowaniach SSH?

---

*Plan do akceptacji. Po Twojej zgodzie ruszamy z PR-em `deploy-infra-2vm`,
który aktualizuje DEPLOY.md i dodaje skrypty bootstrap dla VM1/VM2.*

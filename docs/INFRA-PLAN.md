# 🌐 Plan infrastruktury — Proxmox, wiele VM, skala 100-1000 gier

Architektura ProStriker dla **prywatnej infrastruktury (Proxmox/dedyk)** z możliwością
tworzenia **dowolnej liczby VM** i **wielu publicznych IP**. Skala docelowa: **100-1000
równoczesnych gier online**, bez wchodzenia w Kubernetes (jeszcze niepotrzebny, dodaje
overhead nie dający dziś wartości).

> Zastępuje wcześniejszy szkic 2-VM (z czasów gdy zakładaliśmy 1 publiczny IP).
> Tamten plan zostawiamy w historii git jako odniesienie minimalistyczne.

---

## 0. TL;DR — pełna architektura

```
                  Internet
                       │
                       ▼
        ┌──────────────────────────────────┐
        │  EDGE  (publiczne IP × 2)        │
        │  vm-edge-1   IP_PUB_1            │  ← keepalived VRRP
        │  vm-edge-2   IP_PUB_2            │     floating IP_PUB_VIP
        │  Nginx + Certbot                 │     między nimi
        │  TLS terminacja, rate-limit      │
        └────┬────────────────┬────────────┘
             │   prywatna sieć (10.10.0.0/16)
             │                │
    ┌────────▼──────┐  ┌──────▼─────────┐  ┌───────────┐
    │ APP  (mp+web) │  │ APP staging    │  │ TOOLS     │
    │ vm-app-1      │  │ vm-app-stg     │  │ vm-tools  │
    │ vm-app-2      │  │                │  │ Grafana   │
    │ Node MP + PWA │  │ Node + PWA     │  │ Loki      │
    │ (autoscale)   │  │ z gałęzi main  │  │ Prom.     │
    └────────┬──────┘  └──────┬─────────┘  │ Backups   │
             │                │            │ CI runner │
             ▼                ▼            └─────┬─────┘
    ┌────────────────────────────────────────────┘
    │            DATA  (prywatna sieć)
    │  ┌──────────────────┐   ┌────────────────┐
    │  │ vm-db-prod-primary│  │ vm-db-stg      │
    │  │ Postgres + WAL    │  │ Postgres       │
    │  │ stream replication│──│ staging        │
    │  │       ↓           │  └────────────────┘
    │  │ vm-db-prod-replica│  ┌────────────────┐
    │  │ Postgres read-rep │  │ vm-redis       │
    │  │ + backups host    │  │ (matchmaking,  │
    │  └──────────────────┘   │  sesje, cache) │
    │                          └────────────────┘
    └──────────────────────────────────────────────
```

**Co tu mamy:**
- **Edge × 2** — odporność na restart jednej maszyny (zero downtime przy aktualizacji Nginx)
- **App × 2** — to samo dla warstwy aplikacyjnej (mp-server scaluje się horyzontalnie)
- **DB primary + replica** — primary obsługuje zapisy, replica jest hot-standby + odciąża reads (ranking, statystyki) + jest źródłem backupów
- **Redis** — matchmaking, cache rankingu, sesje JWT blacklist (wylogowanie globalne)
- **Tools** — wszystko co nie obsługuje ruchu produkcyjnego: Grafana, Prometheus, Loki, backupy off-site, GitHub Actions runner
- **Staging** — pełna kopia stacka mniejsza skalowo, ale z własną bazą

---

## 1. Liczba i role VM-ów (8 VM-ów na start)

| Rola | Liczba | RAM | CPU | Dysk | Publiczny IP | Notatka |
|---|---|---|---|---|---|---|
| `vm-edge-1` | 1 | 2 GB | 2 vCPU | 20 GB | ✅ `IP_PUB_1` | Nginx + Certbot + keepalived |
| `vm-edge-2` | 1 | 2 GB | 2 vCPU | 20 GB | ✅ `IP_PUB_2` | jw., floating VIP między nimi |
| `vm-app-1` | 1 | 4 GB | 2 vCPU | 30 GB | — | Node MP + PWA (prod) |
| `vm-app-2` | 1 | 4 GB | 2 vCPU | 30 GB | — | jw., load-balanced przez Nginx |
| `vm-app-stg` | 1 | 2 GB | 2 vCPU | 30 GB | — | Node MP + PWA (staging, z main) |
| `vm-db-prod-primary` | 1 | 8 GB | 4 vCPU | 100 GB | — | Postgres primary, RAM = bufory cache |
| `vm-db-prod-replica` | 1 | 8 GB | 4 vCPU | 100 GB | — | Streaming replication + backupy |
| `vm-db-stg` | 1 | 2 GB | 2 vCPU | 30 GB | — | Postgres staging (niezależne dane) |
| `vm-redis` | 1 | 2 GB | 2 vCPU | 20 GB | — | Redis 7, persistent (RDB+AOF), AUTH |
| `vm-tools` | 1 | 4 GB | 2 vCPU | 100 GB | — | Grafana + Prometheus + Loki + backupy + CI |

**Razem ≈ 38 GB RAM / 24 vCPU / 480 GB SSD.** Komfortowo mieści się na średnim dedyku
(64 GB RAM / 32 vCPU). Na Proxmoxie ze swapem i thin-provisioning możesz pojechać na słabszej
maszynie i podnosić zasoby per VM gdy zajdzie potrzeba.

**Co zostawiamy „na potem"** — bez sensu robić dziś:
- Drugi Redis (HA Sentinel) — sprawimy gdy będzie obciążenie
- Dodatkowe `vm-app-N` (3, 4, ...) — gdy `htop` pokaże saturację
- Osobny `vm-mailer` (SMTP, transactional mail) — gdy będzie potrzeba e-maili (logowanie, promo)
- Osobny `vm-jobs` (workery, cron, scheduled tasks) — gdy ranking ELO zacznie żuć CPU

---

## 2. Sieć — domeny, IP, prywatna sieć

### Strategia DNS (z kupioną domeną `prostriker.online`)

```
prostriker.online              A  → IP_PUB_VIP   (floating, keepalived)
www.prostriker.online          A  → IP_PUB_VIP
staging.prostriker.online      A  → IP_PUB_VIP   (Nginx kieruje na vm-app-stg)
tools.prostriker.online        A  → IP_PUB_VIP   (lub osobna domena firmowa)
```

**Floating IP (keepalived VRRP)** między `vm-edge-1` i `vm-edge-2`:
- Normalnie cały ruch leci na `vm-edge-1` (priority 200)
- Gdy `vm-edge-1` pada / restart → `vm-edge-2` (priority 100) przejmuje `IP_PUB_VIP` w sekundę
- DNS się nie zmienia, użytkownik nie widzi rozłączenia (oprócz aktywnych WS-ów, które reconnectują)

**`IP_PUB_2`** jako osobny IP `vm-edge-2` służy do diagnostyki (możesz wejść po SSH bezpośrednio
nie czekając na VRRP). Można też później użyć jako separate subdomena (`api.prostriker.online`)
gdy zechcesz fizycznie oddzielić ruch API od WS.

### Prywatna sieć Proxmoxa
Załóż bridge `vmbr1` na siec `10.10.0.0/16`:
```
vm-edge-1            10.10.1.1
vm-edge-2            10.10.1.2
vm-app-1             10.10.2.1
vm-app-2             10.10.2.2
vm-app-stg           10.10.2.10
vm-db-prod-primary   10.10.3.1
vm-db-prod-replica   10.10.3.2
vm-db-stg            10.10.3.10
vm-redis             10.10.4.1
vm-tools             10.10.5.1
```

Tylko VM-y edge mają routing publiczny. Reszta wyłącznie w sieci prywatnej.
**To krytyczne** — `vm-db-*` i `vm-redis` nigdy nie powinny mieć żadnego publicznego portu.

### Firewall Proxmox (na poziomie hypervisora)
Reguły per VM, niezależne od `ufw` wewnątrz VM. Drugi pierścień ochrony:
- edge: in 22, 80, 443, vrrp z drugiego edge'a; out: all
- app: in tylko z `10.10.1.0/24` (edge) na port aplikacji; out: bazy + redis + internet (npm/git)
- db: in tylko z `10.10.2.0/24` (app) i `10.10.5.0/24` (tools, backupy) na 5432; out: replica
- redis: in tylko z `10.10.2.0/24` na 6379; out: nic
- tools: in tylko z VPN-a Twojego (whitelist Twoich IP); out: all

---

## 3. Reverse proxy — Nginx jako edge

Każdy `vm-edge-N` ma identyczny `nginx.conf` (sync przez Ansible/git). Upstream'y dla aplikacji:

```nginx
upstream mp_app_prod {
    # weighted load balancing; least_conn dla WS
    least_conn;
    server 10.10.2.1:3000 max_fails=2 fail_timeout=10s;
    server 10.10.2.2:3000 max_fails=2 fail_timeout=10s;
}
upstream mp_app_staging {
    server 10.10.2.10:3001;
}

# Sticky-session dla WS po headerze (lub IP hash, alternatywnie)
# Tu używamy least_conn bo nasze WS są stanowe TYLKO w obrębie jednego pokoju,
# a serwer wybiera node pokoju przez Redis (sekcja 5).

server {
    listen 443 ssl http2;
    server_name prostriker.online;
    # certyfikaty (Certbot dnsauth dla wildcard byłby ładniejszy — sekcja 9)
    ssl_certificate     /etc/letsencrypt/live/prostriker.online/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/prostriker.online/privkey.pem;

    location /ws  { proxy_pass http://mp_app_prod; proxy_http_version 1.1; ...; }
    location /v1/ { proxy_pass http://mp_app_prod; }
    location /    { proxy_pass http://mp_app_prod; }   # statyki też z app (lub osobny vm-cdn jeśli wolisz)
}
server {
    listen 443 ssl http2;
    server_name staging.prostriker.online;
    # whitelist + basic auth, jak w poprzednim planie
    location / { proxy_pass http://mp_app_staging; }
}
```

**Statyki:** dwa modele:
- (a) razem z app (`vm-app-N` serwuje też `www/`) — proste, jeden deploy. **Polecam na start.**
- (b) osobny `vm-cdn` z czystym Nginxem + caching. Sens gdy traffik statyków zacznie konkurować z mp.

---

## 4. Warstwa aplikacji — mp-server × 2 z koordynacją

Wielość instancji wymaga, by **gracze z tego samego pokoju trafiali do tego samego node'a mp-server**.
Dwie ścieżki:

### Wariant A: sticky-by-room przez Redis (polecam)
- Każdy mp-server rejestruje swój pokój w Redis: `SET room:K7M2X = vm-app-1`
- Gdy klient B chce dołączyć do pokoju kodem `K7M2X` → Nginx kieruje go na losowy app-node,
  ten odczytuje z Redis i przekierowuje (`302 ws://internal/connect?node=vm-app-1`) **albo**
  proxy-uje wewnętrznie (prościej dla klienta).
- Matchmaking (FIND_MATCH): kolejka w Redis sorted-set, jeden worker (jeden app-node z lockiem) paruje.

### Wariant B: room-affinity przez ID w cookie
- Mniej elastyczne, ale prostsze. Klient po dołączeniu do pokoju dostaje cookie `node=vm-app-1`
- Nginx ip_hash / cookie hash; przy upadku node'a — pokój ginie

**Robimy A** — Redis i tak będzie używany do matchmakingu i sesji.

### Skalowanie horyzontalne
- Dziś: 2 app VM
- Gdy `htop` pokaże > 70% CPU średnio, dodajesz `vm-app-3` w Proxmoxie (klonujesz template), wpisujesz IP do upstreamu Nginx, `nginx -s reload` — bez downtime.
- Cel skalowy ~1000 gier równocześnie: pojedynczy Node WS spokojnie obsłuży ~500-1000 sockety przy ruchach 1/s. Trzy app-node komfortowo dadzą 2000+ socketów.

---

## 5. Redis — krytyczny komponent przy multi-node

### Po co
1. **Room registry** — gdzie żyje pokój (klucz, expiry 10 min od ostatniej aktywności)
2. **Matchmaking queue** — sorted set z timestampem, jeden worker (lock przez Redis SETNX) paruje
3. **JWT revocation** — czarna lista wylogowanych tokenów (TTL = pozostały czas życia JWT)
4. **Ranking cache** — top-100 globalny przelicza się raz na 30s i siedzi w Redis (`/v1/ranking/global` woła wyłącznie Redis)
5. **Rate-limit** — sliding window per IP per endpoint (jak nie chcemy w Nginx)

### Konfiguracja
- Redis 7, AUTH password (`.env`), bind tylko na `10.10.4.1`
- Persistence: RDB co 5 min + AOF (everysec) — szybki restart po crashu, akceptowalna utrata 1s danych
- Maxmemory 1 GB, policy `allkeys-lru`
- Backupy: `redis-cli BGSAVE` z `vm-tools` codziennie, dump na `vm-tools:/var/backups/redis/`

### HA (gdy potrzebne)
Redis Sentinel z 3 instancjami → automatic failover. **Na start nie warto** — Redis crashes są rzadkie, a downtime 60s = utrata kilku matchmakingów, nie tragedia.

---

## 6. PostgreSQL — primary + streaming replica

### Primary (`vm-db-prod-primary`)
- Postgres 16
- `wal_level = replica`, `max_wal_senders = 5`, `archive_mode = on`
- WAL archive lecący na `vm-tools` (point-in-time recovery)
- Bind tylko na `10.10.3.1`, AUTH `scram-sha-256`
- Połączenia tylko z `10.10.2.0/24` (app) i `10.10.5.0/24` (tools) w `pg_hba.conf`
- Tuning: `shared_buffers = 2GB`, `effective_cache_size = 6GB`, `maintenance_work_mem = 512MB`

### Replica (`vm-db-prod-replica`)
- Streaming replication z primary, `hot_standby = on` (read-only zapytania)
- App-node używa replicy do **zapytań tylko-do-odczytu** (`/v1/ranking/global`, `/v1/profile/:id` — czyt.)
- Promotion na primary w sytuacji failover: ręcznie (`pg_ctl promote`) lub przez `patroni` (overkill na start)

### Co siedzi gdzie
- Zapisy (auth, match results, premium, profile) → primary
- Odczyty rankingu i statystyk → replica
- Backupy → z replicy (nie obciążają primary)

### Staging DB (`vm-db-stg`)
- Single instance, brak replikacji, restart-friendly
- Możesz w każdej chwili restorować ze snapshotu zaszłej prod (test migracji bazy danych)

---

## 7. Backupy

### Strategia 3-2-1
- **3 kopie**: live primary + replica + daily backup
- **2 nośniki**: lokalny dysk vm-tools + zewnętrzny (S3/Backblaze)
- **1 off-site**: zewnętrzny dostawca chmury obiektowej

### Implementacja
```bash
# crontab na vm-tools, codziennie 04:00
0 4 * * * pg_basebackup -h 10.10.3.2 -U replicator \
   -D /var/backups/pg/$(date +\%Y\%m\%d) -Ft -z -P
0 5 * * * rclone copy /var/backups/pg b2:prostriker-backups/pg/
0 5 * * * find /var/backups/pg -mtime +30 -delete
```

WAL streaming archive on primary → vm-tools przez `archive_command` (point-in-time recovery do dowolnego momentu w ostatnich 7 dniach).

### Test backupów (cron 1× w miesiącu)
Automatyczny job na `vm-tools`: pobiera ostatni backup, restoruje na `vm-db-stg`, sprawdza że
podstawowe query działają, raportuje wynik na Grafanę. **Backup który nie był testowany ≠ backup.**

---

## 8. Monitoring i observability

### Stack na `vm-tools`
- **Prometheus** — scrape: node_exporter (wszystkie VM), nginx-exporter (edge), postgres-exporter, redis-exporter, custom `/metrics` z Node MP
- **Grafana** — dashboardy:
  - Overview: CPU/RAM/dysk per VM
  - Aplikacja: RPS, p50/p99 latency, aktywne WS, gry na minutę
  - Baza: query rate, lag replikacji, czas zapytania, free buffer
  - Biznes: aktywni gracze (DAU), nowe konta/dzień, % premium, konwersja promo
- **Loki + Promtail** — agregacja logów wszystkich VM-ów
- **Alertmanager** → Telegram + e-mail:
  - Krytyczne: edge/app/db zdechł, lag replikacji > 5s, miejsce na dysku < 10%
  - Ostrzeżenia: CPU > 80% 5 min, błędne logowania SSH > 10/min

### Synthetic monitoring
- Z `vm-tools` co minutę: `curl https://prostriker.online/health`
- Z **zewnętrznego** UptimeRobota (poza Twoją infrą!) co 5 min — Twoja infra może zdechnąć cała, ktoś musi to widzieć z internetu

---

## 9. Certyfikaty TLS — wildcard przez DNS-01

Z 4+ subdomenami warto przejść z HTTP-01 (per subdomena) na **DNS-01 z wildcard**:
- Jeden certyfikat `*.prostriker.online` pokrywa wszystko (staging, tools, api, future-subdomains)
- Wymaga API w rejestratorze (większość polskich rejestratorów: home.pl, Nazwa.pl, OVH wspierają)
- Certbot z plugin DNS-API renewuje sam

Plus: gdy dodasz nową subdomenę, **nie musisz robić nowego cert-flow** — cert już ją obejmuje.

---

## 10. CI/CD — minimalne, ale prawdziwe

### GitHub Actions runner (self-hosted) na `vm-tools`
Powód: deploy `git pull` + restart kontenera musi się dziać po stronie infry, nie z GitHuba.
Self-hosted runner odpala się w VM, ma SSH do app-VM-ów przez prywatną sieć, robi `docker compose pull && up -d`.

### Pipeline
```yaml
on: push:
  branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest         # GitHub-hosted, szybkie
    - npm test
    - node --check ...

  deploy-staging:
    needs: test
    runs-on: self-hosted           # vm-tools runner
    - ssh vm-app-stg "cd /opt/app && git pull && docker compose up -d --build"

  smoke-test-staging:
    needs: deploy-staging
    runs-on: self-hosted
    - curl https://staging.prostriker.online/health
    - playwright test smoke

  deploy-prod:
    needs: smoke-test-staging
    if: github.event_name == 'release'   # tylko z otagowanej wersji, nie z każdego push
    runs-on: self-hosted
    - ssh vm-app-1 ... && ssh vm-app-2 ...
    - rolling restart (jeden po drugim, by zero downtime)
```

**Reguła:** każda zmiana idzie najpierw na staging, smoke-test, potem ręcznie tworzysz release → prod.

---

## 11. Bezpieczeństwo — checklist

- [ ] **WireGuard VPN** dla administratora — wszystkie SSH/Grafana/Postgres dostępne TYLKO przez VPN
- [ ] **Firewall Proxmox per VM** + `ufw` wewnątrz VM (dwie warstwy)
- [ ] **fail2ban** na edge i app
- [ ] **SSH bez haseł, root off, port 2222**
- [ ] **Unattended-upgrades** Ubuntu/Debian (security only)
- [ ] **Sekrety przez `pass`/Bitwarden** — nigdy w git, w `.env` chmod 600
- [ ] **Audyt logów SSH/Nginx** — Loki + alarm na anomalie
- [ ] **Snapshoty Proxmox** przed każdą większą zmianą (rollback w 5s)
- [ ] **WAL archive testowany** miesięcznie (point-in-time recovery)
- [ ] **GDPR-DSAR** — endpointy do eksportu/usunięcia danych usera (Faza 3)

---

## 12. Co dodać gdy ruch wzrośnie

Mam listę „kiedy włączyć następną optymalizację":

| Metryka | Akcja |
|---|---|
| CPU `vm-app-*` > 70% średnio | Klonuj template → `vm-app-3`, wpisz w Nginx upstream |
| Liczba aktywnych pokoi > 500 | Sharding pokoi przez prefiks kodu w Redis |
| Latency Postgres > 50ms | Tuning indeksów, partycjonowanie matches po `played_at` |
| Replication lag > 10s | Dedykowane łącze (10 Gbps między VM-ami w jednym hoście — Proxmox virtio) |
| > 10k DAU | Cache rankingu agresywniej (60s → 10min), CDN dla statyków |
| > 100k DAU | Wtedy gadamy o Kubernetes |

---

## 13. Plan wdrożenia — kolejność

| # | Krok | Czas | Sprzęt |
|---|---|---|---|
| 1 | **Cloud-init template w Proxmoxie** (Debian 12, klucz SSH, base packages) | 1h | Proxmox |
| 2 | **Network bridge `vmbr1`** (sieć prywatna 10.10.0.0/16) | 15 min | Proxmox |
| 3 | **WireGuard hub na vm-tools** (Twoja stacja → VPN do prywatnej sieci) | 30 min | vm-tools |
| 4 | **Provisioning 10 VM-ów** (klonowanie template z cloud-init) | 1h | Proxmox |
| 5 | **DNS + keepalived edge-pair** (floating VIP) | 1h | edge + DNS panel |
| 6 | **Nginx na edge** (Certbot DNS-01 wildcard, upstream stub) | 1h | edge |
| 7 | **Deploy app prod (× 2)** — Node MP + statyki + Redis client | 2h | app |
| 8 | **Deploy Redis** (config, AUTH, backupy) | 30 min | redis |
| 9 | **Smoke test pełny** — gra publiczna, mp 2 urządzeń | 30 min | — |
| 10 | **Deploy app staging** (analogicznie, port 3001) | 1h | app-stg |
| 11 | **Postgres primary + replica + replikacja** | 2h | db |
| 12 | **Monitoring (Prom + Graf + Loki + alerty)** | 2h | tools |
| 13 | **Backupy + cron + test restore** | 1h | tools |
| 14 | **CI runner + pipeline staging→prod** | 2h | tools |
| 15 | **Snapshot Proxmoxa "stan zerowy"** | 5 min | Proxmox |

**Razem ≈ 1-1.5 dnia roboty na pełny stack.** Krytyczny path do publicznej gry: kroki 1-9 (~6h).

---

## 14. Open questions

1. **Floating IP / keepalived** — dostawca daje Ci dwa publiczne IP w tej samej podsieci /29? VRRP wymaga, żeby IP-ki mogły być przenoszone między VM-ami w warstwie L2 (same broadcast domain). Jeśli IP-ki są w różnych segmentach, alternatywa to DNS failover (mniej elegancki).
2. **Postgres tuning** — masz pomysł ile RAM na prod-db da się wcisnąć? Generic config (8 GB) wystarczy do 1000 gier/dzień; przy 10k+ DAU znacząco tunujemy.
3. **CDN dla statyków** — chcesz puścić statyki przez Cloudflare (darmowy plan)? Plusy: cache PNG/JS bliżej użytkowników w Europie. Minusy: zaleznosc od zewnętrznej usługi. Polecam: **tak, ale po starcie**.
4. **Bare-metal vs VM** — dla `vm-db-prod-primary` rozważyłbym bare-metal (LXC container w Proxmoxie zamiast pełna VM). Niższy overhead, lepszy I/O. Trade-off: snapshoty Proxmox nie działają na LXC tak jak na KVM. Decyzja Twoja.
5. **Mailer** — kiedy potrzebny? Faza 3 promo top-100 (powiadomienia o wygranej premium) i Google login (potwierdzenie zmiany e-maila). Czy stawiamy własny `vm-mailer` (postfix) czy używamy SendGrid/Mailgun? **Polecam zewnętrzny** — własna reputacja IP do maila to dwa miesiące pracy.
6. **Internal DNS** — chcesz wewnętrznego DNS (vm-db-prod-primary.internal → 10.10.3.1) zamiast pisać IP w configach? Polecam: tak (Pi-hole albo dnsmasq na `vm-tools`).

---

## 15. Diff względem poprzedniego planu (2 VM)

| Obszar | Plan 2-VM | Plan Proxmox |
|---|---|---|
| Liczba VM | 2 | 10 (start), skalowalne |
| Publiczny IP | 1 | 2 (floating VIP) |
| HA edge | brak | keepalived VRRP |
| HA app | brak | 2 instancje load-balanced |
| HA db | brak | streaming replica |
| Redis | brak | dedykowane (matchmaking, sesje, cache) |
| Backupy | pull cron | WAL archive + S3 + test restore |
| Monitoring | minimum | pełny stack |
| Deploy | ręczny | CI/CD staging→prod |
| Skala docelowa | ~50 gier | 1000+ gier |
| Czas wdrożenia | ~4h | ~1-1.5 dnia |
| Koszt operacyjny | ~30 zł/mc | zależy od hosta Proxmox |

> **Stary plan** (`docs/INFRA-PLAN.md` historyczny) zostaje w git history jako referencja
> dla minimalistycznego MVP. Bieżący dokument zastępuje go jako aktualny plan działania.

---

*Plan do akceptacji. Po Twojej zgodzie:*
1. *Otwieram PR `infra-bootstrap` ze skryptami cloud-init i Ansible playbookami per rola VM.*
2. *Aktualizuję `DEPLOY.md` pod nową topologię.*
3. *Tworzę osobny dokument `docs/INFRA-RUNBOOK.md` — operacyjny przewodnik na codzienne sytuacje (restart, deploy, restore, scale-out).*

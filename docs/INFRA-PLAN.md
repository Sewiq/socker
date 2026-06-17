# 🌐 Plan infrastruktury — fazowo, od 1 VM do HA

Architektura ProStriker dla **prywatnej infrastruktury (Proxmox/dedyk)**.
Reguła przewodnia: **start mały, skaluj na sygnał**. Nie budujemy 10-VM klastra
„na zapas" — projekt jeszcze nie ma użytkowników, a koszt utrzymania (czas, nie
zł) rośnie szybciej niż wartość.

> Wcześniejsze szkice (2-VM, potem 10-VM Proxmox HA) zostają w historii git jako
> referencja docelowa. Ten dokument prowadzi nas tam **iteracyjnie**, po realnych
> sygnałach z produkcji.

---

## Zasady

1. **Każda faza ma jasny trigger** — nie skalujemy „bo można", tylko gdy
   liczba lub bolesny incydent powie „pora".
2. **Closed testing w Play (12 testerów × 14 dni) nie wymaga backendu** —
   zegar tyka niezależnie od infry; uruchomić najwcześniej.
3. **Multiplayer już działa** (mp-server + ws). Najmniejszy publiczny deploy to
   1 VM z docker-compose, nic więcej.
4. **Postgres/Redis czeka do Fazy 3** (konta + ranking). Bez kont nie ma czego
   trzymać w bazie.
5. **HA (edge×2, replika, floating IP) dopiero gdy downtime realnie boli** —
   przed tym nikt nie zauważy, że padło na 5 minut.

---

## F0 — MVP (1 VM) ⬅️ TUTAJ ZACZYNAMY

**Cel:** publiczny `prostriker.online` z grą i multiplayerem online. Koniec.

```
            Internet
               │
               ▼
   ┌────────────────────────┐
   │ vm-prod  (1 publ. IP)  │
   │ ─────────────────────  │
   │ Nginx + Certbot        │
   │ mp-server (Node)       │
   │ statyki (www/)         │
   │ docker-compose         │
   └────────────────────────┘
```

**Specka:** 2 vCPU, 2 GB RAM, 20 GB SSD. Debian 12 + Docker + docker-compose.

**Co stoi:**
- Nginx (reverse proxy + TLS Let's Encrypt + statyki)
- mp-server (kontener Node)
- *(opcjonalnie)* Postgres lokalnie jako kontener — gdy ruszy Faza 3

**Czego NIE ma:**
- staging (jeszcze nie ma czego psuć)
- Redis (1 instancja mp-server trzyma stan w pamięci)
- repliki bazy, backupów na zewnątrz, monitoringu, CI runnera
- WireGuarda, floating IP, vmbr1

**Deploy ręcznie:** `git pull && docker compose up -d --build`. Wystarczy.

**Trigger wyjścia z F0:** start Fazy 3 (auth + DB) **albo** pierwszy realny
problem (downtime > 30 min boli, mp-server pada raz dziennie, itp.).

---

## F1 — Faza 3 startuje (2 VM)

**Trigger:** zaczynamy implementację kont/rankingu (Faza 3 produktowa).
Dane użytkowników są wartościowe — trzeba je oddzielić od appki i backupować.

```
   Internet
      │
      ▼
 ┌─────────────┐         prywatna sieć
 │ vm-prod     │◄───────────────────────┐
 │ Nginx + app │                        │
 │ mp-server   │                        │
 └─────────────┘                ┌───────▼──────┐
                                │ vm-db        │
                                │ Postgres     │
                                │ + backupy    │
                                │   (S3/B2)    │
                                └──────────────┘
```

**Dochodzi:**
- `vm-db` (2 vCPU, 4 GB RAM, 50 GB SSD) — Postgres + cron `pg_basebackup` →
  zewnętrzny S3/Backblaze (3-2-1 light).
- Prywatna sieć między `vm-prod` ↔ `vm-db` (vmbr1).
- Healthcheck zewnętrzny (UptimeRobot — darmowy, poza naszą infrą).

**Czego nadal NIE ma:**
- replika Postgresa (backupy wystarczą; RTO ~30 min jest OK na tym etapie)
- staging (jeśli zaboli — wtedy dorobić jako 3-cią VM, tania)
- Redis (mp-server dalej 1 instancja)

---

## F2 — Skala out (sygnały z produkcji)

**Trigger:** jeden z:
- CPU `vm-prod` > 70 % przez godzinę
- > 200 CCU (równoczesnych graczy)
- P95 latencji ruchu > 300 ms
- mp-server OOM-killed

**Dochodzi (krok po kroku, nie naraz):**

1. **`vm-app-2`** — druga instancja mp-server + statyki. Nginx na `vm-prod`
   robi `least_conn` LB.
2. **`vm-redis`** — jak tylko jest > 1 instancja mp-server, *musi* być wspólny
   stan (rejestr pokoi, matchmaking queue). Wcześniej Redis jest zbędny.
3. **Replika Postgresa** — gdy backupy nie wystarczają (RTO < 5 min wymagane)
   albo chcemy read-only do statystyk/rankingu bez obciążania primary.
4. **Staging** — gdy psucie proda przy deployu zaboli. Wtedy `vm-app-stg` +
   `vm-db-stg` (mała).

Każdy z tych kroków to **osobny PR**, nie wielki bigbang.

---

## F3 — HA (gdy projekt „złapie")

**Trigger:** downtime kosztuje realne pieniądze/użytkowników. Np.:
- > 1000 CCU stabilnie
- premium subskrybenci skarżą się na padający serwer
- SLA staje się tematem rozmów

**Dochodzi:**
- `vm-edge-1` + `vm-edge-2` z **keepalived VRRP** i floating IP (drugi
  publiczny IP)
- pełny stack monitoringu (Prometheus + Grafana + Loki + Alertmanager →
  Telegram) na `vm-tools`
- CI/CD self-hosted runner na `vm-tools`
- WireGuard hub do admina (zamiast SSH na publicznych IP)
- internal DNS (dnsmasq) — `*.internal` → prywatne IP

Wtedy diagram dochodzi do ~7-10 VM. **Ale dopiero wtedy.**

---

## Co robimy teraz (konkrety na najbliższe tygodnie)

W tej kolejności:

1. **Closed testing w Play Store** — niezależne od infry, zegar 14 dni × 12
   testerów. Patrz `docs/BACKLOG.md` sekcja Android.
2. **F0 deploy** — 1 VM, docker-compose, publiczny `prostriker.online`.
   Cloud-init template raz, potem `git pull`.
3. **app-ads.txt URL w AdMob** — po deployu zaktualizować z GitHub Pages na
   `https://prostriker.online/app-ads.txt`.
4. **Healthcheck zewnętrzny** — UptimeRobot na `/health`.

To wszystko. Resztę uruchamiamy, gdy będą sygnały.

---

## Otwarte pytania (do Fazy 3, nie teraz)

1. **Subdomeny czy ścieżki?** — `mp.prostriker.online` vs `prostriker.online/ws`.
   Sub-domena daje czyste cookies/CORS; ścieżka — jedna config nginx.
2. **Postgres na VM czy LXC?** — LXC tańszy w RAM/CPU, VM lepiej izolowana.
   Dla 1 bazy LXC w zupełności wystarczy.
3. **Cloudflare przed Nginx?** — DDoS, cache statyków, ukrycie origin IP. Plus
   za darmo. Minus — kolejny pośrednik w WS (uważać na timeouty).

Decydujemy gdy podchodzimy do F1.

---

## Czego ten dokument celowo NIE zawiera

- Konkretnych komend `qm create`, `pveam`, `terraform` — bo F0 to jedna VM,
  klikana raz w panelu Proxmoxa.
- Detali keepalived VRRP / WireGuard / Prometheus configów — bo to F3, za
  wcześnie projektować.
- Schematu DB — to jest w `docs/PHASE3-DESIGN.md`.

Gdy któraś faza staje się aktualna — wracamy tu i dopisujemy szczegóły wtedy,
nie teraz.

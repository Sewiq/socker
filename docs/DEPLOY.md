# 🚀 Deploy F0 — 1 VM (Debian 12 + docker-compose)

Runbook od pustej VM do działającego `https://prostriker.online`.

Stos: **nginx + mp-server (Node) + certbot** w docker-compose.
Czas: ~30-40 min za pierwszym razem, ~5 min potem (już tylko `git pull && docker compose up -d`).

---

## 0. Założenia

- VM: **Debian 12**, 2 vCPU, 2 GB RAM, 20 GB SSD, **publiczny IP statyczny**
- DNS: `prostriker.online` zarejestrowana, **rekordy A wskazują na IP VM**
- SSH: dostęp jako użytkownik z `sudo` (root też OK)

---

## 1. Hardening podstawowy (15 min, raz)

```bash
# Update systemu
sudo apt update && sudo apt upgrade -y
sudo apt install -y curl git ca-certificates fail2ban unattended-upgrades ufw

# SSH na non-standard port + tylko klucz
sudo sed -i 's/^#Port 22/Port 2222/' /etc/ssh/sshd_config
sudo sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
sudo systemctl restart sshd

# UFW
sudo ufw default deny incoming
sudo ufw default allow outgoing
sudo ufw allow 2222/tcp comment 'SSH'
sudo ufw allow 80/tcp   comment 'HTTP (certbot)'
sudo ufw allow 443/tcp  comment 'HTTPS + WSS'
sudo ufw --force enable
sudo ufw status

# Automatyczne security updates
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

**Test SSH na nowym porcie z drugiego terminala PRZED wylogowaniem:**
`ssh -p 2222 user@<IP>`. Jak działa — kontynuuj.

---

## 2. Docker + docker-compose plugin

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
newgrp docker

docker --version
docker compose version
```

---

## 3. Klonowanie repo

```bash
sudo mkdir -p /opt/prostriker
sudo chown $USER:$USER /opt/prostriker
cd /opt/prostriker

git clone https://github.com/Sewiq/socker.git
git clone https://github.com/Sewiq/socker-server.git

# Layout:
# /opt/prostriker/socker/
# /opt/prostriker/socker-server/
ls
```

---

## 4. Konfiguracja env

```bash
cd /opt/prostriker/socker/deploy
cp .env.example .env
nano .env
```

W `.env`:
- `DOMAIN=prostriker.online`
- `EMAIL_LE=<twój-email>` (do notyfikacji LE o wygasającym cercie)
- `STAGING=1` na pierwszy raz (test cert); `0` na prawdziwy
- ewentualne env dla mp-server (PORT, NODE_ENV)

---

## 5. Sprawdzenie DNS

```bash
dig +short prostriker.online @1.1.1.1
dig +short www.prostriker.online @1.1.1.1
# Oba powinny zwrócić IP Twojej VM. Jeśli puste — czekaj na propagację.
```

---

## 6. Bootstrap Let's Encrypt (staging)

Pierwszy raz `STAGING=1` żeby uniknąć rate-limitów LE w razie błędu.

```bash
cd /opt/prostriker/socker/deploy
./init-letsencrypt.sh
```

Skrypt:
1. Tworzy dummy cert (samopodpisany)
2. Startuje nginx
3. Usuwa dummy
4. Wywołuje certbot przez webroot (HTTP-01 na :80)
5. Reload nginx z prawdziwym certem

**Sprawdź:** `https://prostriker.online` — przeglądarka pokaże ostrzeżenie (staging cert), ale strona się załaduje.

---

## 7. Przełączenie na prawdziwy cert

```bash
nano .env   # STAGING=0

docker compose down
sudo rm -rf certbot/conf/live certbot/conf/archive certbot/conf/renewal

./init-letsencrypt.sh
```

Teraz `https://prostriker.online` bez ostrzeżenia.

---

## 8. Start całego stacka

```bash
cd /opt/prostriker/socker/deploy
docker compose up -d
docker compose ps
docker compose logs -f --tail=50
```

Sprawdź:
- `curl -I https://prostriker.online` → 200 OK
- `curl -I https://prostriker.online/www/` → 200 OK
- Test WS w konsoli przeglądarki:
  ```js
  new WebSocket("wss://prostriker.online/ws")
  ```

---

## 9. Update / redeploy

```bash
cd /opt/prostriker/socker && git pull
cd /opt/prostriker/socker-server && git pull
cd /opt/prostriker/socker/deploy
docker compose build mp-server   # tylko jeśli zmiany w socker-server
docker compose up -d
```

---

## 10. Troubleshooting

### nginx nie startuje
```bash
docker compose logs nginx | head -30
```
Brak certyfikatów → krok 6.

### certbot nie działa
- Test `:80`: `curl http://prostriker.online/.well-known/acme-challenge/test` → 404 (dobre)
- UFW: `sudo ufw status`
- DNS: `dig +short prostriker.online @8.8.8.8`

### mp-server nie startuje
```bash
docker compose logs mp-server
```
Najczęściej: brak `"start"` w `package.json` socker-server lub brak `index.js`.

### WebSocket zrywa
- `proxy_read_timeout` w `nginx.conf` (jest 3600s)
- Klient ma ping/pong w `www/net.js`

### Pełny restart
```bash
docker compose down && docker compose up -d
```

### Nuke i odbuduj (zostawia certy)
```bash
docker compose down -v
docker compose build --no-cache
docker compose up -d
```

---

## 11. Monitoring (proste, F0)

UptimeRobot (darmowy, poza Twoją infrą):
- monitor HTTPS `https://prostriker.online` co 5 min
- alert email/SMS jak padnie

---

## 12. Co dalej (F1+)

Gdy startuje Faza 3 (auth/DB) — patrz [INFRA-PLAN.md](INFRA-PLAN.md) F1:
- Dochodzi `vm-db` (Postgres) na osobnej VM
- Sieć prywatna `vmbr1` między `vm-prod` ↔ `vm-db`
- Backupy 3-2-1 do S3/Backblaze

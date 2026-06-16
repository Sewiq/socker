# Multiplayer — architektura (Faza 2)

Architektura multiplayera 1v1 dla „Piłkarzyki na kartce".

> **Status:** ✅ **ZBUDOWANE i działa lokalnie.** Silnik (`www/engine.js`),
> serwer ([sewiq/socker-server](https://github.com/Sewiq/socker-server)),
> klient (`www/net.js` + tryb Online) — wszystko spięte, E2E zielone.
> Zostało: deploy na VPS. Pełna roadmapa: [ROADMAP.md → Faza 2](ROADMAP.md).

---

## Cele MVP

Z odpowiedzi na pytania projektowe:

- **Pokoje po kodzie** — utwórz pokój, podziel się 5-znakowym kodem, znajomy
  dołącza i gracie 1v1.
- **Losowy matchmaking** — kliknij „Graj online", system kojarzy z innym
  czekającym graczem.
- **Hosting:** docelowo własny VPS Kynologic. Najpierw budujemy bez założeń
  o hostingu, deploy w ostatnim kroku (Docker + systemd + Nginx reverse proxy).

## Czego NIE robimy w MVP

- Autoryzacji konto/hasło (anonimowo, identyfikacja przez UUID profilu)
- Persystencji w bazie (wszystko w pamięci serwera — restart = pokoje znikają)
- Rankingu ELO (to Faza 3, turnieje)
- Czatu w grze (potem, jeśli będzie potrzeba — łatwo dodać do protokołu)

---

## Architektura

```
┌────────────────┐       WebSocket        ┌──────────────────┐
│  Klient (PWA)  │ ◄──────────────────►   │  Serwer Node     │
│  www/net.js    │   /ws (TLS via Nginx)  │  server/         │
└────────────────┘                        │   ├ index.js     │
                                          │   ├ rooms.js     │
                                          │   ├ matchmaker.js│
                                          │   └ ../www/      │
                                          │     engine.js    │ ← TEN SAM moduł
                                          └──────────────────┘
```

**Kluczowa decyzja:** `www/engine.js` jest **współdzielony** między klientem
i serwerem (UMD export: `window.engine` w przeglądarce, `require()` w Node).
Dzięki temu serwer waliduje ruchy **tym samym kodem**, który gra na froncie —
nie ma ryzyka rozjazdu zachowania.

### Stack

| Warstwa | Wybór | Powód |
|---|---|---|
| Język serwera | Node.js 20 | Reuse silnika z frontu (`engine.js`) |
| Protokół | WebSocket (czysty `ws`) | Lekki, ~50 KB zależności, pełna kontrola |
| Stan | In-memory `Map<roomId, Room>` | MVP nie potrzebuje bazy; restart = czysty serwer |
| TLS / WS | Nginx → `proxy_pass` do Node | Standardowy setup VPS, certyfikat Let's Encrypt |
| Deploy | Docker + docker-compose + systemd | Powtarzalne uruchomienia, restart on failure |

### Dlaczego nie Socket.IO?

- Czysty `ws` to ~50 KB; Socket.IO ~200 KB (klient) + transport-fallbacks których nie potrzebujemy w PWA.
- Mniej magii, łatwiej debugować.
- Reconnect i ping/pong piszemy sami w ~40 liniach.

---

## Protokół (JSON-over-WebSocket)

Każda ramka to `{ "t": "TYP", ... }`. `t` od „type".

### Klient → Serwer

| Typ | Pola | Semantyka |
|---|---|---|
| `HELLO` | `playerId`, `nick`, `country` | Pierwsza ramka po połączeniu; profil z `storage.js` |
| `CREATE_ROOM` | (—) | Tworzy pokój, serwer odpowiada `ROOM` z kodem |
| `JOIN_ROOM` | `code` | Dołącz do istniejącego pokoju |
| `LEAVE_ROOM` | (—) | Opuść bieżący pokój / kolejkę |
| `FIND_MATCH` | (—) | Wstaw się do kolejki matchmakingu |
| `MOVE` | `move:[x,y]` | Ruch w bieżącej grze |
| `REMATCH` | (—) | Propozycja rewanżu po końcu gry |
| `PING` | `t0` | Pomiar opóźnienia |

### Serwer → Klient

| Typ | Pola | Semantyka |
|---|---|---|
| `WELCOME` | `serverTime` | Potwierdzenie HELLO |
| `ROOM` | `code`, `players:[{nick,country,you}]`, `state:"waiting"\|"playing"\|"over"` | Stan pokoju (przesyłany po każdej zmianie) |
| `STATE` | `snap` | Zserializowany stan gry (`engine.serialize(state)`) |
| `MOVE_OK` | `move`, `byPlayer`, `snap` | Potwierdzenie ruchu + nowy stan |
| `ERROR` | `code`, `msg` | Błąd protokołu / nielegalny ruch |
| `OPPONENT_LEFT` | (—) | Drugi gracz się rozłączył |
| `PONG` | `t0`, `t1` | Odpowiedź na PING |

### Przepływ: utworzenie pokoju i rozegranie meczu

```
A: CREATE_ROOM
S→A: ROOM{code:"K7M2X", players:[A], state:"waiting"}
B: JOIN_ROOM{code:"K7M2X"}
S→A,B: ROOM{code, players:[A,B], state:"playing"}
S→A,B: STATE{snap}                       ← stan startowy
B: MOVE{move:[3,4]}                      ← B był pierwszy (gospodarz wybrany na początku przez serwer)
S: walidacja przez engine.isLegalMove(state, move, B-id)
S: engine.applyMove(state, move, B-id)
S→A,B: MOVE_OK{move, byPlayer, snap}
... (gra)
S: state.winner != 0 → broadcast STATE z winnerem
A: REMATCH; B: REMATCH → S resetuje state
```

### Przepływ: matchmaking

```
A: FIND_MATCH → S wstawia A do kolejki, S→A: ROOM{state:"waiting"}
B: FIND_MATCH → S widzi A czekającego, paruje, S→A,B: ROOM{state:"playing"}+STATE
```

---

## Walidacja autorytatywna

```js
// server: po MOVE od gracza X
const r = rooms.get(playerSocket.roomId);
if (!r) return error("NOT_IN_ROOM");
if (!r.engineState) return error("NOT_PLAYING");
const isPlayer1 = r.players[0].id === playerSocket.playerId;
const by = isPlayer1 ? 1 : 2;
if (!engine.isLegalMove(r.engineState, msg.move, by)) {
  return error("ILLEGAL_MOVE");
}
engine.applyMove(r.engineState, msg.move, by);
broadcast(r, { t: "MOVE_OK", move: msg.move, byPlayer: by,
               snap: engine.serialize(r.engineState) });
```

Serwer nigdy nie ufa klientowi co do `state` — trzyma własną kopię, klient
dostaje świeży `snap` przy każdej zmianie. **Cheat odporne** — jeśli ktoś
zmodyfikuje JS i wyśle `move:[100,100]`, serwer odrzuci.

---

## Stan w pamięci serwera

```js
// rooms.js
const rooms = new Map();   // roomId → Room
const sockets = new Map(); // playerId → ws

class Room {
  code         // "K7M2X" (5 znaków A-Z0-9 bez niejednoznacznych O/0/I/1)
  players      // [{id, nick, country, ws}]
  engineState  // null gdy waiting, freshState() gdy playing
  createdAt
  startedAt
}
```

Po `OPPONENT_LEFT` pokój żyje 60s (czas na reconnect), potem usuwany. Garbage
collector co minutę usuwa puste pokoje i zerwane kolejki.

---

## Anty-DoS na MVP

- Rate limit per IP: max 10 połączeń, max 30 wiadomości/sekundę
- Max długość ramki: 8 KB (ruchy są malutkie; więcej = atak)
- Reset pokoju i kolejki przy każdym restarcie serwera

Pełniejsze ograniczenia (CAPTCHA, fail2ban) dorzucamy gdy pojawi się ruch.

---

## Reconnect

Klient trzyma `playerId` w `storage.js` (UUID profilu). Przy reconnect wysyła
`HELLO` z tym samym `playerId` — jeśli serwer pamięta jego pokój i drugi gracz
jeszcze czeka, wraca do meczu z aktualnym `STATE`. W przeciwnym razie pokój
jest zamykany, pojawia się komunikat.

---

## Deploy na VPS (Kynologic)

```
/opt/socker-mp/
├── docker-compose.yml          ← uruchamia kontener Node + nginx
├── nginx/
│   └── socker.conf             ← reverse proxy: socker.example.com → ws://node:3000
├── server/                     ← repo (z node_modules w obrazie)
└── .env                        ← PORT=3000, NODE_ENV=production, ALLOWED_ORIGIN=...
```

Systemd unit `socker-mp.service`:
```
[Service]
WorkingDirectory=/opt/socker-mp
ExecStart=/usr/bin/docker compose up
Restart=always
```

TLS przez Certbot na hostnamie. Klient łączy się przez `wss://socker.example.com/ws`.

Frontend (PWA na GitHub Pages) pobiera URL serwera z `window.MP_SERVER_URL`
(zmienna ustawiona w `index.html` przy deployu produkcyjnym). W dev:
`ws://localhost:3000/ws`.

---

## Plan implementacji (postęp)

1. **Silnik** ✅ — `www/engine.js` (UMD), współdzielony front + serwer (PR #21)
2. **Serwer** ✅ — [sewiq/socker-server](https://github.com/Sewiq/socker-server):
   protokół, pokoje, matchmaking, walidacja autorytatywna, testy E2E (Node test runner)
3. **Klient** ✅ — `www/net.js` + tryb „Online" + lobby (kod / kolejka / status),
   wpięty w flow gry (PR #22)
4. **Deploy** ⏳ — `Dockerfile`, `docker-compose.yml`, `nginx/` gotowe w repo serwera;
   pozostaje uruchomić na VPS Kynologic + ustawić `MP_SERVER_URL` w produkcji

---

## Deploy na VPS — checklist (gdy będzie domena)

- [ ] **Domena/hostname** skierowana na VPS (np. `mp.kynologic.pl`)
- [ ] Na VPS: `git clone socker-server` → `cp .env.example .env` → ustaw
      `ALLOWED_ORIGINS=https://sewiq.github.io` → `docker compose up -d --build`
- [ ] Nginx reverse proxy (plik `nginx/socker.conf.example`) + `certbot --nginx -d domena`
- [ ] W grze: `window.MP_SERVER_URL = "wss://domena/ws"` w `index.html` (produkcja)
- [ ] Test: `curl https://domena/health` + dwa urządzenia grają online

> ⚠️ Uwaga środowiskowa: w środowisku z **conda** zmienna `HOST` jest zajęta
> (triplet kompilatora) i koliduje. Serwer respektuje też `BIND_HOST`; w razie
> błędu `ENOTFOUND` użyj `HOST=0.0.0.0 npm run dev`.

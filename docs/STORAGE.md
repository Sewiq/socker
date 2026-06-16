# Warstwa danych — `storage.js`

Drugi krok Fazy 1 z [ROADMAP.md](ROADMAP.md). Jedyny punkt dostępu do danych
gracza. **Reszta gry nie woła `localStorage` bezpośrednio** — rozmawia tylko z tym
modułem. Gdy przyjdzie chmura (Faza 2+), podmieniamy wnętrze `storage.js`
(localStorage → fetch do backendu z fallbackiem offline), a gra niczego nie zauważy.

---

## Trzy reguły projektowe (pod chmurę od dnia 1)

1. **Profil ma `id` (UUID)** — stały klucz. Nick bywa zmienny, UUID nie.
2. **Mecz ma `id` (UUID) + `playedAt` (ISO 8601 UTC)** — scalanie historii
   z wielu urządzeń bez duplikatów i konfliktów kolejności.
3. **Statystyki są POCHODNĄ historii**, nie źródłem prawdy. Cache w profilu,
   ale zawsze przeliczalne z listy `GameRecord[]`. Inaczej urządzenia rozjadą się
   w licznikach.

---

## Model danych

### PlayerProfile (`localStorage["pilkarzyki.profile"]`)

```
PlayerProfile
├── id             UUID — stały klucz (crypto.randomUUID z fallbackiem)
├── nick           string — pusty = "Gracz" w UI (wybór nicku: krok 3)
├── avatar         { type:"flag", country: "PL" | null }
├── language       "pl" | "en" | "de" — synchronizowany z wyborem w ⚙
├── createdAt      ISO 8601 UTC
├── xp             number — suma z historii (czysta funkcja f(historia))
├── level          number — wyliczany z xp
├── stats          {…} — cache przeliczony z historii (patrz niżej)
└── schemaVersion  1 — KLUCZOWE dla przyszłych migracji
```

### GameRecord (`localStorage["pilkarzyki.history"]`, max 1000, najnowsze pierwsze)

```
GameRecord
├── id          UUID meczu
├── playedAt    ISO 8601 UTC
├── mode        "bot" | "2p"
├── difficulty  "easy" | "medium" | "hard" | null
├── winner      1 | 2
├── reason      "goal" | "block"
├── duration    sekundy
└── meta         { starter, moves, boardW, boardH }
```

### stats (przeliczane, nie zapisywane ręcznie)

```
stats
├── played, won, lost          (won/lost liczone z perspektywy gracza vs bot)
├── vsBot { played, won, lost, byLevel:{easy,medium,hard → {played,won}} }
├── vs2p  { played }
├── currentStreak, bestStreak  (seria zwycięstw vs bot; 2p nie wpływa)
└── byGoal, byBlock            (jak kończyły się mecze)
```

---

## XP / poziom

- **+10 XP** za rozegrany mecz, **+25** dodatkowo za wygraną vs bot.
- Próg poziomu L: `xpForLevel(L) = 50 · L · (L−1)` → L1:0, L2:100, L3:300, L4:600, L5:1000…
- XP i poziom **przeliczane z całej historii** (`recomputeStats`), nie inkrementowane —
  dzięki temu reset historii albo synchronizacja z chmury zawsze dają spójny wynik.

Regułę można tuningować później bez migracji danych (to czysta funkcja `f(historia)`).

---

## API (`window.storage`)

| Metoda | Opis |
|---|---|
| `ready` | Promise — czeka aż dane się załadują (gra startuje po nim) |
| `getProfile()` | → PlayerProfile (auto-tworzony przy 1. uruchomieniu) |
| `updateProfile(patch)` | płytki merge + zapis; zwraca profil |
| `saveGameRecord(rec)` | dopisuje mecz, przelicza staty, przyznaje XP |
| `getGameRecords()` | → GameRecord[] (najnowsze pierwsze) |
| `getStats()` | → staty (cache) |
| `recomputeStats()` | wymusza przeliczenie z historii |
| `resetHistory()` | czyści historię + staty (profil zostaje) |
| `xpForLevel(L)` / `levelForXp(xp)` | helpery progów |
| `onChange(fn)` | subskrypcja zmian (np. odśwież ekran statystyk) |

### Przykład — zapis po meczu (już wpięte w `index.html`)

```js
storage.saveGameRecord({
  mode,                                  // "bot" | "2p"
  difficulty: mode==="bot" ? diff : null,
  winner: p,                             // 1 | 2
  reason: state.winReason || "goal",
  duration: Math.round((Date.now()-state.startTs)/1000),
  meta: { starter: state.starter, moves: state.moves, boardW: W, boardH: H }
});
```

---

## Migracje schematu

`SCHEMA_VERSION` + mapa `MIGRATIONS` w `storage.js`. Gdy zmienisz strukturę:

1. Podbij `SCHEMA_VERSION` (np. → 2)
2. Dodaj `MIGRATIONS[2] = (p) => { /* podnieś z v1 do v2 */ p.schemaVersion = 2; return p; }`

Przy starcie `migrateProfile()` przepuszcza stary profil przez migracje aż do
aktualnej wersji. Brak migracji dla danej wersji = po prostu podbicie numeru
(bezpieczne dla pól dodawanych z domyślną wartością).

---

## Migracja do chmury (Faza 2+) — co się zmieni

Podmieniasz **tylko wnętrze** `readJSON`/`writeJSON` i `load()`:

- `getProfile()` → fetch `/api/profile` z cache w localStorage jako offline-fallback
- `saveGameRecord()` → POST `/api/games` + optymistyczny zapis lokalny
- Scalanie: dzięki UUID meczów i `playedAt` serwer deduplikuje i porządkuje

Reszta gry (`index.html`) **nie wymaga żadnej zmiany** — woła te same metody.

---

## Test

```bash
# logika w izolacji (Node + fałszywy localStorage)
node -e "
global.localStorage=(()=>{const s={};return{getItem:k=>k in s?s[k]:null,setItem:(k,v)=>{s[k]=String(v)},removeItem:k=>{delete s[k]}};})();
global.navigator={language:'pl'}; global.crypto=require('crypto').webcrypto; global.window={};
require('./www/storage.js');
global.window.storage.ready.then(()=>{
  const S=global.window.storage;
  S.saveGameRecord({mode:'bot',difficulty:'hard',winner:1,reason:'goal'});
  console.log('XP:', S.getProfile().xp, '| played:', S.getStats().played);
});
"
```

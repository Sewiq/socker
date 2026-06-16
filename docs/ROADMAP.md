# 🗺️ Roadmap — Piłkarzyki (socker)

Dokument planistyczny projektu. Opisuje kierunek rozwoju od wersji 0.2.0 do
multiplayera online, turniejów i monetyzacji. Towarzyszy `docs/STATUS.md`
(bieżący stan: co zrobione, co w toku).

> **Zasada przewodnia:** każda funkcja budowana tak, by nie trzeba jej było
> przepisywać na kolejnym etapie. Dane projektowane pod chmurę od pierwszego dnia,
> nawet gdy żyją lokalnie. UI niezależny od języka i źródła danych.

---

## Wizja docelowa

Piłkarzyki jako globalna, wielojęzyczna gra mobilna z:

- single player (hot-seat lokalny) — **jest**
- profilem gracza i statystykami — **najbliższa faza**
- multiplayerem **real-time 1v1** online — własny backend Node, serwer autorytatywny
- **turniejami mistrzów** — drabinki, rankingi (w tym krajowe), sezony
- kontem **premium** (brak reklam)
- „czymś ekstra" — *do przemyślenia*

---

## Roadmap w fazach

### FAZA 0 — Domknięcie 1.0 (single player) → publikacja w Play
**Cel:** apka żywa w Google Play, zegar closed testingu rusza.

Priorytet: **najpierw stabilne Play Store + reklamy**, multiplayer później.
Powód: closed testing (≥ 12 testerów × 14 dni) trzeba odbębnić niezależnie od
multiplayera — to zegar tykający w tle, więc uruchamiamy go najwcześniej.

W ramach 1.0 mieści się też najbliższa faza profilu + i18n (niżej), bo to
funkcje „do ludzi", a nie wymagające backendu.

Checklist publikacji (z README):
- [ ] Banner ad unit AdMob podmieniony, `isTesting: false` przed releasem
- [ ] UMP / zgoda RODO podpięta (`AdMob.requestConsentInfo()`) — wymóg EU
- [ ] Polityka prywatności + `app-ads.txt` na GitHub Pages
- [ ] Data Safety form wypełniony (ID reklamowe!)
- [ ] Ikony, feature graphic 1024×500, min. 2 screenshoty
- [ ] Target SDK ≥ 34
- [ ] **Closed testing odpalony z 12 testerami — JAK NAJWCZEŚNIEJ**

---

### FAZA 1 — Profil gracza + statystyki + wielojęzyczność  ⬅️ TERAZ
**Cel:** gracz ma tożsamość i progresję. Fundament pod multiplayer, premium i turnieje naraz.

Dane lokalnie (`localStorage`), ale **model zaprojektowany pod chmurę** —
późniejsza synchronizacja to dopisanie warstwy transportu, nie przepisywanie.

Szczegóły: sekcje „Model danych", „Awatary", „Wielojęzyczność" poniżej.

---

### FAZA 2 — Multiplayer real-time (1v1)
**Cel:** dwóch graczy gra ze sobą online, ruch widać natychmiast.

- Własny backend **Node** — pełna kontrola
- **Serwer autorytatywny** na WebSocket: każdy ruch walidowany po stronie
  serwera (krytyczne — inaczej ktoś zhakuje sobie gole)
- Przepływ: pokój/matchmaking → walidacja ruchu → broadcast do przeciwnika
- Reconnect po zerwaniu połączenia
- Kolejność: najpierw „graj ze znajomym po kodzie", potem losowy matchmaking
- Wymaga Fazy 1 (konto/tożsamość gracza) jako fundamentu

> Piłkarzyki są turowe i dyskretne — nie potrzeba synchronizacji 60 fps,
> tylko walidacji pojedynczych ruchów. To mocno upraszcza real-time.

---

### FAZA 3 — Konta & Ranking (rozszerzona)
**Cel:** trwała tożsamość, ranking globalny, monetyzacja premium + promo launchowe.

Pełny projekt techniczny: **[docs/PHASE3-DESIGN.md](PHASE3-DESIGN.md)** (~12 PR-ów).

Składniki (jeden zintegrowany blok — nie da się robić osobno):
- **Google Sign-In** + migracja anon → konto (bez utraty postępu)
- **PostgreSQL** + schemat `users`/`matches`/`ratings`/`promo_grants`/`purchases`
- **Ranking ELO** (K=24, tylko zalogowani vs zalogowani) + ranking krajowy
- **Anti-cheat 3-warstwowy** (strukturalny, heurystyczny, manualny audyt)
- **Premium** (Play Billing): brak reklam + kosmetyka, NIE pay-to-win
- **Promo top-100 → premium-forever** (po 2 mies. od startu, z manualnym audytem)
- **Drabinki turniejowe + sezony** (gdy ranking działa stabilnie)
- **Środowisko staging** (`staging.prostriker.online`) z osobną bazą

---

### FAZA 4 — Monetyzacja i „coś ekstra"
- **Premium** (brak reklam) — technicznie wpinalne już od Fazy 1 (nie wymaga multiplayera)
- „Coś ekstra" — *placeholder, do przemyślenia*

---

## Model danych (Faza 1) — projektowany pod chmurę

Trzy zasady przesądzające o bezbolesnej migracji do chmury:

1. **Każdy profil ma `id` (UUID)**, nie tylko nick. Nick bywa zmienny;
   UUID (`crypto.randomUUID()`) to stały klucz, lokalnie i w chmurze.
2. **Każdy mecz ma własny `id` i `timestamp` (ISO 8601, UTC)** — pozwala
   scalać historię z wielu urządzeń bez duplikatów i konfliktów kolejności.
3. **Statystyki są pochodną historii, nie źródłem prawdy** — przechowywane
   jako cache, ale liczone z listy meczów. Inaczej urządzenia rozjadą się w licznikach.

### PlayerProfile

```
PlayerProfile
├── id             UUID (stały, klucz pod chmurę)
├── nick           string
├── avatar         { type: "flag", country: "PL" }
├── language       "pl" | "en" | "de"
├── createdAt      ISO timestamp (UTC)
├── level / xp     pochodne, ale przechowywane
├── stats          { played, won, lost, winStreak, bestStreak, ... }
└── schemaVersion  liczba — KLUCZOWE dla przyszłych migracji
```

`schemaVersion` to jedna linijka teraz, która ratuje przy zmianie struktury —
kod wie, jak podnieść stare dane do nowego formatu zamiast się wywalić.

### GameRecord (historia gier — osobno)

```
GameRecord
├── id         UUID meczu
├── playedAt   ISO timestamp (UTC)
├── opponent   "local" | nick | (później) playerId
├── result     "win" | "loss"
├── duration   sekundy
└── meta        { rozmiar planszy, kto zaczynał, liczba ruchów, ... }
```

Statystyki w profilu **wyliczane z listy `GameRecord`**. XP/level to czysta
funkcja `f(historia)`.

### Warstwa zapisu — jeden punkt dostępu

Najważniejszy nawyk: **nie wołać `localStorage` z różnych miejsc gry.**
Jeden moduł `storage.js` z API: `getProfile()`, `saveGameRecord()`, `getStats()`…
Reszta gry rozmawia tylko z nim.

> Gdy przyjdzie chmura, podmieniasz **wnętrze tego jednego modułu**
> (localStorage → fetch do backendu z fallbackiem offline). Gra nie zauważy.
> Cała tajemnica migracji: gra nie wie *gdzie* są dane, wie tylko *jak je dostać*.

### XP / poziom

Zdefiniować prostą regułę od razu (np. +10 XP za mecz, +25 za wygraną,
level = próg z tabelki) i tuningować później. Lepiej trywialna reguła teraz
niż dorabianie progresji do istniejących danych.

---

## Awatary — flagi krajów

- Przechowuj **kod ISO 3166-1 alpha-2** (`"PL"`, `"DE"`, `"BR"`), nie ścieżkę
  do obrazka — stabilny, mały, łatwy do synchronizacji i grupowania w rankingach.
- Forma `{ type: "flag", country: "PL" }` zostawia furtkę na inne typy awatarów
  w przyszłości (np. `type: "badge"` za turnieje) bez przebudowy modelu.
- Render: **biblioteka SVG flag** (`flag-icons`) — spójny wygląd na każdym ekranie.
  (Emoji flag `🇵🇱` nie renderują się na Windows → krzaki w PWA na desktopie.)
- UX wyboru przy ~200 flagach: popularne/ostatnie na górze, wyszukiwarka po
  nazwie kraju, nazwa kraju obok flagi.

Bonus: flaga to gotowa podstawa pod **rankingi krajowe** w turniejach.

---

## Wielojęzyczność (i18n)

Wprowadzona **teraz**, gdy gra jest mała — kilka godzin zamiast tygodnia refaktoru później.

**Języki na start 1.0: PL + EN + DE.** Kolejne przez dodanie pliku JSON, bez dotykania kodu.

### Zasada: zero tekstu na sztywno

Żaden widoczny napis nie jest wpisany wprost w HTML/JS. Każdy tekst to klucz
przez funkcję `t()`.

```
www/i18n/
├── pl.json     ← { "menu.newGame": "Nowa gra", "stats.won": "Wygrane" }
├── en.json     ← { "menu.newGame": "New game", "stats.won": "Won" }
└── de.json     ← { "menu.newGame": "Neues Spiel", "stats.won": "Gewonnen" }
```

Moduł `i18n.js` ładuje właściwy plik i udostępnia `t(klucz)`. UI nie wie,
*w jakim* jest języku — wie tylko *jak poprosić o napis* (analogicznie do `storage.js`).

### Pułapki do ominięcia od razu

1. **Język jako pole profilu** (`language: "pl"`), domyślnie z `navigator.language`,
   nadpisywalny ręcznie. Synchronizuje się z profilem do chmury.
2. **Liczba mnoga ≠ konkatenacja.** PL ma 3 formy („1 mecz / 2 mecze / 5 meczów"),
   EN 2. Nie sklejać zdań — funkcja plural per język lub lekka biblioteka.
3. **Liczby i daty przez `Intl`** — formaty różnią się między krajami (masz to w przeglądarce za darmo).
4. **Klucze opisowe** (`menu.newGame`), nie tekstowe (`nowa_gra`) — przeżyją zmianę treści.

### Uwaga o niemieckim

Niemieckie słowa są długie („Ustawienia" → „Einstellungen", „Wygrane" →
„Gewonnene Spiele"). Projektuj UI elastycznie — przyciski rosnące z tekstem,
żadnych sztywnych szerokości liczonych na krótkie polskie słowa.

---

## Kolejność implementacji najbliższej fazy (1)

Tak, by na każdym kroku mieć coś działającego:

1. **`i18n.js` + pliki pl/en/de** — najpierw, bo całe nowe UI profilu od razu
   piszesz przez `t()`. Zacząć od wyniesienia istniejących tekstów gry.
2. **`storage.js`** — jeden punkt dostępu do danych; `PlayerProfile` z UUID
   i `schemaVersion`.
3. **Ekran profilu** — nick + wybór flagi (lista SVG, wyszukiwarka, popularne).
4. **`GameRecord` + zapis po meczu** — historia gier zaczyna się zbierać.
5. **Statystyki liczone z historii** + ekran statystyk.
6. **XP / level** — prosta reguła `f(historia)`, widoczny pasek/poziom w profilu.
7. Domknięcie checklisty Fazy 0 i wejście w closed testing.

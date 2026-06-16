# 🧭 Strategia produktu — ProStriker

Przemyślenia kierunkowe nad tematami zgłoszonymi do rozważenia: środowiska,
baza danych, newsy, konta premium/free, promocja rankingowa, języki.
To dokument decyzyjny — nie kod. Zadania operacyjne lądują w [BACKLOG.md](BACKLOG.md).

> TL;DR: większość tych tematów (ranking, premium, promocja top-100, cross-device)
> łączy się w **jeden blok: konta serwerowe + baza danych**. To jest następny
> duży kamień milowy (nazwijmy go **Faza 3 — Konta & Ranking**). Newsy i kolejne
> języki są niezależne i lżejsze.

---

## 1. Środowiska: dev / staging / produkcja

### Dziś
- **dev** — `npm run dev` (gra), `npm run landing` (strona), lokalny serwer MP. Wystarcza.
- **prod** — GitHub Pages (gra/strona) + VPS (serwer MP, wkrótce).

### Kiedy potrzebne staging
Staging (kopia produkcji do testów przed wypuszczeniem) staje się **konieczne
dopiero gdy wejdzie baza danych i płatności premium**. Powód: wtedy błędny deploy
= realne konsekwencje (utrata danych gracza, zepsute płatności, zafałszowany
ranking promo). Do tego momentu prod-only jest OK dla projektu tej wielkości.

### Rekomendowany model (gdy będzie DB)
```
main  ──▶ staging.prostriker.online   (auto-deploy z gałęzi main)
tag   ──▶ prostriker.online           (deploy tylko z otagowanej wersji)
```
- Osobny kontener serwera + **osobna baza** dla staging (nigdy nie testuj na danych prod).
- Konfiguracja przez `.env` per środowisko (`NODE_ENV`, `DATABASE_URL`, `ALLOWED_ORIGINS`).
- Na jednym VPS: dwa docker-compose (porty 3000 prod / 3001 staging) + dwie subdomeny w Nginx.
- `MP_SERVER_URL` w grze już parametryzowany → staging-build wskazuje staging-serwer.

**Decyzja:** prod-only teraz; staging wprowadzić **razem z bazą danych** (Faza 3).

---

## 2. Baza danych — czy potrzebna i na co

### Dziś (bez bazy)
- Serwer MP: stan w pamięci (pokoje znikają przy restarcie). OK dla samego grania.
- Klient: `localStorage` (profil, statystyki, historia) — **per urządzenie, lokalnie**.

### Co WYMUSZA bazę
| Funkcja | Dlaczego localStorage nie wystarcza |
|---|---|
| **Ranking globalny** (promo top-100!) | musi być wspólny dla wszystkich, serwerowy, trwały |
| **Konta premium** | flaga premium w localStorage = trywialne oszustwo; musi być po stronie serwera |
| **Cross-device** (ten sam profil na telefonie i w przeglądarce) | localStorage nie synchronizuje |
| **Historia gier online** | dziś nie zapisywana; ranking ELO potrzebuje trwałych wyników |
| **Anti-cheat** (promo) | wykrywanie smurfów wymaga serwerowej wiedzy o kontach/IP |

### Jaka baza
- **PostgreSQL** — relacyjna, dojrzała, darmowa, idealna pod użytkowników + ranking.
  Kontener w `docker-compose` na VPS (obok serwera MP).
- **Redis** (opcjonalnie później) — cache rankingu + kolejka matchmakingu + sesje. Nie na start.

### Szkic schematu (Faza 3)
```
users        (id UUID, google_sub, nick, country, premium_until|forever, created_at)
matches      (id, player_a, player_b, winner, mode, played_at, elo_delta)
ratings      (user_id, elo, games, wins, updated_at)   -- pochodna z matches
news_cache   (id, source, payload_json, fetched_at)    -- jeśli newsy (sekcja 3)
promo_grants (user_id, reason, granted_at)              -- np. 'top100_launch'
```

> Zasada z `storage.js` (zaprojektowany pod chmurę): podmieniamy **wnętrze**
> modułu (localStorage → fetch do API), gra się nie zmienia. To był plan od początku.

**Decyzja:** Postgres wchodzi **w momencie rankingu + premium** (czyli Faza 3,
wymuszona przez promo top-100). Do tego czasu — bez bazy.

---

## 3. Newsy piłkarskie (prawdziwe mecze) w aplikacji

### Wykonalne? Tak.
Darmowe/tanie API: **football-data.org** (darmowy tier, główne ligi),
**API-Football** (RapidAPI), **TheSportsDB** (darmowe). Zwracają wyniki, terminarze, tabele.

### Krytyczne uwagi
- **Klucz API NIGDY w kliencie.** Musi być serwerowy proxy: `serwer /news` →
  odpytuje API → cache (np. 5-15 min) → klient czyta z naszego serwera.
  Inaczej: klucz wykradziony + limity wyczerpane przez cudze requesty.
- **Limity darmowych tierów** (np. 10 req/min) → cache obowiązkowy.
- **Licencja treści** — sprawdzić ToS API pod kątem wyświetlania w apce z reklamami.
- **Wartość vs rozproszenie** — newsy to engagement hook, ale **luźno związany z grą**.
  Ryzyko: rozprasza od core'a (gra). Lepiej jako mały, opcjonalny widget niż główna sekcja.

### Lżejsze alternatywy
- „Ciekawostka piłkarska dnia" (statyczna baza ~365 ciekawostek, zero API, zero kosztów).
- Wyniki na żywo tylko jako subtelne tło/teaser, nie pełny portal.

**Decyzja:** dobry pomysł na retencję, ale **nie na MVP i nie przed rankingiem**.
Gdy wejdzie serwer+baza, dodać `/news` jako cache'owany proxy do darmowego API,
widget „mecze dnia" w grze. Priorytet 🟡. Najpierw zwaliduj czy gracze tego chcą.

---

## 4. Konta premium vs free

### Co różni premium (propozycja)
| | Free | Premium |
|---|---|---|
| Reklamy AdMob | ✅ banner | ❌ brak reklam |
| Gra (bot, 2p, online) | ✅ pełna | ✅ pełna |
| Motywy boiska / awatary | podstawowe | + ekskluzywne |
| Statystyki | podstawowe | + rozszerzone (wykresy, historia) |
| Odznaki / ranking | ✅ | ✅ + odznaka premium |

> **Zasada:** premium NIE może blokować core'a gry (to psuje opinie i retencję).
> Premium = wygoda + kosmetyka + brak reklam, nie „pay-to-win".

### Technicznie
- Flaga `premium_until` / `premium_forever` **po stronie serwera** (DB), nigdy localStorage.
- Wymaga: **konta** (auth) + **baza** + **Google Play Billing** (zakup w apce) +
  **weryfikacja zakupu po stronie serwera** (Play Developer API).
- Free dalej na AdMob (mamy). Premium wyłącza inicjalizację bannera.

**Decyzja:** premium to blok wymagający auth + DB + Play Billing. Wchodzi z Fazą 3.
Mechanizm „premium forever" musi istnieć **zanim** ruszy promo top-100 (sekcja 5).

---

## 5. Promocja: top-100 rankingu w 2 miesiące → premium na zawsze

Świetny growth-hook. Ale to **najbardziej wymagająca** rzecz z tej listy, bo łączy:
ranking + trwałe konta + anti-cheat + premium. Rozłóżmy ryzyka.

### Co jest potrzebne
1. **Ranking serwerowy** (ELO/punkty z gier online) → baza.
2. **Trwała tożsamość** — NIE localStorage UUID. Ktoś wyczyści dane/zmieni telefon
   i straci miejsce → wściekłość. Promo o realnej wartości **wymaga logowania**
   (Google Sign-In) żeby konto przetrwało.
3. **Okno czasowe** — data startu + deadline 2 miesiące. Po deadline: zamrozić
   top-100, nadać `premium_forever`.

### Ryzyka (poważne — bo nagroda jest realna)
- **Smurfing / self-play:** gracz tworzy 2 konta i przegrywa sam ze sobą, by nabić ranking.
  Mitygacja: ELO tylko za gry z **różnymi** przeciwnikami; wykrywanie tego samego
  IP/urządzenia po obu stronach; minimum N gier z minimum M różnymi graczami;
  ręczna weryfikacja top-100 przed nadaniem nagrody.
- **Boty/skrypty:** ktoś automatyzuje granie. Mitygacja: serwer autorytatywny (mamy),
  rate-limity, analiza wzorców (czas ruchu, idealność).
- **Cold start:** jak jest mało graczy, top-100 = „każdy kto zagra". To może być OK
  (nagroda za bycie early adopterem) — ale ustaw **minimum gier** by się kwalifikować
  (np. 20 meczów online), żeby nie rozdać premium za 1 grę.

### Mechanika (rekomendacja)
- Ogłoś promo **dopiero gdy infrastruktura gotowa** (ranking + konta + anti-abuse).
- Licz **od dnia publicznego startu** (nie od dziś).
- Wymóg kwalifikacji: zalogowane konto + min. 20 gier online z min. 10 różnymi graczami.
- Po 2 miesiącach: snapshot top-100 wg ELO → `premium_forever`. Ogłoś listę (flagi krajów!).

**Decyzja:** to definiuje **Fazę 3** jako jeden duży blok (auth + DB + ranking +
premium + anti-cheat). Promo nie może ruszyć wcześniej. Bez logowania promo jest
nie do obronienia (oszustwa). To dobra okazja, by wprowadzić Google Sign-In.

---

## 6. Języki: angielski domyślnie + ES / IT / PT / FR

### Zrobione teraz ✅
- **Domyślny język = angielski** (gra i strona). Detekcja nadal działa: przeglądarka
  PL/DE dostaje swój język, wszystko inne → EN. Zmiana w `i18n.js` (`DEFAULT_LANG="en"`)
  i w landingu.

### Dodanie ES / IT / PT / FR
System i18n jest na to gotowy — każdy język to **plik JSON + 1 wpis** w `LANGS`.
Kroki w [I18N.md](I18N.md). Dla każdego:
1. `www/i18n/{es,it,pt,fr}.json` (≈90 kluczy, tłumaczenie)
2. wpis w `i18n.js` `LANGS` + przycisk w selektorze ⚙
3. landing: dodać do inline-słownika + przycisk
4. `sw.js` cache + bump

> ⚠️ Selektor języka w ⚙ ma dziś 3 przyciski w jednym pasku. Przy 7 językach
> trzeba zmienić UI na **dropdown/listę z flagami** (nie 7 przycisków w rzędzie).
> To mała przebudowa — zaplanowana w backlogu.

**Decyzja:** EN-default teraz. ES/IT/PT/FR — w backlogu (🟡), do zrobienia partiami
gdy zdecydujesz. Tłumaczenia warto przejrzeć (jakość brandu) — mogę wygenerować
draft, Ty/native akceptuje.

---

## Synteza — co z czego wynika

```
       ┌─────────────────────────────────────────────┐
       │  FAZA 3 — Konta & Ranking (jeden blok)       │
       │  ┌────────────┐                               │
       │  │ Google     │   auth = trwała tożsamość     │
       │  │ Sign-In    │                               │
       │  └─────┬──────┘                               │
       │        ▼                                      │
       │  ┌────────────┐   przechowuje konta, ranking, │
       │  │ PostgreSQL │   premium, historię online    │
       │  └─────┬──────┘                               │
       │        ▼                                      │
       │  ┌────────────┐   ┌──────────┐  ┌───────────┐ │
       │  │ Ranking ELO│   │ Premium  │  │ Promo     │ │
       │  │ + anti-    │──▶│ free/paid│─▶│ top-100   │ │
       │  │ cheat      │   │ (Billing)│  │ forever   │ │
       │  └────────────┘   └──────────┘  └───────────┘ │
       │        ▲                                      │
       │   staging środowisko (bo teraz są realne dane)│
       └─────────────────────────────────────────────┘

   NIEZALEŻNE / lżejsze:
   • Newsy piłkarskie (proxy + cache) — po Fazie 3, 🟡
   • Języki ES/IT/PT/FR — w dowolnym momencie, 🟡
```

### Kolejność jaką rekomenduję
1. **Teraz / krótkoterminowo:** dokończyć Fazę 0-2 → publikacja w Play (bot, online lokalnie),
   deploy serwera na VPS. EN-default ✅.
2. **Faza 3 (duży blok):** Google Sign-In → Postgres → ranking ELO + anti-cheat →
   premium (Play Billing) → **dopiero wtedy** ogłosić promo top-100. Wprowadzić staging.
3. **Równolegle/po:** języki ES/IT/PT/FR, newsy (jeśli walidacja potwierdzi popyt).

> Najważniejsze: **nie ogłaszaj promo top-100 zanim nie ma logowania i anti-cheat.**
> Inaczej premium-forever rozejdzie się na oszustwach i podważy ekonomię gry.

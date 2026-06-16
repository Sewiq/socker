# 🏆 Faza 3 — Konta & Ranking · projekt techniczny

Pełny design bloku „Faza 3" zdefiniowanego w [STRATEGY.md](STRATEGY.md):
**Google Sign-In → PostgreSQL → ranking ELO + anti-cheat → premium (Play Billing) → promo top-100**.
Dokument jest mapą implementacyjną — każdą sekcję będziemy rozkładać na PR-y.

> Zasada przewodnia: **nic z tego nie idzie do produkcji w izolacji**. Promo top-100
> ma sens dopiero gdy auth + anti-cheat działają na produkcji. Premium ma sens
> dopiero gdy weryfikacja zakupów po stronie serwera działa. Kolejność wdrażania
> w sekcji „Plan PR-ów" na końcu.

---

## 0. Cele i metryki

**Co projektujemy:** trwałą tożsamość gracza, ranking globalny, monetyzację premium
oraz mechanikę promo (top-100 w 2 miesiące → premium-forever).

**Kryteria sukcesu (subiektywne, do uściślenia po danych):**
- 30%+ aktywnych graczy loguje się przez Google (reszta gra anonimowo)
- Mediana czasu od instalacji do 20 gier online: < 7 dni (ważne dla kwalifikacji promo)
- Liczba „przyłapanych" smurfów / liczba kont premium-forever: < 5%
- Konwersja na premium płatne po promo: 1-3% (rynek mobile casual)

---

## 1. Tożsamość — anon → Google Sign-In (z migracją)

### Stan dziś
- Każdy gracz dostaje **anonimowy UUID** w `storage.js` (`crypto.randomUUID()`).
- Statystyki i historia żyją w `localStorage` per urządzenie.
- W multiplayerze `playerId` to ten UUID — serwer trzyma go w RAM-ie pokoju.

### Stan docelowy
Trzy ścieżki użycia muszą współistnieć:

```
┌──────────┐    grasz dalej anonimowo;
│  ANON    │    statystyki lokalne;
│  (gość)  │    NIE liczy się do rankingu/promo
└────┬─────┘
     │ „Zaloguj się przez Google" (opcja, zachęcamy)
     ▼
┌──────────┐    konto serwerowe (Google sub jako klucz);
│ LOGGED   │    statystyki sync per urządzenie;
│ (Google) │    LICZY się do rankingu i promo
└────┬─────┘
     │ kupuje premium (lub dostaje za promo)
     ▼
┌──────────┐    brak reklam, ekskluzywne motywy,
│ PREMIUM  │    odznaka, rozszerzone statystyki
└──────────┘
```

### Krytyczne wymaganie: migracja anon → konto bez utraty danych
Gdy anonimowy gracz loguje się **pierwszy raz**, jego lokalna historia (z UUID anonimowego)
zostaje **podpięta pod nowe konto**. Inaczej ludzie nie zalogują się, bo „stracą postęp".

Realizacja:
1. `POST /v1/auth/google` z `{idToken, anonPlayerId, anonGames:[...]}` (max ostatnie N gier
   z metadata: timestamp, wynik, przeciwnik=local).
2. Serwer weryfikuje `idToken` przez Google tokeninfo, znajduje lub tworzy `users` po
   `google_sub`.
3. Jeśli to **pierwsze logowanie** tego konta — łączy `anonPlayerId` z `users.id`
   (zapisuje w `anon_links` żeby później wykryć ten sam telefon).
4. Anonimowe gry vs bot importujemy do `matches` z `account_user_id = NULL, anon_player_id = X`
   — żeby ranking miał pełną historię, ale gry vs bot nie wpływały na ELO.

> Anti-abuse: jeśli ten sam `anonPlayerId` próbuje się zalogować pod **różne**
> Google sub → tylko pierwszy się udaje (chronimy przed „odzyskaniem" cudzego konta).

### Token & sesja
- Klient dostaje **JWT session** z serwera po `auth/google` (TTL 7 dni, refresh przy każdym
  połączeniu WS). JWT zawiera `userId`, `premium`, `nick`, `country`.
- WS upgrade wymaga `Authorization: Bearer <jwt>` (lub anonimowy = bez headera).
- Klient trzyma JWT w `localStorage` + `Capacitor SecureStorage` na Androidzie.

### Zmiany w grze (klient)
- `storage.js`: dodaje `getAuth()`, `signInWithGoogle()`, `signOut()`. Reszta gry **nie wie**
  czy gracz jest anonimowy czy zalogowany — wszystko nadal idzie przez `storage.getProfile()`,
  tylko teraz może być asynchroniczne i ciągnąć z serwera.
- UI: w profilu nowy przycisk „Zaloguj się przez Google" → ekran kont.

---

## 2. Schemat bazy (PostgreSQL)

Jedyna baza, jeden schemat. Migracje przez prosty kompilator `drizzle` lub raw SQL w `server/migrations/NNN_*.sql`.

```sql
-- USERS: tożsamości serwerowe
CREATE TABLE users (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  google_sub       TEXT UNIQUE,                       -- z idToken Google
  email            TEXT,                              -- z idToken (opcjonalne)
  nick             TEXT NOT NULL,                     -- ustawialny po zalogowaniu
  country          CHAR(2),                           -- ISO 3166-1 alpha-2
  premium_until    TIMESTAMPTZ,                       -- NULL = brak; FAR_FUTURE = forever
  premium_source   TEXT,                              -- 'play_billing' | 'promo_top100' | NULL
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  last_seen_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  banned_at        TIMESTAMPTZ,                       -- soft ban (anti-cheat)
  ban_reason       TEXT
);
CREATE INDEX users_nick_lc ON users (lower(nick));

-- ANON_LINKS: anonimowe UUID-y, które kiedyś zalogowały się pod konto
CREATE TABLE anon_links (
  anon_player_id   UUID PRIMARY KEY,
  user_id          UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  linked_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- chroni przed „odzyskaniem" cudzego anon-konta innym Google

-- MATCHES: historia rozgrywek (źródło prawdy dla rankingu)
CREATE TABLE matches (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  played_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  mode             TEXT NOT NULL,                     -- 'online_1v1' | 'bot' | '2p_local'
  player_a_user    UUID REFERENCES users(id),         -- NULL jeśli anon lub bot
  player_a_anon    UUID,                              -- anon_player_id, jeśli nie ma konta
  player_b_user    UUID REFERENCES users(id),
  player_b_anon    UUID,
  winner_side      CHAR(1) NOT NULL,                  -- 'a' | 'b' | 'd' (draw, rzadkie)
  reason           TEXT NOT NULL,                     -- 'goal' | 'block' | 'forfeit'
  duration_sec     INT,
  moves_count      INT,
  elo_a_before     INT,                               -- snapshot dla audytu
  elo_b_before     INT,
  elo_delta_a      INT,                               -- liczone tylko dla online_1v1 oba=user
  elo_delta_b      INT,
  client_ip_a      INET,                              -- dla anti-cheat (porównanie IP)
  client_ip_b      INET,
  server_node      TEXT                               -- nazwa kontenera, gdy będzie >1 serwer
);
CREATE INDEX matches_user_a ON matches(player_a_user, played_at DESC);
CREATE INDEX matches_user_b ON matches(player_b_user, played_at DESC);

-- RATINGS: aktualne ELO (cache; źródło prawdy = przeliczenie z matches)
CREATE TABLE ratings (
  user_id          UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  elo              INT NOT NULL DEFAULT 1200,
  games            INT NOT NULL DEFAULT 0,
  wins             INT NOT NULL DEFAULT 0,
  losses           INT NOT NULL DEFAULT 0,
  best_streak      INT NOT NULL DEFAULT 0,
  unique_opponents INT NOT NULL DEFAULT 0,            -- ważne dla anti-cheat
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ratings_elo_desc ON ratings (elo DESC) WHERE games > 0;

-- PROMO: snapshot top-100 w finale promo + kto wygrał premium-forever
CREATE TABLE promo_grants (
  user_id          UUID PRIMARY KEY REFERENCES users(id),
  promo_code       TEXT NOT NULL,                     -- 'top100_launch'
  rank_at_snapshot INT NOT NULL,
  granted_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- PURCHASES: weryfikacje Play Billing
CREATE TABLE purchases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          UUID NOT NULL REFERENCES users(id),
  product_id       TEXT NOT NULL,                     -- np. 'premium_lifetime'
  play_token       TEXT NOT NULL UNIQUE,              -- purchaseToken z Play Billing
  state            TEXT NOT NULL,                     -- 'pending' | 'verified' | 'refunded' | 'failed'
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  verified_at      TIMESTAMPTZ,
  raw_response     JSONB                              -- pełna odpowiedź Play Developer API
);
```

**Decyzje:**
- **UUID** wszędzie zamiast SERIAL — bezpieczniej przy potencjalnej migracji multi-region.
- **`ratings` jako cache**, ale prawda w `matches` — można w każdej chwili odbudować.
- **Snapshot ELO w matchu** (`elo_*_before`) — dzięki temu zmiana wzoru ELO w przyszłości
  nie psuje historii.
- **`client_ip_*` w matchu** — anti-cheat. Po 90 dniach anonimizujemy (RODO).

### Migracje
Plik `server/migrations/001_init.sql` zawiera powyższe + `CREATE EXTENSION pgcrypto`. 
Skrypt `npm run db:migrate` w `socker-server` aplikuje pending migracje (lekki runner).

---

## 3. Ranking ELO

### Wybór: ELO z K=24 (start), bez kategorii czasowych

**Wzór** (standard, łatwy do wytłumaczenia):
```
expected_a = 1 / (1 + 10^((elo_b - elo_a) / 400))
new_elo_a  = elo_a + K * (score_a - expected_a)
   score_a = 1 (wygrana) | 0 (przegrana) | 0.5 (remis)
```

**K-factor** zależny od stażu (anti-camping):
- pierwsze 30 gier: K=40 (szybkie placement)
- 30-200 gier: K=24
- 200+: K=16
- Premium gracz NIE dostaje innego K (uczciwie).

**Co liczy się do ELO:**
- **Tylko** mecze `mode='online_1v1'` **gdzie OBA** strony to zalogowani userzy
  (NIE anon vs user, NIE bot, NIE 2p lokalnie). Powód: anti-smurf.

**Start ELO** dla nowego konta: 1200 (klasyk).

**Krajowy ranking** = filter `WHERE country = $X ORDER BY elo DESC` na materializowanym widoku.

### Implementacja serwerowa
Po zakończonym meczu serwer:
1. Loguje match w transakcji
2. Liczy `elo_delta_*` z aktualnego `ratings.elo`
3. Aktualizuje `ratings` obu graczy + `unique_opponents` (gdy nowy przeciwnik)
4. Emituje WS event `RATING_UPDATE` do obu klientów

Wszystko w 1 transakcji — albo cały mecz + ranking zapisane, albo nic.

---

## 4. Anti-cheat (priorytet KRYTYCZNY przed promo)

Nagroda premium-forever to realna wartość — ludzie będą próbować oszukiwać. Bez tego promo = katastrofa.

### Trzy warstwy obrony

**A) Strukturalne (zapobieganie smurfom)**
- ELO liczone tylko gdy obaj = zalogowani (już omówione)
- Kwalifikacja do promo: min. 20 gier online + **10 unikalnych przeciwników**
  (`ratings.unique_opponents >= 10`). Jedna osoba grająca z 2 kontami = max 1 unikalny przeciwnik między nimi.
- **Cooldown**: ten sam Google sub raz na 24h może się logować z max 2 różnych telefonów
  (zliczane przez User-Agent + IP /16). Próba szybkiego przełączania = blokada na 1h.

**B) Heurystyczne (wykrywanie wzorców)**
- **Same IP /24 po obu stronach** → flaga w matchu (`suspicious=true`), mecz NIE liczy się
  do ELO (ale jest w historii). Wyjątek: domowa sieć — wymagamy potwierdzenia mailem
  po 5 takich meczach.
- **Zbyt regularny czas ruchów** (std dev < 50ms przez 30 ruchów) = prawdopodobny bot
  → soft-ban + ręczne review.
- **Anomalia win-rate**: nowy user z win-rate > 95% w pierwszych 30 grach + przeciwnicy
  o niskim ELO = farmienie → flaga, premia ELO redukowana.

**C) Ręczne (audyt przed nagrodą promo)**
- W dniu zakończenia promo: top-150 (a nie top-100) → manualny przegląd:
  - lista meczów każdego, czy są suspicious flagi
  - mapa IP (Geo) — czy nie ma 5 kont z tej samej sieci
  - graf przeciwników — czy nie ma „farmy" (mała klika grająca tylko ze sobą)
- Dopiero top-100 z czystym audytem dostaje `promo_top100_launch`.

### Co JEŚLI ktoś już ma premium-forever a wyjdzie oszustwo?
`UPDATE users SET premium_until = NULL, banned_at = now(), ban_reason = 'cheat_promo'`.
Pokazujemy w UI komunikat „konto wstrzymane". Apelacja przez email.

### „Lekka anonimizacja" (RODO)
Po 90 dniach `matches.client_ip_*` zastępujemy NULL. Anti-cheat patrzy w czasie rzeczywistym,
nie potrzebuje IP po latach.

---

## 5. Premium — Play Billing

### Model
**`premium_lifetime`** — jednorazowy zakup (~99 zł), brak subskrypcji. Powód:
- subskrypcja ma większe MRR ale wyższą frykcję dla casual game
- promo daje premium-forever, więc lifetime jest spójny z mechaniką
- (możemy dodać też miesięczną subskrypcję później jako tańszą opcję)

### Co daje premium
1. **Brak reklam AdMob** (banner ukryty, no interstitial)
2. **Ekskluzywne motywy boiska** (3-5 do startu)
3. **Ekskluzywne flagi/awatary**
4. **Rozszerzone statystyki** (wykresy, historia całe życie, eksport CSV)
5. **Odznaka premium** widoczna przy nicku w rankingu/grze
6. **Priorytet w kolejce matchmaking** (kosmetyka, ledwo wpływa)

### Co premium NIE daje (świadomie)
- Lepsze nagrody w grze
- Mocniejszego bota
- Wpływu na ranking ELO
- Przyspieszenia awansu

> Zasada: premium = wygoda + kosmetyka. Nigdy pay-to-win.

### Flow zakupu (Android)
1. UI „Kup premium" → Capacitor plugin `@capacitor-community/in-app-purchases` lub własny bridge
2. Klient wywołuje Play Billing → user zatwierdza zakup
3. Klient otrzymuje `purchaseToken` + `productId`
4. Klient `POST /v1/billing/verify` z tokenem
5. Serwer woła **Google Play Developer API** (`purchases.products.get`) — weryfikacja
6. Jeśli OK → `users.premium_until = '9999-12-31'`, `premium_source = 'play_billing'`,
   zapisuje w `purchases`
7. `consumeAcknowledge` po stronie klienta (Play wymaga)
8. Klient odświeża JWT (nowy token zawiera `premium=true`)

### Klucze serwerowe
- Konto serwisowe Google Cloud z dostępem do Play Developer API
- `GOOGLE_SERVICE_ACCOUNT_JSON` w `.env` na VPS (nie commitowane, kopia w sejfie haseł)

### Refund handling
Cron raz dziennie odpytuje Play Developer API o subskrypcje/zakupy z ostatnich 30 dni
→ jeśli refund → `users.premium_until = NULL`, `purchases.state = 'refunded'`.

---

## 6. Promo top-100 → premium-forever

### Reguły (publiczne — będą na landingu)

> **Pierwszych 100 graczy w globalnym rankingu ELO na dzień XX.XX.2026 dostaje
> ProStriker Premium na zawsze. Promo trwa do 2 miesięcy od oficjalnej premiery.**

Pełne warunki (regulamin):
1. Musisz mieć **konto zalogowane przez Google** (anon = nie liczy się).
2. Min. **20 gier online 1v1** w okresie promo.
3. Min. **10 różnych przeciwników** (zliczane przez `ratings.unique_opponents`).
4. Brak naruszeń Regulaminu (anti-cheat flagi).
5. Top-100 = posortowane po `ratings.elo` (DESC), z kwalifikujących się.
6. Wynik ogłaszamy w ciągu 7 dni od zakończenia okna, po **manualnym audycie**.
7. ProStriker zastrzega prawo odmowy nagrody w przypadku potwierdzonego oszustwa.

### Implementacja
**Przed startem promo:**
- Konfiguracja w bazie: tabela `promo_config` (start_at, end_at, code, min_games, min_opponents)
- Endpoint `/v1/promo/current` zwraca aktualny stan, deadline, czy się kwalifikujesz

**W trakcie:**
- Landing page pokazuje **licznik dni** + „X z N graczy się kwalifikuje"
- W grze: w ekranie rankingu badge „PROMO ACTIVE — X dni do końca"
- Gracz po zalogowaniu widzi pasek progresu „Twoje gry: 7/20 | unikalni: 4/10"

**Po zakończeniu:**
1. **Snapshot**: `INSERT INTO promo_snapshots SELECT ... LIMIT 150` (150 dla bufora audytu)
2. **Audyt manualny** (sekcja 4C)
3. Top-100 z czystym audytem → `users.premium_until = '9999-12-31'`, `premium_source = 'promo_top100'`, `promo_grants` insert
4. **E-mail** do laureatów (z adresu z Google sub)
5. Lista zwycięzców publikowana na landingu (nick + flaga, bez maila)

### Etyczne ostrzeżenie
Jeśli zdecydujesz się **opóźnić** ogłoszenie promo aż wszystko będzie gotowe — to OK.
**Lepiej zacząć promo trzy miesiące po starcie z działającym anti-cheat niż na premierze
bez ochrony.** Sugeruję: premiera w Play → 2-4 tygodnie observation → ogłoszenie promo →
2 miesiące okno → nagroda.

---

## 7. UX: ekrany i flow

### Ekran logowania (nowy, w grze)
- W profilu (gdzie dziś nick+flaga): dodatkowo **„Zaloguj się przez Google"** dużym CTA
- Po kliknięciu: natywny dialog Google
- Po sukcesie: ekran „Witaj, X! Twoje dotychczasowe statystyki zostały zachowane."
- Dla anonimowych: subtelny baner „Zaloguj się żeby grać w rankingu" co N dni
  (nie nachalnie, bo wyłączamy gdy zignorują 2 razy)

### Ekran rankingu (nowy)
- Tab globalny / krajowy / znajomi (znajomi w Fazie 4)
- Lista top-100 z flagami, nickami, ELO, win-rate
- Twoje miejsce wyróżnione, **przy promo** pokazywany pasek kwalifikacji
- Filtr: ostatnie 7/30 dni / cały czas

### Ekran premium (nowy)
- Przed zakupem: lista korzyści + jednorazowa cena
- Po zakupie: **odznaka premium** w profilu + komunikat „Dziękujemy!"
- Jeśli premium z promo: badge „Top-100 Launch Champion 🏆"

### Multi-device sync (przy logowaniu)
- Klient po sign-in pobiera z serwera: profil (nick/flaga z DB nadpisuje lokalne),
  historię ostatnich 50 gier, ranking
- Konflikty (np. nick zmieniony na drugim urządzeniu): wygrywa nowszy timestamp

---

## 8. Bezpieczeństwo (poza anti-cheat)

- **Wszystkie endpointy HTTPS** (Nginx + Let's Encrypt, mamy w DEPLOY.md)
- **CORS**: tylko `https://prostriker.online` + `https://staging.prostriker.online`
- **Rate-limit**: 60 req/min per IP na `/v1/*`, 5 logowań/min per IP
- **JWT secret**: 256-bit losowy, rotowany co 6 mies. (stare tokeny ważne do TTL=7d)
- **PII (RODO)**:
  - `email` można usunąć na żądanie usera (DSAR) — usuwamy z `users`, ale historia zostaje
    z `user_id` (zanonimizowana)
  - IP w `matches` znika po 90 dniach (cron)
  - Polityka prywatności rozszerzona: „logowanie Google", „dane analityki", „przechowywanie historii"
- **Brak haseł** — Google jest jedynym providerem, nie trzymamy haseł

---

## 9. Środowiska — staging na VPS

Razem z bazą wprowadzamy **staging** na tym samym VPS:

```
prostriker.online            ── prod    (z gałęzi tagged: v1.0.0, v1.0.1, ...)
staging.prostriker.online    ── staging (z gałęzi main, auto-deploy on push)
```

**docker-compose** z dwoma serwisami (porty 3000/3001) + dwie bazy (`prostriker_prod`,
`prostriker_staging`) w jednym kontenerze Postgres ALBO osobne kontenery (czystsze).

**Nginx** dwa server-block z osobnymi cert Let's Encrypt.

**Zmienne `.env` per env:**
```
NODE_ENV=production
DATABASE_URL=postgres://app:***@localhost:5432/prostriker_prod
JWT_SECRET=***
GOOGLE_SERVICE_ACCOUNT_JSON=/run/secrets/play.json
ALLOWED_ORIGINS=https://prostriker.online
```

**Nigdy:**
- testy z produkcyjną bazą
- credentialów prod na staging (osobne klucze Google)
- promo „test" → snapshot na produkcji

---

## 10. Plan PR-ów (kolejność wdrażania)

Każdy PR ma konkretny zakres, da się go merge'ować osobno, niczego nie psuje na prod.

| # | PR | Zakres | Zależy od |
|---|---|---|---|
| 30 | **db-init** | Postgres docker w `socker-server`, migracje, `users`/`anon_links` tabele, `db:migrate` script | — |
| 31 | **auth-google** | Endpoint `/v1/auth/google`, weryfikacja idToken, JWT issuing, klient `signInWithGoogle()` w `storage.js` | 30 |
| 32 | **migration-anon** | Łączenie anon→user przy logowaniu, import historii gier | 31 |
| 33 | **matches-persist** | `matches` tabela + zapis każdej gry online (serwer); `mode='online_1v1'` zaczyna trafiać do DB | 30 |
| 34 | **rating-elo** | `ratings` tabela, wzór ELO, `RATING_UPDATE` event WS, podstawowe API `/v1/ranking/global` | 33 |
| 35 | **anti-cheat-1** | IP w matchu, flaga `suspicious`, `unique_opponents`, soft-ban wektor | 33 |
| 36 | **ui-ranking** | Ekran rankingu w grze (tab globalny + krajowy), badge ELO w profilu | 34 |
| 37 | **billing-android** | Capacitor in-app-purchases, endpoint `/v1/billing/verify`, `users.premium_until` | 31 |
| 38 | **premium-perks** | UI ukrywa reklamy, motywy boiska, odznaka, rozszerzone staty | 37 |
| 39 | **staging-env** | `staging.prostriker.online` + docker-compose + Nginx + osobna DB | 30 |
| 40 | **promo-engine** | `promo_config`, kwalifikacja w `/v1/promo/current`, pasek progresu | 34, 37 |
| 41 | **promo-snapshot** | Snapshot tool, audyt manualny, grant premium-forever, e-mail laureatów | 40, 35 |

Łącznie **~12 PR-ów**. Realistyczny czas: 6-10 sesji intensywnej pracy.

---

## 11. Open questions (do zdecydowania ze mną)

1. **Cena premium-lifetime** — proponuję 99 zł (~25 €). Sklep mobile: 19-149 zł to typowy zakres.
2. **Subskrypcja miesięczna** — robimy od razu (np. 9.99 zł/mc), czy tylko lifetime?
3. **Logowanie Apple** (kiedyś iOS) — projektujemy schemat tak żeby było łatwo dodać
   (`auth_providers` tabela zamiast `google_sub` w `users`)? Mała korekta schematu.
4. **Wiek**: COPPA/RODO kids — czy ograniczamy do 13+ (typowe), czy ogłaszamy „dla wszystkich"?
   Wpływa na to czy Google Sign-In wymaga rodzicielskiej zgody.
5. **Konta firmowe vs osobiste** — premium w wersji „rodzinna" (3 konta) później?
6. **Promo: data startu** — promocja od dnia publikacji w Play, czy od deklaracji „now active"?
   Druga opcja daje nam czas na obserwację po starcie.
7. **Komunikacja promo** — landing page hero („Pierwszych 100 graczy dostaje premium-forever")
   czy subtelny baner („Promo trwa, sprawdź regulamin")? Pierwsze przyciąga, drugie chroni
   przed lawiną oszustów na starcie.

---

## 12. Konsekwencje dla istniejących planów

- **Polityka prywatności** wymaga rozszerzenia (Google, IP, historia, e-mail). Plik
  `www/legal/privacy.html` — do edycji w PR 31.
- **Play Console Data Safety form** — przepisać sekcje (dochodzi logowanie + DB).
- **BUILD.md / NEXT-STEPS.md** — dochodzą zmienne env (`DATABASE_URL`, `GOOGLE_*`).
- **STORAGE.md** — adnotacja: po Fazie 3 niektóre dane idą do chmury (anon dalej lokalnie).
- **ROADMAP.md** — Faza 3 znacząco się rozrasta (z „turnieje + ranking ELO" do całego bloku).
- **MULTIPLAYER.md** — protokół dodaje ramki `AUTH`, `RATING_UPDATE`, `PROMO_INFO`.

---

*To jest plan. Każda sekcja może być uściślana w trakcie implementacji. Po Twojej
akceptacji ruszam od PR „db-init" (#30).*

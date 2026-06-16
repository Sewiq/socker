# Status projektu — Piłkarzyki na kartce

Aktualizacja: 16 czerwca 2026 · Wersja: **0.2.0**

> Bieżący stan. Plan kierunkowy projektu (fazy 0→4, multiplayer, turnieje, i18n):
> **[docs/ROADMAP.md](ROADMAP.md)**

---

## ✅ Zrobione

### Gra (silnik + UI)
- [x] Pełna logika rozgrywki (boisko 8×10, bramki 2 oczka, banda z odbiciami)
- [x] Wykrywanie golów, zablokowania, legalności ruchów
- [x] Cofnij ruch (historia stanów do 250)
- [x] Tryb **vs Bot** (3 poziomy: Łatwy / Średni / Trudny)
- [x] Tryb **2 graczy** na jednym ekranie
- [x] Modal końca gry z trofeum i przyciskiem Rewanż
- [x] Licznik wyniku osobno per tryb (zapisany w `localStorage`)
- [x] Wibracje (haptyka) — odbicie, gol, blokada
- [x] Cofnij + Nowa gra
- [x] Splash screen, ikony adaptive, kompaktowy UI z ⚙ dropdownem (PR #8)
- [x] Wersja widoczna w stopce (PR #9)

### Bot
- [x] Heurystyka kierunkowa (cel: dolna/górna bramka)
- [x] Wykorzystanie odbić (premia za łańcuchy)
- [x] Lookahead: czy przeciwnik strzeli gola po naszym ruchu (Średni)
- [x] Lookahead: czy MY mamy łańcuch wygrywający (Trudny)
- [x] Różne poziomy szumu losowego per trudność

### Web / PWA
- [x] `manifest.webmanifest` + ikony 192/512/maskable
- [x] Service Worker (offline po pierwszym otwarciu)
- [x] PWA instalowalna z przeglądarki
- [x] GitHub Pages: gra + polityka + `app-ads.txt` — wszystko live

### Android (Capacitor 8 + AdMob)
- [x] Pre-built `android/` scaffold w repo (klon + `npm install` + Run)
- [x] AdMob App ID + Banner unit ID wpięte
- [x] UMP consent flow (RODO/EU) — `requestConsentInfo` + `showConsentForm`
- [x] Przycisk "Ustawienia prywatności" w grze (reset zgody)
- [x] Splash + ikony launchera 56 wariantów (gęstości × orientacje × motyw)
- [x] APK debug zbudowany i przetestowany na fizycznym telefonie

### AdMob
- [x] Konto AdMob (Kynologic Sp. z o.o.)
- [x] Płatności skonfigurowane (próg 300 zł)
- [x] Aplikacja "Socker" zarejestrowana
- [x] Banner ad unit "Socker_baner" utworzony
- [x] Wiadomość GDPR opublikowana (polski + angielski)
- [x] Tryb testowy aktywny w kodzie (`AD_TESTING = true`)

### Wersjonowanie
- [x] Pojedyncze źródło: `package.json` → `0.2.0`
- [x] `scripts/sync-version.js` propaguje do build.gradle + UI
- [x] `versionCode` = `major*10000 + minor*100 + patch` (deterministyczny)
- [x] `npm version patch/minor/major` + automatyczny sync

### Faza 1 — fundamenty (ROADMAP)
- [x] **i18n** PL/EN/DE — `i18n.js` + JSON-y, selektor w ⚙, zmiana bez reloadu
- [x] **Kompaktowy UI** — topbar + ustawienia w ⚙ dropdownie, boisko dominuje
- [x] **`storage.js`** — jeden punkt dostępu, `PlayerProfile` (UUID, schemaVersion),
  `GameRecord` (historia), statystyki jako pochodna historii, XP/level, migracje
- [x] **Dev server** — `npm run dev` / `dev:lan` (iteracja w przeglądarce bez APK)
- [x] **Ekran profilu** — nick + wybór flagi (picker ~190 krajów, nazwy via
  `Intl.DisplayNames`, flagi emoji), badge poziomu + pasek XP
- [x] **Ekran statystyk** — wygrane/przegrane/skuteczność/serie, rozbicie per
  poziom bota, gole/blokady, reset — liczone z `GameRecord[]`
- [x] **XP/level w UI** — flaga w topbarze, pasek postępu w profilu
- [x] **Bot adaptacyjny (Auto)** — dopasowuje poziom do wyników gracza (rubber-band z historii `storage.js`)
- [ ] Mocniejszy bot (minimaks) — opcjonalnie
- [ ] Faza 2: multiplayer online

### Dokumentacja
- [x] `README.md` — przegląd projektu
- [x] `docs/BUILD.md` — build APK/AAB krok po kroku + częste błędy
- [x] `docs/ADMOB.md` — konfiguracja AdMob i UMP
- [x] `docs/PLAY-STORE-LISTING.md` — opisy PL, kategorie, Data Safety
- [x] `docs/STATUS.md` — ten plik

### Infrastruktura
- [x] Repo `sewiq/socker` (publiczne)
- [x] GitHub Pages na `main` (gra + polityka + app-ads.txt)
- [x] Branch `main` ustawiony jako default
- [x] Domena: `https://sewiq.github.io/socker/`

---

## 🚧 W trakcie

### Build AAB do Play
- [ ] Naprawić problem z JAVA_HOME / JDK dla `gradlew bundleRelease`
- [ ] Wygenerować keystore (`pilkarzyki.keystore`) i zapisać w sejfie
- [ ] Skonfigurować signing w `android/app/build.gradle` + `keystore.properties`
- [ ] Pierwszy AAB release

### Trwałe fixy w repo (zamiast ręcznych sed-ów)
Te zmiany są lokalnie u Sewiqa ale nie w repo:
- [ ] `proguard-android.txt` → `proguard-android-optimize.txt` w `android/app/build.gradle` (PR #7 czeka na merge)
- [ ] `@mipmap/ic_launcher_background` → `@drawable/...` w mipmap-anydpi-v26 XML
- [ ] `patch-package` dla pluginów node_modules (np. admob też wymaga `proguard-optimize`)

### Kompaktowy UI (PR #8) i wersjonowanie (PR #9)
- [ ] Merge PR #8 (compact topbar)
- [ ] Merge PR #9 (versioning)

---

## 📋 W planach — przed publikacją w Play Store

### Materiały do Play Console
- [ ] **Screenshoty** (min. 2, rekomendowane 4-6) — z telefonu, w pionie, 1080×2400
  - Ekran startowy (boisko + kropki + piłka w środku)
  - Środek rozgrywki (linie + odbicie)
  - Modal końca gry ("🏆 Wygrana!")
  - Panel z ustawieniami (⚙ otwarte)
- [ ] **Feature graphic 1024×500** — już mam (`www/icons/feature-graphic.png`)
- [ ] **Ikona Play Store 512×512** — już mam (`www/icons/icon-playstore-512.png`)

### Play Console
- [ ] Założenie konta deweloperskiego ($25 jednorazowo)
- [ ] Utworzenie aplikacji "Piłkarzyki na kartce" w panelu
- [ ] Main store listing — copy-paste z `docs/PLAY-STORE-LISTING.md`
- [ ] Ankieta klasyfikacji wiekowej (IARC → PEGI 3)
- [ ] Sekcja Bezpieczeństwo danych (deklaracja AdMob)
- [ ] Polityka prywatności URL: `https://sewiq.github.io/socker/www/legal/privacy.html`
- [ ] Przełączenie `AD_TESTING = false` przed release
- [ ] Upload AAB do **Internal testing**
- [ ] **Closed testing** — wymóg 12 testerów × 14 dni dla nowych deweloperów
- [ ] **Production** release

---

## 💡 Pomysły na po-publikacji (priorytetyzowane)

### Wysokie priority — wpływają na retencję

1. **Mocniejszy bot** — minimaks α-β z przeszukiwaniem całych tur (z łańcuchami odbić), poziom Ekspert
2. **Statystyki gracza** — wygrane/przegrane vs każdy poziom bota, najdłuższe odbicie, średnia długość gry
3. **Animacja rysowania linii** — zamiast pojawiania się — krótka animacja "rysowania ołówkiem"
4. **Dźwięki** — krótkie "ołówek po kartce" przy ruchu, "gwizdek" przy golu (z możliwością wyciszenia)

### Średnie priority — UX polerka

5. **Ciemny motyw** — "kartka w nocy" (papier ciemnoszary, granat zamiast niebieskiego)
6. **Tutorial dla nowych** — 3 ekrany ze swipem przy pierwszym uruchomieniu
7. **Mała plansza** 6×8 dla szybkich rozgrywek (1-2 min)
8. **Pasek postępu odbicia** — pokazuj ile odbić z rzędu zrobiłeś w jednej turze
9. **Easter egg**: po 10 wygranych z Trudnym → nowy poziom "Mistrz"

### Niskie priority — fancy

10. **Tablica wyników rodzinna** — w trybie 2p zapamiętuj nazwy graczy i ranking
11. **Eksport gry** — share PDF z całą rozegraną partią (do wysłania znajomemu)
12. **Tematy boiska** — klasyczny / kratka w linie / blank (jak prawdziwa kartka A4)

---

## 🌐 Pomysł na przyszłość: Online multiplayer / turnieje

**Status:** szkic koncepcji, do realizacji **po starcie w Play Store** i pierwszych 100+ instalacjach (jako walidacja że jest popyt).

### Trzy poziomy ambicji
- **A) Random match 1v1** — system matchmakingu (chcesz grać → czekasz → trafiasz z kimś)
- **B) Pokoje z linkiem** — utwórz pokój, podziel się kodem/linkiem ze znajomym
- **C) Turnieje** — drabinka, zapisy, ranking ELO

### Architektura (szkicowa)
```
Telefon ←→ Serwer Node + Socket.IO ←→ Telefon
                  │
                  ▼
              Postgres (Supabase free)
```

### Stack proponowany
| Komponent | Wybór | Powód |
|---|---|---|
| Backend | Node.js + Socket.IO (TypeScript) | Reużycie kodu z frontu, popularne |
| Hosting | Fly.io / Render (free tier) | 0 zł na start |
| Baza | Supabase Postgres (free) | Auth + baza w jednym |
| Auth | Anonymous UUID + opcjonalnie Google Sign-In | Niski tarcie |
| Protokół | WebSocket (Socket.IO) | Realtime <50ms |

### Kluczowe wyzwania
- **Spójność stanu** — kto jest źródłem prawdy o stanie planszy
- **Lag compensation** — co jeśli gracz traci sygnał w połowie ruchu
- **Anti-cheat** — co jeśli ktoś zmodyfikuje JS i pośle nielegalny ruch
- **Polityka prywatności** — rozszerzyć o zbieranie nicków, wyników, IP
- **AdMob** — zmienić strategię (interstitial między rundami zamiast banner ciągle)

### Szacunkowy nakład pracy
- Random match 1v1: 2-3 sesje
- Pokoje z linkiem: +1 sesja
- Ranking ELO: +1 sesja
- Turnieje: +2-3 sesje

---

## 🐛 Znane problemy / dług techniczny

- [ ] **Plugin AdMob ma `proguard-android.txt`** zamiast `-optimize` (workaround przez `sed` w node_modules) → zgłosić do upstream lub `patch-package`
- [ ] **AGP 9 ostrzeżenia** o `excludeLibraryComponentsFromConstraints` — kosmetyka, można wyciszyć w `gradle.properties`
- [ ] **`build.gradle` Capacitora ma niezgodność z AGP 9** (line 22, proguard) — fix lokalnie, PR #7 zrobi to w repo
- [ ] **`mipmap/ic_launcher_background` → drawable** — fix lokalnie, do dorzucenia w PR-ze
- [ ] **`gradle.properties` nie ma `org.gradle.java.home`** — przez to `bundleRelease` nie znajduje JDK na niektórych konfigach

---

## 📊 Snapshot — co działa, gdzie

| Co | URL / lokalizacja |
|---|---|
| Gra w przeglądarce | https://sewiq.github.io/socker/ |
| Polityka prywatności | https://sewiq.github.io/socker/www/legal/privacy.html |
| app-ads.txt | https://sewiq.github.io/socker/app-ads.txt |
| Repo źródeł | https://github.com/Sewiq/socker |
| Feature graphic | `www/icons/feature-graphic.png` |
| APK testowy | (lokalnie u Sewiqa, zainstalowany na telefonie) |
| AAB do Play | jeszcze nie zbudowany |
| Konto Play Console | jeszcze nie założone |

---

*Plik aktualizowany ręcznie. Po większych zmianach edytuj sekcję "Zrobione" i "W planach".*

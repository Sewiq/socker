# 📋 Backlog — lista zadań do zrobienia

Centralna lista pomysłów i zadań. Aktualny stan tego co GOTOWE: [STATUS.md](STATUS.md).
Kierunek strategiczny: [ROADMAP.md](ROADMAP.md).

Legenda priorytetów: 🔴 wysoki · 🟡 średni · 🟢 niski (nice-to-have)

---

## 🌐 Landing page (prostriker.online)

- [ ] 🟡 **Sekcja „Jak grać" z animowanym GIF-em rozgrywki** — zamiast statycznych
      screenów krótki, zapętlony GIF/WebM pokazujący ruch piłki, odbicie i gola.
      Generacja: nagranie rozgrywki przez Playwright → ffmpeg do GIF/WebM (lekki, <2 MB).
- [ ] 🟡 **Licznik graczy online** — „X osób gra teraz" na landingu. Wymaga endpointu
      na serwerze (`/stats` zwraca liczbę aktywnych pokoi/graczy) + fetch z landingu
      co ~30s. Dostępne dopiero po deployu serwera na VPS.
- [ ] 🟡 **Przycisk „Zainstaluj jako apkę" (PWA install)** — przechwycenie zdarzenia
      `beforeinstallprompt`, własny przycisk „Zainstaluj" na landingu i w grze
      (zamiast polegać na natywnym bannerze przeglądarki). Pokazywać tylko gdy
      instalacja możliwa i apka jeszcze niezainstalowana.

---

## 🚀 Deploy / infrastruktura

- [ ] 🔴 **Deploy serwera + gry na VPS** pod `prostriker.online` — wg [DEPLOY.md](DEPLOY.md)
      (DNS, Docker, Nginx, Certbot HTTPS, reverse proxy `/ws`).
- [ ] 🔴 **Aktualizacja app-ads.txt URL w AdMob** na `https://prostriker.online/` po deployu.
- [ ] 🟡 **Healthcheck zewnętrzny** (UptimeRobot) na `/health`.

---

## 📱 Android / Play Store

- [ ] 🔴 **Naprawić build AAB** — `bundleRelease` wywala się na detekcji JDK
      (kolizja `HOST` w conda). Rozwiązanie: JDK 17 + `org.gradle.java.home`
      w `gradle.properties` (patrz [NEXT-STEPS.md](NEXT-STEPS.md) krok D).
- [ ] 🔴 **Keystore produkcyjny** + signing config + pierwszy AAB.
- [ ] 🟡 **Rename Capacitor `appId`** `com.tchorzewski.pilkarzyki` → `online.prostriker.app`
      PRZED pierwszym wgraniem AAB (po publikacji już się nie da zmienić).
      Wymaga rename struktury folderów Java w `android/`.
- [ ] 🔴 **Wyłączyć tryb testowy AdMob** (`AD_TESTING=false`) przed release.
- [ ] 🔴 **Konto Play Console** ($25) + listing (gotowy w [PLAY-STORE-LISTING.md](PLAY-STORE-LISTING.md)).
- [ ] 🔴 **Screenshoty do Play** z prawdziwego buildu (mamy już z landingu — można reużyć).
- [ ] 🔴 **Closed testing** — 12 testerów × 14 dni (zegar tyka, uruchomić wcześnie).

---

## 🎮 Multiplayer — dopracowanie

- [ ] 🟡 **Reconnect po zerwaniu** — klient wysyła `HELLO` z tym samym `playerId`
      (UUID profilu), serwer przywraca do pokoju jeśli przeciwnik czeka.
- [ ] 🟡 **Zapis wyników online do statystyk** — obecnie gry online nie liczą się
      do `storage` (flaga `recorded=true`). Dodać osobną kategorię staty „online".
- [ ] 🟢 **Czat w grze** (emoji/szybkie reakcje) — protokół łatwo rozszerzyć.
- [ ] 🟢 **Wskaźnik pingu / „przeciwnik się rozłączył, czekam 60s"**.

---

## 🤖 Gra / rozgrywka

- [ ] 🟢 **Mocniejszy bot (minimaks α-β)** — poziom „Ekspert" z przeszukiwaniem
      całych tur (łańcuchy odbić).
- [ ] 🟢 **Animacja rysowania linii** — „ołówek po kartce" zamiast pojawiania się.
- [ ] 🟢 **Dźwięki** — ołówek przy ruchu, gwizdek przy golu (z wyciszeniem).
- [ ] 🟢 **Ciemny motyw** — „kartka w nocy".
- [ ] 🟢 **Tutorial dla nowych** — 3 ekrany przy pierwszym uruchomieniu.
- [ ] 🟢 **Mała plansza 6×8** — szybkie rozgrywki 1-2 min.

---

## 🏆 Faza 3 — turnieje (przyszłość)

- [ ] 🟢 **Ranking ELO** + rankingi krajowe (flaga z profilu = gotowa podstawa).
- [ ] 🟢 **Drabinki turniejowe**, sezony.
- [ ] 🟢 **Persystencja (Postgres)** — pierwszy moment gdy in-memory serwera nie wystarczy.

---

## 🐛 Dług techniczny

- [ ] 🟡 **`patch-package` dla pluginu AdMob** — `proguard-android.txt` → `-optimize`
      (teraz ręczny `sed` po każdym `npm install`).
- [ ] 🟢 **Wyciszyć ostrzeżenia AGP 9** w `gradle.properties`.
- [ ] 🟢 **`org.gradle.java.home` w `gradle.properties`** — żeby `bundleRelease`
      nie zależał od zmiennej `HOST`/conda.

---

*Dodawaj nowe pomysły tutaj. Po zrobieniu — przenieś do „Zrobione" w [STATUS.md](STATUS.md).*

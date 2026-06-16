# ⚽ Piłkarzyki — Android (Capacitor + AdMob)

Mobilna wersja papierowej gry "piłkarzyki na kartce", przeznaczona do sklepu Google Play.
Gra jest darmowa i wyświetla reklamy Google AdMob (banner u dołu, opcjonalny interstitial).

📊 **[Status projektu — co zrobione, co w planach →](docs/STATUS.md)**
🗺️ **[Roadmap →](docs/ROADMAP.md)** · 🌐 **[i18n →](docs/I18N.md)** · 💾 **[Dane →](docs/STORAGE.md)** · 🎮 **[Multiplayer →](docs/MULTIPLAYER.md)** · 🖥️ **[Serwer (socker-server)](https://github.com/Sewiq/socker-server)**
⚡ **[Iteracja w przeglądarce — `npm run dev` →](docs/DEV.md)** · 📋 **[Pull → AAB →](docs/NEXT-STEPS.md)**

Cały silnik gry żyje w `www/` jako zwykła PWA (HTML/CSS/JS, bez bibliotek).
**Capacitor** opakowuje to w natywne APK/AAB, a plugin
[`@capacitor-community/admob`](https://github.com/capacitor-community/admob) podpina AdMob.

---

## Struktura

```
socker/
├── www/                         ← gra (PWA — działa też w przeglądarce)
│   ├── index.html
│   ├── manifest.webmanifest
│   ├── sw.js
│   └── icons/                   ← ikony (192, 512, maskable)
├── package.json                 ← zależności Capacitora + AdMob
├── capacitor.config.json        ← appId, splash, AdMob
└── android/                     ← generowany przez `cap add android` (nie commitowany w całości)
```

---

## Pierwsze uruchomienie (jednorazowo, lokalnie)

Wymagania: **Node 18+**, **Java 17**, **Android Studio** (z Android SDK + Platform Tools).

```bash
# 1. instalacja zależności JS
npm install

# 2. dodanie platformy Android (utworzy katalog android/)
npx cap add android

# 3. kopiowanie www/ do natywnego projektu
npx cap sync

# 4. otwarcie w Android Studio (debug / emulator / urządzenie)
npx cap open android
```

W Android Studio: zielony "Run" odpala apkę na podłączonym telefonie lub emulatorze.

---

## AdMob — konfiguracja

**App ID Piłkarzyków:** `ca-app-pub-9793821286854398~4316124888`

Pełna instrukcja krok po kroku: [`docs/ADMOB.md`](docs/ADMOB.md). W skrócie:

1. W `android/app/src/main/AndroidManifest.xml` (powstaje po `cap add android`) dodaj wewnątrz `<application>`:

   ```xml
   <meta-data
       android:name="com.google.android.gms.ads.APPLICATION_ID"
       android:value="ca-app-pub-9793821286854398~4316124888"/>
   ```

2. W panelu AdMob utwórz **banner ad unit** dla apki „Piłkarzyki" → dostaniesz `ca-app-pub-9793821286854398/XXXXXXXXXX` → podmień stałą `AD_UNIT_BANNER` w `www/index.html`.
3. Przed publikacją: `isTesting: false` w `www/index.html` i `"initializeForTesting": false` w `capacitor.config.json`.
4. **RODO / EU:** podepnij UMP (User Messaging Platform) — `AdMob.requestConsentInfo()` w pluginie.

> Reklamy testowe ZAWSZE używaj na czas developmentu — klikanie własnych prawdziwych reklam = blokada konta AdMob.

---

## Budowa wersji do Play Store (AAB)

```bash
# 1. wygeneruj keystore (raz, trzymaj go bezpiecznie!)
keytool -genkey -v -keystore pilkarzyki.keystore -alias pilkarzyki \
    -keyalg RSA -keysize 2048 -validity 10000

# 2. dane podpisu w android/keystore.properties (nie commituj!)
# storeFile=../../pilkarzyki.keystore
# storePassword=...
# keyAlias=pilkarzyki
# keyPassword=...

# 3. bundle
npm run bundle:android
# wynik: android/app/build/outputs/bundle/release/app-release.aab
```

Ten plik `.aab` wgrywasz do Google Play Console.

---

## Ikony i splash

Master źródłowy: `www/icons/icon.svg`, `www/icons/icon-maskable.svg`, `www/icons/splash.svg`.
Wygenerowane PNG-i (cairosvg → `python3 scripts/build-icons.py` lub jednorazowo z palca):

- `icon-192.png`, `icon-512.png` — PWA + Android adaptive
- `icon-maskable-512.png` — Android maskable (cała grafika w safe zone 80%)
- `icon-playstore-512.png` — wymagana ikona hi-res przy publikacji w Play
- `splash-2732.png` — splash screen Capacitora (kwadrat, wycinany do różnych ekranów)

Przy zmianie wyglądu — edytuj SVG, przerasteryzuj, podmień PNG-i.

## Polityka prywatności i app-ads.txt

- `www/legal/privacy.html` — szablon polityki (wymagany przez Play przy reklamach).
- `www/app-ads.txt` — placeholder; podmień `pub-XXXXXXXXXXXXXXXX` na własny ID z AdMob → Account.

Po wrzuceniu repo na GitHub Pages (Settings → Pages → Source: `main` / root) oba pliki
dostępne pod `https://sewiq.github.io/socker/legal/privacy.html` i `…/app-ads.txt`.
Te URL-e wklejasz do Play Console (Privacy Policy) i AdMob (Developer site).

## Wymagania Google Play (krótka lista)

- [ ] Konto Play Console ($25 jednorazowo)
- [ ] Polityka prywatności (publiczny URL — np. GitHub Pages)
- [ ] `app-ads.txt` na hostingu (potwierdzenie dla AdMob)
- [ ] Ikona 512×512, feature graphic 1024×500, min. 2 screenshoty
- [ ] Wypełniona Data Safety form (zbierane dane, ID reklamowe)
- [ ] Target SDK ≥ 34 (aktualny wymóg Play, listopad 2024+)
- [ ] Test zamknięty (closed testing) z ≥ 12 testerami × 14 dni — wymóg dla nowych deweloperów

---

## Reguły gry

Patrz `www/index.html` (sekcja "Zasady" w UI). W skrócie:

1. Jedna linia na turę — prosto lub na skos do sąsiedniej kropki.
2. Linii nie powtarzasz, po bandzie nie jedziesz.
3. Koniec na zajętej kropce lub bandzie → odbicie, grasz dalej.
4. Gol = wygrana. Brak ruchu = przegrana.

---

*Projekt prywatny. Licencja: do ustalenia przed publikacją.*

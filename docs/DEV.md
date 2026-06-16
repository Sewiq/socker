# Iteracja w przeglądarce — bez kompilowania APK

Gra to PWA — działa 1:1 w przeglądarce dla wszystkiego oprócz natywnych pluginów
(AdMob banner, haptyka, UMP, splash screen). Te ostatnie są ukryte za
`isNativePlatform()` i po prostu się nie aktywują w przeglądarce.

**95% pracy nad grą robisz tu**, APK budujesz tylko żeby przetestować reklamy
i wibracje przed releasem.

---

## Najszybszy start

```bash
npm run dev
# otwórz http://localhost:8765 w Chrome
```

Edytujesz `www/index.html` / `www/i18n/*.json` / `www/sw.js` → **Ctrl+R** w przeglądarce → widzisz zmiany. Brak kompilacji, brak Android Studio.

`Cache-Control: no-store` w dev serwerze gwarantuje że nigdy nie złapiesz starej wersji.

## Tryb telefonu w przeglądarce

W Chrome:
1. **F12** → **Device toolbar** (`Ctrl+Shift+M`)
2. Wybierz **Pixel 7** (lub inny)
3. Symulujesz dotykiem-myszką

To Twój główny dev environment.

## Z telefonu w tej samej Wi-Fi

```bash
npm run dev:lan
```

Pokaże adresy IP w sieci lokalnej, np. `http://192.168.1.42:8765`. Wpisz na telefonie w Chrome — gra działa. Service worker zacache'uje pierwszą wizytę.

> Działa też w trybie offline (PWA install na Androidzie: 3 kropki → "Dodaj do ekranu głównego" → uruchamia jak natywna apka).

## Co testujesz gdzie

| Funkcja | Browser | Telefon (APK) |
|---|---|---|
| Logika gry, plansza, bot | ✅ | ✅ |
| i18n (PL/EN/DE) | ✅ | ✅ |
| Wynik łączny (localStorage) | ✅ | ✅ |
| Modal końca, rewanż | ✅ | ✅ |
| Cofnij | ✅ | ✅ |
| Service worker (offline) | ✅ | ✅ |
| **Banner AdMob** | ❌ ukryte | ✅ |
| **Wibracje przy odbiciu** | ❌ | ✅ |
| **UMP consent (RODO)** | ❌ | ✅ |
| **Splash screen** | ❌ | ✅ |

W konsoli Chrome zobaczysz `console.warn("AdMob init failed")` — to OK, plugin nie istnieje w przeglądarce.

## Pełna lista skryptów npm

```bash
npm run dev               # serwer dev (localhost:8765)
npm run dev:lan           # serwer dev otwarty na sieć Wi-Fi (telefon)
npm run version:sync      # propaguj wersję z package.json → build.gradle + version.js
npm run build:android     # APK release
npm run bundle:android    # AAB do Play Store
npm version patch         # bump 0.2.0 → 0.2.1 (auto-sync + commit)
```

## Live reload dla Capacitora (opcjonalnie, do testowania reklam na fizycznym telefonie)

Jeśli kiedyś będziesz iterować nad AdMobem na żywym telefonie bez przebudowywania APK:

```bash
npx cap run android -l --external
```

Telefon podłączony USB-debugging → apka tam odpalona ładuje `www/` przez sieć z Twojego komputera. Edycja w `www/` → odświeżenie w apce → widzisz baner od razu, ale bez czekania na Gradle.

Wymaga: telefon i komputer w tej samej Wi-Fi, USB debugging włączone.

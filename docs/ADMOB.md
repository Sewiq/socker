# AdMob — konfiguracja dla aplikacji „Piłkarzyki"

## App ID (publisher)

```
ca-app-pub-9793821286854398~4316124888
```

Ten ID jest publiczny — nie jest sekretem. Jest wymagany do zadeklarowania
w `AndroidManifest.xml` po wygenerowaniu projektu Android przez Capacitor.

## Krok 1 — po `npx cap add android`

Otwórz `android/app/src/main/AndroidManifest.xml` i wewnątrz znacznika
`<application ...>` dodaj:

```xml
<meta-data
    android:name="com.google.android.gms.ads.APPLICATION_ID"
    android:value="ca-app-pub-9793821286854398~4316124888"/>
```

Bez tego SDK AdMoba **wyrzuci wyjątek przy starcie aplikacji** (znany błąd Google).

## Krok 2 — ad unit (banner)

W panelu [AdMob](https://admob.google.com) → Apps → „Piłkarzyki" → **Ad units** →
**Create Ad Unit** → **Banner** → nazwij np. „Main banner" → zapisz.

Dostaniesz ID w formacie:

```
ca-app-pub-9793821286854398/XXXXXXXXXX
```

Wklej go w `www/index.html`, podmieniając stałą `AD_UNIT_BANNER`
(obecnie zawiera testowe ID Google `ca-app-pub-3940256099942544/6300978111`).

## Krok 3 — wyłącz tryb testowy przed publikacją

W `www/index.html` (parametr `isTesting: true`) i `capacitor.config.json`
(`"initializeForTesting": true`) ustaw **false** dopiero przy buildzie produkcyjnym.

> ⚠️ NIGDY nie klikaj własnych prawdziwych reklam ani nie publikuj apki z testowym ID.
> Klikanie własnych = blokada konta AdMob bez ostrzeżenia.

## Krok 4 — app-ads.txt

Plik `www/app-ads.txt` jest już z Twoim pub-ID. Po włączeniu GitHub Pages
będzie pod `https://sewiq.github.io/socker/app-ads.txt` — ten URL wpisujesz
w Play Console jako „Developer site".

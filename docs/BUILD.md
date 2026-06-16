# Build aplikacji „Piłkarzyki" na Androida

Cały szkielet Capacitora jest już w repo (`android/`, ikony, splash, AdMob meta-data).
Możesz pominąć `npx cap add android` — zrobione.

---

## 1. Wymagania na komputerze

| Narzędzie | Wersja | Skąd |
|---|---|---|
| Node.js | 18+ (testowane na 22) | https://nodejs.org |
| Java JDK | 17 lub 21 | https://adoptium.net |
| Android Studio | 2024.1+ (Koala) | https://developer.android.com/studio |
| Android SDK | API 34 + Build Tools 34 | instaluje się przez Android Studio |

W Android Studio przy pierwszym uruchomieniu **SDK Manager** zaciągnie API 34, Build-Tools 34, Platform-Tools, emulator. Bez tego `./gradlew` rzuci „SDK location not found".

---

## 2. Klon + zależności (jednorazowo)

```bash
git clone https://github.com/Sewiq/socker.git
cd socker
npm install
```

Po `npm install` zobaczysz katalog `node_modules/` (ignorowany przez git).

---

## 3. Uruchom w Android Studio

```bash
npx cap sync         # kopiuje www/ do android/app/src/main/assets/public/
npx cap open android # otwiera Android Studio
```

W Android Studio:

1. **Gradle sync** ruszy sam (status na dole). Pierwszy raz może trwać 5–10 min — ściąga zależności AdMoba i Capacitora.
2. **Wybierz urządzenie** w pasku narzędzi:
   - emulator (Device Manager → Create device → Pixel 6 → API 34)
   - **albo** Twój telefon (USB debugging w opcjach deweloperskich Androida)
3. Klik **▶ Run** (zielony trójkąt) lub `Shift+F10`.

Apka się zainstaluje i odpali. Na dole zobaczysz testowy baner AdMob (mówi „Test ad").

---

## 4. Iteracja — gdy coś zmienisz w grze

Po edycji `www/index.html`, `www/sw.js`, manifestu itd.:

```bash
npx cap sync
```

A potem w Android Studio kliknij ponownie ▶ Run. NIE musisz restartować Gradle, nie musisz zamykać IDE — `cap sync` tylko nadpisze `android/app/src/main/assets/public/`.

---

## Wersjonowanie

Jedno źródło prawdy: pole `version` w `package.json`. Skrypt `scripts/sync-version.js`
propaguje wersję do `android/app/build.gradle` (`versionName` + `versionCode`)
i `www/version.js` (`window.APP_VERSION` — widoczne w stopce gry).

`versionCode` wyliczany deterministycznie z semvera: `major*10000 + minor*100 + patch`.
Np. `1.2.3` → `10203`. Play Console wymaga monotonicznego wzrostu — póki nie cofasz
wersji, ten schemat to gwarantuje.

### Bump wersji

```bash
# patch (0.2.0 → 0.2.1) — drobne poprawki
npm version patch

# minor (0.2.0 → 0.3.0) — nowa funkcja
npm version minor

# major (0.2.0 → 1.0.0) — duże zmiany / pierwsza stabilna
npm version major
```

`npm version` automatycznie odpala `scripts/sync-version.js` (przez `version` script),
robi commit i taguje. Potem:

```bash
npx cap sync   # presync też odpala sync-version dla pewności
```

W stopce gry pojawi się `v0.2.0` (lub aktualna).

---

## 5. Build wersji do Play (AAB)

### 5a. Klucz podpisywania (jednorazowo)

```bash
cd android
keytool -genkey -v \
  -keystore pilkarzyki.keystore \
  -alias pilkarzyki \
  -keyalg RSA -keysize 2048 -validity 10000
```

Odpowiedz na pytania (imię, organizacja, miasto). Wpisz hasło i zapisz w sejfie haseł — **utrata = brak możliwości publikacji aktualizacji nigdy więcej**.

### 5b. Konfiguracja podpisu

Utwórz `android/keystore.properties` (NIE commituj — jest w `.gitignore`):

```properties
storeFile=../pilkarzyki.keystore
storePassword=TWOJE_HASLO
keyAlias=pilkarzyki
keyPassword=TWOJE_HASLO
```

W `android/app/build.gradle` na samej górze (przed `android {`) dorzuć:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

W `android { ... }` blokach `signingConfigs` i `buildTypes.release` ustaw:

```gradle
signingConfigs {
    release {
        keyAlias keystoreProperties['keyAlias']
        keyPassword keystoreProperties['keyPassword']
        storeFile file(keystoreProperties['storeFile'])
        storePassword keystoreProperties['storePassword']
    }
}
buildTypes {
    release {
        minifyEnabled false
        proguardFiles getDefaultProguardFile('proguard-android-optimize.txt'), 'proguard-rules.pro'
        signingConfig signingConfigs.release
    }
}
```

### 5c. Zmień tryb na produkcyjny

W `www/index.html` linia:

```js
const AD_TESTING = true;
```

na:

```js
const AD_TESTING = false;
```

Potem `npx cap sync`.

### 5d. Generuj AAB

```bash
cd android
./gradlew bundleRelease
```

Wynik: `android/app/build/outputs/bundle/release/app-release.aab`.
Ten plik wgrywasz w Play Console.

---

## 6. Screenshoty do Play Store

W Android Studio:
1. Uruchom apkę debug na emulatorze Pixel 6 (1080×2400)
2. W panelu emulatora → ikona aparatu → screenshot zapisuje do `~/Desktop`
3. Zrób minimum 2 (rekomendowane 4–6):
   - Startowy ekran z boiskiem
   - Środek rozgrywki (z liniami i odbiciem)
   - Modal końca gry („🏆 Wygrana!")
   - Panel z trybem 2 graczy

---

## 7. Częste błędy

### `SDK location not found`
W Android Studio: **File → Project Structure → SDK Location** → wskaż katalog Android SDK (zwykle `~/Android/Sdk` na Linux/Mac, `C:\Users\...\AppData\Local\Android\Sdk` na Windows).
Albo utwórz `android/local.properties`:
```
sdk.dir=/Users/twojuser/Library/Android/sdk
```

### `Failed to find target with hash string 'android-34'`
SDK Manager → zainstaluj API 34.

### Banner AdMob nie pokazuje się
- Sprawdź `<meta-data android:name="com.google.android.gms.ads.APPLICATION_ID" ... />` w `AndroidManifest.xml` (powinno tam być — ja wpisałem `ca-app-pub-9793821286854398~4316124888`).
- Otwórz logcat (Logcat tab w Android Studio) → filtr „AdMob" lub „Ads" — błąd Google zwykle pokazuje przyczynę.
- Internet na urządzeniu/emulatorze (czasem emulator startuje offline).

### `keystore was tampered with` przy bundleRelease
Hasło lub alias w `keystore.properties` nie zgadza się z tym, czego użyłeś przy `keytool -genkey`.

---

## 8. Co dalej

- ✅ Build debug i screenshoty
- ✅ Klucz keystore w sejfie haseł
- ✅ `AD_TESTING = false` przed release
- ⏳ Konto Play Console ($25)
- ⏳ Listing — wszystkie teksty i grafiki w `docs/PLAY-STORE-LISTING.md`
- ⏳ Wgranie AAB → wewnętrzny test → zamknięty test (12 testerów × 14 dni) → produkcja

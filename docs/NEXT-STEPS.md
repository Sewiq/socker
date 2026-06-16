# Następne kroki — od pobrania repo do AAB w Play Store

Checklista akcji do wykonania po każdej aktualizacji repo i dla zbudowania AAB
do publikacji w Google Play Console.

---

## A. Aktualizacja lokalnego klona

Gdy ktoś (Ty albo bot) zmergował coś do `main` na GitHubie:

```bash
cd ~/Pobrane/socker

# 1. Pokaż co masz zmienione lokalnie
git status

# 2. Schowaj swoje zmiany do "kieszeni"
git stash

# 3. Pobierz świeżego maina z GitHuba
git pull origin main

# 4. Przywróć swoje zmiany na wierzch (Git spróbuje automatycznie)
git stash pop
```

Jeśli `git stash pop` zgłosi konflikt — w plikach znajdziesz markery
`<<<<<<< HEAD ... ======= ... >>>>>>> Stashed changes`, które musisz ręcznie
rozstrzygnąć. Zwykle nie powinno się to zdarzyć, bo Twoje lokalne edycje
(proguard-android-optimize.txt, mipmap → drawable) są w innych miejscach
albo identyczne z tym co weszło PR-em.

---

## B. Refresh zależności i sync do Androida

```bash
# 1. Odśwież node_modules (zwykle nic się nie zmieni, ale ważne po update package.json)
npm install

# 2. PONOWNIE podmień proguard w pluginie AdMob — npm install może to nadpisać
find ~/Pobrane/socker/node_modules -path "*/android/build.gradle" \
  -exec grep -l "'proguard-android.txt'" {} \; \
  -exec sed -i "s|proguard-android.txt|proguard-android-optimize.txt|g" {} \;

# 3. Skopiuj www/ do natywnego projektu Android (cap sync też odpala sync-version)
npx cap sync

# 4. Sprawdź że wersja się przepropagowała
cat www/version.js
# powinno pokazać: window.APP_VERSION = "0.2.0";
```

---

## C. Build debug APK (do testów na telefonie)

```bash
unset JAVA_HOME                    # czysty start
cd ~/Pobrane/socker/android
./gradlew --stop                   # zabija stare gradle daemony
./gradlew assembleDebug 2>&1 | tail -10
```

APK będzie w: `android/app/build/outputs/apk/debug/app-debug.apk`

Skopiuj na telefon i zainstaluj. Sprawdź:
- ✅ Apka się otwiera, boisko widoczne
- ✅ W stopce widać `v0.2.0`
- ✅ Baner testowy AdMob u dołu

---

## D. Konfiguracja JDK 17 (jednorazowo)

Jeśli `bundleRelease` rzuca "Toolchain does not provide JAVA_COMPILER":

```bash
sudo apt install -y openjdk-17-jdk

cat >> ~/Pobrane/socker/android/gradle.properties << 'EOF'

# JDK 17 wymuszony — workaround dla Gradle 9 toolchain detection
org.gradle.java.installations.auto-detect=false
org.gradle.java.home=/usr/lib/jvm/java-17-openjdk-amd64
EOF
```

---

## E. Keystore — klucz podpisywania (JEDNORAZOWO)

> ⚠️ **Hasło zapisz w sejfie haseł.** Utrata = niemożność aktualizacji apki w Play Store na zawsze.

```bash
cd ~/Pobrane/socker/android
keytool -genkey -v \
  -keystore pilkarzyki.keystore \
  -alias pilkarzyki \
  -keyalg RSA -keysize 2048 -validity 10000
```

Odpowiedz na pytania (imię, organizacja, miasto). Zostań przy jednym haśle
dla keystore i alias.

Następnie utwórz `android/keystore.properties` (jest w `.gitignore` — nie commituje się):

```properties
storeFile=../pilkarzyki.keystore
storePassword=TWOJE_HASLO
keyAlias=pilkarzyki
keyPassword=TWOJE_HASLO
```

Edytuj `android/app/build.gradle` — na samej górze dodaj:

```gradle
def keystoreProperties = new Properties()
def keystorePropertiesFile = rootProject.file("keystore.properties")
if (keystorePropertiesFile.exists()) {
    keystoreProperties.load(new FileInputStream(keystorePropertiesFile))
}
```

A w bloku `android { ... }` dorzuć/uzupełnij:

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

---

## F. Przed pierwszym AAB — wyłącz tryb testowy

W `www/index.html`:
```js
const AD_TESTING = false;
```

W `capacitor.config.json`:
```json
"AdMob": { "initializeForTesting": false }
```

Potem:
```bash
npx cap sync
```

> 🚨 **Po wyłączeniu trybu testowego NIE klikaj własnych prawdziwych reklam.**
> Klikanie = blokada konta AdMob bez ostrzeżenia.

---

## G. Build AAB do Play Store

```bash
cd ~/Pobrane/socker
npm run bundle:android
```

Wynik: `android/app/build/outputs/bundle/release/app-release.aab`

To jest plik, który wgrywasz do Play Console.

---

## H. Bump wersji przed kolejnym release

```bash
# patch (0.2.0 → 0.2.1) — drobne poprawki
npm version patch

# minor (0.2.0 → 0.3.0) — nowa funkcja
npm version minor

# major (0.2.0 → 1.0.0) — duża zmiana / pierwsza stabilna
npm version major
```

`npm version` automatycznie:
1. Odpala `scripts/sync-version.js` (uaktualnia build.gradle + version.js)
2. Robi commit
3. Taguje wersję w git

Potem `git push --follow-tags && npm run bundle:android`.

---

## I. Wymagania Play Console — checklist

- [ ] Konto Play Console ($25 jednorazowo)
- [ ] Polityka prywatności URL: `https://sewiq.github.io/socker/www/legal/privacy.html`
- [ ] `app-ads.txt` zweryfikowany przez AdMob (24h po wgraniu do Pages)
- [ ] Ikona 512×512 — `www/icons/icon-playstore-512.png`
- [ ] Feature graphic 1024×500 — `www/icons/feature-graphic.png`
- [ ] Min. 2 screenshoty (rekomendowane 4–6) — z `app-debug.apk` na emulatorze/telefonie
- [ ] Wypełniona Data Safety form (deklaracja AdMob — patrz `docs/PLAY-STORE-LISTING.md`)
- [ ] Target SDK ≥ 34 (już mamy — Capacitor 8)
- [ ] Test zamknięty (closed testing) z ≥ 12 testerami × 14 dni — wymóg dla nowych deweloperów

Opisy PL (krótki + długi) + odpowiedzi do ankiety wiekowej + URL-e są w:
👉 `docs/PLAY-STORE-LISTING.md`

---

## Diagnostyka — najczęstsze problemy

| Objaw | Rozwiązanie |
|---|---|
| `Toolchain does not provide JAVA_COMPILER` | krok **D** (JDK 17 + gradle.properties) |
| `getDefaultProguardFile('proguard-android.txt') is no longer supported` | krok **B.2** (sed na pluginie AdMob po npm install) |
| `mipmap/ic_launcher_background not found` | edytuj `mipmap-anydpi-v26/ic_launcher*.xml` → zamień `@mipmap/` na `@drawable/` |
| Gradle sync nie kończy się | `./gradlew --stop` + restart IDE |
| `keystore was tampered with` | hasło w `keystore.properties` ≠ to z `keytool -genkey` |
| Wersja w stopce nie aktualizuje się | `node scripts/sync-version.js && npx cap sync` |

---

*Dokument do aktualizacji przy każdej zmianie procesu. Jeśli coś tu nie pasuje
do tego co widzisz — zgłoś, aktualizuję.*

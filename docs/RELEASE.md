# 🚀 Release runbook — AAB do Play Store

Krok po kroku jak zbudować podpisany AAB i wgrać do Google Play.

---

## Jednorazowe setup (już zrobione, dokumentacja)

### 1. Keystore produkcyjny

```bash
keytool -genkey -v \
  -keystore prostriker.keystore \
  -alias prostriker \
  -keyalg RSA -keysize 2048 -validity 10000
```

**KRYTYCZNE:**
- Keystore = jedyny sposób na publikację update'ów.
- **Backup natychmiast** po wygenerowaniu (pendrive + zaszyfrowana chmura).
- Hasła w menedżerze (Bitwarden/1Password).
- Plik **NIE wchodzi do repo** (`.gitignore` chroni `*.keystore`).

Trzymany w katalogu głównym repo (`~/Pobrane/socker/prostriker.keystore`),
referencja w `android/keystore.properties` jako `../../prostriker.keystore`.

### 2. `android/keystore.properties`

**Nie commituj** (`.gitignore` chroni). Stwórz lokalnie:

```properties
storeFile=../prostriker.keystore
storePassword=TWOJE_HASLO_KEYSTORE
keyAlias=prostriker
keyPassword=TWOJE_HASLO_KLUCZA
```

Uwaga: `storeFile` jest **względny do `android/`** (bo Gradle ładuje plik
przez `rootProject.file(...)` z root = `android/`). Dlatego `../prostriker.keystore`,
nie `../../`.

---

## Build AAB (każdy release)

```bash
cd ~/Pobrane/socker

# 1. Aktualizacja wersji (jeśli zmieniana)
# - capacitor.config.json: appName, ewentualnie inne
# - android/app/build.gradle: versionCode (+1 KAŻDY release), versionName ("0.3.0")
# - package.json: version
# Albo automatycznie:
node scripts/sync-version.js   # jeśli skrypt jest

# 2. Sync www → android/
npx cap sync

# 3. Build AAB
npm run bundle:android

# 4. Wynik
ls -lh android/app/build/outputs/bundle/release/app-release.aab
```

### Weryfikacja podpisu AAB

```bash
# Powinno pokazać META-INF/PROSTRIK.RSA + .SF
unzip -l android/app/build/outputs/bundle/release/app-release.aab \
  | grep -iE "META-INF.*\.(RSA|DSA|EC|SF)"

# Szczegóły certyfikatu:
keytool -printcert -jarfile android/app/build/outputs/bundle/release/app-release.aab
```

Jeśli sekcji `.RSA` brak → `keystore.properties` nie został znaleziony lub
ma błędne ścieżki. Build.gradle pominął wtedy signing config (intencja: build
działa nawet bez kluczy, ale wtedy AAB jest niepodpisany).

---

## Upload do Play Console

1. Play Console → app „ProStriker" → **Testing → Closed testing**
2. **Create new release** w wybranym track
3. Upload AAB (`app-release.aab`)
4. Release notes (PL/EN/DE — patrz `docs/PLAY-STORE-LISTING.md`)
5. **Save → Review release → Roll out**

### Pierwszy upload

Wtedy Google poprosi o **opt-in do Play App Signing**:
- Twój keystore staje się **upload key** (do podpisywania uploadu).
- Google generuje **app signing key** (do dystrybucji w sklepie).
- Plus: jak zgubisz upload key, można go zresetować przez support.
- **Akceptuj** — to dziś standard.

### Closed testing — zegar 14 dni

Po wgraniu AAB:
1. **Testers → Create email list** (15-20 adresów, margines na rezygnacje)
2. **Opt-in URL** → wyślij testerom z prośbą „zainstaluj i nie odinstalowuj 14 dni"
3. Po 14 dniach z 12 aktywnymi testerami → **Apply for production access**

---

## Checklist przed production submission

- [ ] AdMob test mode WYŁĄCZONY (`capacitor.config.json`: `initializeForTesting: false`)
- [ ] `AD_TESTING=false` w `www/index.html`
- [ ] UMP / RODO consent działa (test na urządzeniu w EU)
- [ ] Polityka prywatności URL żyje (`prostriker.online/legal/privacy.html`
      lub GH Pages)
- [ ] `app-ads.txt` na produkcyjnej domenie + AdMob → Developer site
- [ ] Data Safety form wypełniony (ID reklamowe!)
- [ ] Target audience „for all" + AdMob `tagForChildDirectedTreatment` jeśli wymagane
- [ ] Content rating questionnaire
- [ ] Bumped `versionCode` (każdy AAB **musi** mieć wyższy niż poprzedni)
- [ ] Tested na realnym urządzeniu Android (nie tylko emulator)

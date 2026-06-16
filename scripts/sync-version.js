#!/usr/bin/env node
// sync-version.js
// Propaguje wersję z package.json do:
//   1) android/app/build.gradle  (versionName + versionCode)
//   2) www/version.js            (window.APP_VERSION dla UI gry)
//
// versionCode wyliczany deterministycznie z semvera: major*10000 + minor*100 + patch
// (np. 1.2.3 -> 10203). Play Console wymaga monotonicznego wzrostu — póki bumpujemy
// patch/minor/major nigdy nie maleje, ten schemat wystarcza.

const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const pkg = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const version = pkg.version;
const m = /^(\d+)\.(\d+)\.(\d+)/.exec(version);
if (!m) {
  console.error(`[sync-version] nieprawidłowy semver w package.json: ${version}`);
  process.exit(1);
}
const [, maj, min, pat] = m.map(Number);
const versionCode = maj * 10000 + min * 100 + pat;

// 1) www/version.js
const verJsPath = path.join(root, "www", "version.js");
fs.writeFileSync(
  verJsPath,
  `// Wygenerowane przez scripts/sync-version.js — nie edytuj ręcznie.\n` +
    `window.APP_VERSION = "${version}";\n` +
    `window.APP_VERSION_CODE = ${versionCode};\n`
);
console.log(`[sync-version] www/version.js → ${version} (code ${versionCode})`);

// 2) android/app/build.gradle
const gradlePath = path.join(root, "android", "app", "build.gradle");
if (fs.existsSync(gradlePath)) {
  let gradle = fs.readFileSync(gradlePath, "utf8");
  gradle = gradle.replace(/versionCode\s+\d+/, `versionCode ${versionCode}`);
  gradle = gradle.replace(/versionName\s+"[^"]*"/, `versionName "${version}"`);
  fs.writeFileSync(gradlePath, gradle);
  console.log(`[sync-version] android/app/build.gradle → ${version} (code ${versionCode})`);
} else {
  console.warn("[sync-version] android/app/build.gradle nie znaleziony — pomijam (uruchom `npx cap add android` lub klon repo).");
}

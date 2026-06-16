/* storage.js — jedyny punkt dostępu do danych gracza.
 *
 * Zasada przewodnia (z docs/ROADMAP.md): reszta gry NIE woła localStorage
 * bezpośrednio. Rozmawia tylko z tym modułem. Gdy przyjdzie chmura, podmieniamy
 * WNĘTRZE tego pliku (localStorage → fetch do backendu z fallbackiem offline),
 * a gra niczego nie zauważy.
 *
 * Trzy reguły przesądzające o bezbolesnej migracji do chmury:
 *   1. Każdy profil ma `id` (UUID) — stały klucz, nick bywa zmienny.
 *   2. Każdy mecz ma `id` (UUID) i `playedAt` (ISO 8601 UTC) — scalanie historii
 *      z wielu urządzeń bez duplikatów i konfliktów kolejności.
 *   3. Statystyki są POCHODNĄ historii (GameRecord[]), nie źródłem prawdy.
 *      Trzymane jako cache w profilu, ale zawsze przeliczalne z listy meczów.
 *
 * Public API (window.storage):
 *   ready                      Promise — czeka aż dane się załadują
 *   getProfile()               → PlayerProfile (auto-tworzony przy pierwszym uruchomieniu)
 *   updateProfile(patch)       merge + zapis; zwraca zaktualizowany profil
 *   saveGameRecord(record)     dopisuje mecz do historii, przelicza staty, przyznaje XP
 *   getGameRecords()           → GameRecord[] (najnowsze pierwsze)
 *   getStats()                 → statystyki przeliczone z historii (cache)
 *   recomputeStats()           wymusza przeliczenie i zapis
 *   resetHistory()             czyści historię i staty (profil zostaje)
 *   xpForLevel(level)          próg XP dla danego poziomu
 *   levelForXp(xp)             poziom dla danej ilości XP
 *   onChange(fn)               subskrypcja zmian (np. odśwież UI statystyk)
 */
"use strict";

(function () {
  const SCHEMA_VERSION = 1;
  const KEY_PROFILE = "pilkarzyki.profile";
  const KEY_HISTORY = "pilkarzyki.history";
  const HISTORY_CAP = 1000; // ile meczów trzymamy lokalnie

  const listeners = new Set();

  // ---------- niskopoziomowy odczyt/zapis (jedyne miejsce z localStorage) ----------
  function readJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      console.warn(`storage: nie udało się odczytać ${key}`, e);
      return fallback;
    }
  }
  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
      console.warn(`storage: nie udało się zapisać ${key}`, e);
    }
  }

  // ---------- UUID (z fallbackiem dla starszych webview) ----------
  function uuid() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) return crypto.randomUUID();
    return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
      const r = (Math.random() * 16) | 0;
      const v = c === "x" ? r : (r & 0x3) | 0x8;
      return v.toString(16);
    });
  }

  function nowISO() {
    return new Date().toISOString();
  }

  // ---------- XP / poziom ----------
  // Próg skumulowanego XP dla wejścia na poziom L: 50 * L * (L-1)
  //   L1: 0, L2: 100, L3: 300, L4: 600, L5: 1000, L6: 1500 ...
  function xpForLevel(level) {
    const L = Math.max(1, level | 0);
    return 50 * L * (L - 1);
  }
  function levelForXp(xp) {
    let L = 1;
    while (xpForLevel(L + 1) <= xp) L++;
    return L;
  }
  // Reguła nagradzania: +10 XP za rozegrany mecz, +25 dodatkowo za wygraną (vs bot).
  function xpForGame(record) {
    let xp = 10;
    if (record.mode === "bot" && record.winner === 1) xp += 25;
    return xp;
  }

  // ---------- domyślny profil ----------
  function detectLang() {
    try {
      const saved = localStorage.getItem("pilkarzyki.lang");
      if (saved) return saved;
    } catch (e) {}
    const nav = (navigator.language || "pl").slice(0, 2).toLowerCase();
    return nav;
  }
  function freshProfile() {
    return {
      id: uuid(),
      nick: "",                                  // pusty = "Gracz" w UI; wybór nicku w kroku 3
      avatar: { type: "flag", country: null },   // flaga wybierana na ekranie profilu
      language: detectLang(),
      createdAt: nowISO(),
      xp: 0,
      level: 1,
      stats: emptyStats(),
      schemaVersion: SCHEMA_VERSION
    };
  }
  function emptyStats() {
    return {
      played: 0, won: 0, lost: 0,
      vsBot: { played: 0, won: 0, lost: 0, byLevel: { easy: { played: 0, won: 0 }, medium: { played: 0, won: 0 }, hard: { played: 0, won: 0 } } },
      vs2p: { played: 0 },
      currentStreak: 0,   // bieżąca seria zwycięstw (vs bot)
      bestStreak: 0,
      byGoal: 0, byBlock: 0
    };
  }

  // ---------- migracje (na przyszłość) ----------
  // Klucz = wersja docelowa; funkcja podnosi profil z poprzedniej wersji.
  const MIGRATIONS = {
    // 2: (p) => { p.newField = default; p.schemaVersion = 2; return p; },
  };
  function migrateProfile(profile) {
    let p = profile;
    while ((p.schemaVersion || 0) < SCHEMA_VERSION) {
      const next = (p.schemaVersion || 0) + 1;
      const fn = MIGRATIONS[next];
      if (!fn) { p.schemaVersion = SCHEMA_VERSION; break; } // brak migracji = po prostu podbij
      p = fn(p);
      if (p.schemaVersion < next) p.schemaVersion = next;
    }
    return p;
  }

  // ---------- stan w pamięci ----------
  let profile = null;
  let history = [];

  function load() {
    let p = readJSON(KEY_PROFILE, null);
    if (!p) {
      p = freshProfile();
    } else {
      p = migrateProfile(p);
      // uzupełnij brakujące pola (np. po częściowym zapisie)
      if (!p.stats) p.stats = emptyStats();
      if (!p.avatar) p.avatar = { type: "flag", country: null };
    }
    profile = p;
    history = readJSON(KEY_HISTORY, []);
    if (!Array.isArray(history)) history = [];
    writeJSON(KEY_PROFILE, profile); // utrwal ewentualną migrację / auto-utworzenie
  }

  function notify() {
    listeners.forEach((fn) => { try { fn(profile); } catch (e) { console.warn(e); } });
  }

  // ---------- statystyki: pochodna historii ----------
  function computeStats(records) {
    const s = emptyStats();
    // Historia trzymana najnowsze-pierwsze. Do serii liczymy chronologicznie
    // (najstarsze-pierwsze). reverse() daje porządek wstawiania, a stabilny sort
    // po playedAt zachowuje go przy remisach znaczników czasu (ten sam ms).
    const chrono = records.slice().reverse().sort((a, b) => a.playedAt.localeCompare(b.playedAt));
    for (const r of chrono) {
      s.played++;
      if (r.reason === "goal") s.byGoal++;
      else if (r.reason === "block") s.byBlock++;

      if (r.mode === "bot") {
        s.vsBot.played++;
        const won = r.winner === 1;
        if (won) { s.vsBot.won++; s.won++; s.currentStreak++; if (s.currentStreak > s.bestStreak) s.bestStreak = s.currentStreak; }
        else { s.vsBot.lost++; s.lost++; s.currentStreak = 0; }
        const lvl = r.difficulty && s.vsBot.byLevel[r.difficulty];
        if (lvl) { lvl.played++; if (won) lvl.won++; }
      } else {
        s.vs2p.played++;
        // 2p nie wpływa na serię vs bot ani na win/lost gracza
      }
    }
    return s;
  }

  function recomputeStats() {
    profile.stats = computeStats(history);
    // XP/level przelicz też z historii (czysta funkcja f(historia))
    let xp = 0;
    for (const r of history) xp += xpForGame(r);
    profile.xp = xp;
    profile.level = levelForXp(xp);
    writeJSON(KEY_PROFILE, profile);
    return profile.stats;
  }

  // ---------- API ----------
  function getProfile() { return profile; }

  function updateProfile(patch) {
    profile = Object.assign({}, profile, patch);
    // zagnieżdżone pola (avatar) — płytki merge wystarcza, bo podajemy cały obiekt
    writeJSON(KEY_PROFILE, profile);
    notify();
    return profile;
  }

  function saveGameRecord(rec) {
    const record = {
      id: uuid(),
      playedAt: nowISO(),
      mode: rec.mode,                 // "bot" | "2p"
      difficulty: rec.difficulty || null,  // "easy"|"medium"|"hard"|null
      winner: rec.winner,             // 1 | 2
      reason: rec.reason || "goal",   // "goal" | "block"
      duration: rec.duration || 0,    // sekundy
      meta: rec.meta || {}            // { starter, moves, boardW, boardH }
    };
    history.unshift(record);
    if (history.length > HISTORY_CAP) history = history.slice(0, HISTORY_CAP);
    writeJSON(KEY_HISTORY, history);
    recomputeStats();
    notify();
    return record;
  }

  function getGameRecords() { return history.slice(); }
  function getStats() { return profile.stats; }

  function resetHistory() {
    history = [];
    writeJSON(KEY_HISTORY, history);
    recomputeStats();
    notify();
  }

  function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }

  const ready = (async () => { load(); })();

  window.storage = {
    SCHEMA_VERSION,
    ready,
    getProfile,
    updateProfile,
    saveGameRecord,
    getGameRecords,
    getStats,
    recomputeStats,
    resetHistory,
    xpForLevel,
    levelForXp,
    onChange
  };
})();

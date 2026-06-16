/* i18n.js — minimalna warstwa tłumaczeń.
 *
 * Cele projektowe:
 *  - Jeden punkt prawdy: tłumaczenia w www/i18n/{pl,en,de}.json
 *  - Reszta apki rozmawia tylko z `t(key, vars)` — nie wie, w jakim jest języku
 *  - Wymiana języka bez reloadu strony (dynamiczna podmiana tekstów)
 *  - Plural przez Intl.PluralRules (dodamy gdy potrzebne dla statystyk)
 *
 * Użycie z HTML:
 *   <span data-i18n="actions.newGame"></span>           // textContent
 *   <span data-i18n-html="rules.rule1"></span>          // innerHTML (gdy klucz zawiera <b>)
 *   <button data-i18n-attr-title="actions.resetScore">  // ustawia atrybut "title"
 *
 * Użycie z JS:
 *   await i18n.ready;                            // czeka aż słownik się załaduje
 *   i18n.t("status.turn", {who:"Ty", ...})
 *   i18n.setLanguage("en")                       // przełącza i odświeża DOM
 *
 * Lista obsługiwanych języków: i18n.LANGS
 */
"use strict";

(function () {
  const LANGS = ["pl", "en", "de"];
  // Domyślny język = angielski (produkt globalny). Detekcja nadal działa:
  // przeglądarka PL/DE dostaje swój język, wszystko inne → angielski.
  const DEFAULT_LANG = "en";
  const STORAGE_KEY = "pilkarzyki.lang";

  let dict = {};
  let currentLang = DEFAULT_LANG;
  const listeners = new Set();

  function detectLang() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && LANGS.includes(saved)) return saved;
    } catch (e) {}
    const nav = (navigator.language || "").slice(0, 2).toLowerCase();
    if (LANGS.includes(nav)) return nav;
    return DEFAULT_LANG;
  }

  function interpolate(str, vars) {
    if (!vars) return str;
    return str.replace(/\{(\w+)\}/g, (_, k) =>
      Object.prototype.hasOwnProperty.call(vars, k) ? String(vars[k]) : `{${k}}`
    );
  }

  function t(key, vars) {
    const raw = dict[key];
    if (raw == null) return key; // graceful fallback — pokazujemy klucz
    return interpolate(raw, vars);
  }

  async function loadLang(lang) {
    const res = await fetch(`i18n/${lang}.json`, { cache: "no-cache" });
    if (!res.ok) throw new Error(`Brak słownika dla ${lang}`);
    return await res.json();
  }

  function applyTranslations(scope) {
    const root = scope || document;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      el.textContent = t(el.getAttribute("data-i18n"));
    });
    root.querySelectorAll("[data-i18n-html]").forEach((el) => {
      el.innerHTML = t(el.getAttribute("data-i18n-html"));
    });
    // data-i18n-attr-<name>="key" → ustawia atrybut <name>
    root.querySelectorAll("*").forEach((el) => {
      for (const a of el.attributes) {
        if (a.name.startsWith("data-i18n-attr-")) {
          const attr = a.name.slice("data-i18n-attr-".length);
          el.setAttribute(attr, t(a.value));
        }
      }
    });
    document.documentElement.lang = currentLang;
    // sygnalizuj słuchaczom (np. UI dynamicznych etykiet w JS gry)
    listeners.forEach((fn) => {
      try { fn(currentLang); } catch (e) { console.warn(e); }
    });
  }

  async function setLanguage(lang) {
    if (!LANGS.includes(lang)) return;
    if (lang === currentLang && Object.keys(dict).length) return;
    dict = await loadLang(lang);
    currentLang = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch (e) {}
    applyTranslations();
  }

  function onChange(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  }

  // start: wybierz język i załaduj słownik
  const ready = (async () => {
    const lang = detectLang();
    try {
      dict = await loadLang(lang);
      currentLang = lang;
    } catch (e) {
      console.warn(`i18n: nie udało się wczytać ${lang}, próbuję ${DEFAULT_LANG}`, e);
      dict = await loadLang(DEFAULT_LANG);
      currentLang = DEFAULT_LANG;
    }
  })();

  window.i18n = {
    LANGS,
    DEFAULT_LANG,
    ready,
    t,
    setLanguage,
    getLanguage: () => currentLang,
    applyTranslations,
    onChange
  };
})();

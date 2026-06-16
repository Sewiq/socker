/* countries.js — lista kodów krajów ISO 3166-1 alpha-2 dla wyboru flagi.
 *
 * Przechowujemy TYLKO kod (np. "PL"), zgodnie z ROADMAP — stabilny, mały,
 * gotowy pod rankingi krajowe. Nazwa kraju jest lokalizowana w locie przez
 * Intl.DisplayNames(język), flaga renderowana jako emoji z kodu.
 *
 * (Emoji flag działa na Androidzie/iOS/Linuksie. Na desktopowym Windows mogą
 *  nie renderować — produkt to Android, więc OK. Gdyby trzeba: podmiana na
 *  flag-icons SVG nie rusza modelu danych, bo trzymamy sam kod ISO.)
 */
"use strict";

(function () {
  // Najczęściej wybierane — na górze listy w pickerze.
  const POPULAR = ["PL", "GB", "US", "DE", "ES", "FR", "IT", "UA", "BR", "NL", "PT", "CZ"];

  // Pełna lista ISO 3166-1 alpha-2 (kraje + wybrane terytoria z flagą).
  const ALL = [
    "AD","AE","AF","AG","AL","AM","AO","AR","AT","AU","AZ",
    "BA","BB","BD","BE","BF","BG","BH","BI","BJ","BN","BO","BR","BS","BT","BW","BY","BZ",
    "CA","CD","CF","CG","CH","CI","CL","CM","CN","CO","CR","CU","CV","CY","CZ",
    "DE","DJ","DK","DM","DO","DZ",
    "EC","EE","EG","ER","ES","ET",
    "FI","FJ","FM","FR",
    "GA","GB","GD","GE","GH","GM","GN","GQ","GR","GT","GW","GY",
    "HN","HR","HT","HU",
    "ID","IE","IL","IN","IQ","IR","IS","IT",
    "JM","JO","JP",
    "KE","KG","KH","KI","KM","KN","KP","KR","KW","KZ",
    "LA","LB","LC","LI","LK","LR","LS","LT","LU","LV","LY",
    "MA","MC","MD","ME","MG","MH","MK","ML","MM","MN","MR","MT","MU","MV","MW","MX","MY","MZ",
    "NA","NE","NG","NI","NL","NO","NP","NR","NZ",
    "OM",
    "PA","PE","PG","PH","PK","PL","PT","PW","PY",
    "QA",
    "RO","RS","RU","RW",
    "SA","SB","SC","SD","SE","SG","SI","SK","SL","SM","SN","SO","SR","SS","ST","SV","SY","SZ",
    "TD","TG","TH","TJ","TL","TM","TN","TO","TR","TT","TV","TW","TZ",
    "UA","UG","US","UY","UZ",
    "VA","VC","VE","VN","VU",
    "WS",
    "YE",
    "ZA","ZM","ZW"
  ];

  // emoji flaga z kodu ISO (regional indicator symbols)
  function flagEmoji(code) {
    if (!code || code.length !== 2) return "🏳️";
    return code.toUpperCase().replace(/./g, (c) =>
      String.fromCodePoint(127397 + c.charCodeAt(0))
    );
  }

  // nazwa kraju w danym języku (fallback: kod)
  function countryName(code, lang) {
    try {
      const dn = new Intl.DisplayNames([lang || "en"], { type: "region" });
      return dn.of(code) || code;
    } catch (e) {
      return code;
    }
  }

  window.COUNTRIES = { POPULAR, ALL, flagEmoji, countryName };
})();

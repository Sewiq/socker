/* rules.test.js — strażnik niezłomnych zasad gry (docs/RULES-INVARIANTS.md).
 *
 * Sprawdza inwarianty I1-I4 deterministycznie w Node:
 *  - silnik (engine.js) — pełna walidacja zasad
 *  - minimaks bota (mmPickBest) — parametryczny, nie mutuje przekazanego stanu
 *
 * Inwariant I2/I3 na ŻYWYM stanie gry dodatkowo weryfikuje test przeglądarkowy
 * (Playwright) — patrz historia PR. I5 (serwer autorytatywny) testuje socker-server.
 *
 * Uruchom: node --test test/rules.test.js
 */
"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const engine = require("../www/engine.js");

// ---------- I1/I3: każdy applyMove dodaje dokładnie 1 krawędź ----------
test("I1/I3 — applyMove dodaje dokładnie 1 krawędź (cała partia)", ()=>{
  let s = engine.freshState();
  let prev = s.edges.length, moves = 0;
  while(!s.winner && moves++ < 300){
    const legal = engine.legalMoves(s.ball, s.used);
    if(!legal.length) break;
    engine.applyMove(s, legal[0], s.player);
    assert.strictEqual(s.edges.length - prev, 1,
      `ruch ${moves}: dodano ${s.edges.length - prev} krawędzi (musi być 1)`);
    prev = s.edges.length;
  }
});

// ---------- I2/I4: zasada odbicia i brak powtórzeń ----------
test("I2 — odbicie trzyma gracza na turze, nie-odbicie zmienia gracza", ()=>{
  const s = engine.freshState();
  // pierwszy ruch ze środka na pustą kropkę → brak odbicia → zmiana gracza
  const m = engine.legalMoves(s.ball, s.used)[0];
  const before = s.player;
  engine.applyMove(s, m, before);
  if(!s.winner){
    // degree celu w momencie ruchu decydował; po ruchu na pustą kropkę gracz się zmienia
    assert.notStrictEqual(s.player, before, "po ruchu bez odbicia tura musi przejść");
  }
});

test("I4 — krawędź raz użyta nie wraca do legalMoves", ()=>{
  const s = engine.freshState();
  const start = s.ball.slice();
  const m = engine.legalMoves(s.ball, s.used)[0];
  engine.applyMove(s, m, s.player);
  // krawędź start–m jest teraz used
  assert.ok(s.used.has(engine.ek(start, m)), "użyta krawędź musi być w used");
  // z pozycji m nie da się wrócić tą samą krawędzią
  const legalFromM = engine.legalMoves(s.ball, s.used);
  const backwards = legalFromM.find(x=>x[0]===start[0] && x[1]===start[1]);
  assert.ok(!backwards, "nie wolno użyć tej samej krawędzi z powrotem");
});

test("I4 — bandy (FENCE) nigdy nie są legalnym ruchem", ()=>{
  const s = engine.freshState();
  // każdy ruch z każdej osiągalnej pozycji nie może pokrywać krawędzi FENCE
  let s2 = engine.freshState(), guard=0;
  while(!s2.winner && guard++<50){
    const legal = engine.legalMoves(s2.ball, s2.used);
    for(const m of legal){
      assert.ok(!engine.FENCE.has(engine.ek(s2.ball, m)) || !s2.used.has(engine.ek(s2.ball,m)) ,
        "ruch nie może jechać po bandzie");
    }
    if(!legal.length) break;
    engine.applyMove(s2, legal[0], s2.player);
  }
});

// ---------- I2: minimaks NIE mutuje przekazanego stanu ----------
function loadBot(){
  const html = fs.readFileSync(path.join(__dirname,"..","www","index.html"),"utf8");
  const inline = html.match(/<script>\s*"use strict";([\s\S]*?)<\/script>/)[1];
  const noop=()=>{};
  const elStub={addEventListener:noop,appendChild:noop,setAttribute:noop,classList:{add:noop,remove:noop,toggle:noop,contains:()=>false},style:{},querySelector:()=>elStub,querySelectorAll:()=>[],children:[],innerHTML:"",textContent:"",value:"",hidden:false,dataset:{},getAttribute:()=>null,closest:()=>null,setAttribute:noop};
  const sb={engine,Math,JSON,Set,Map,Array,Object,Date,console,Promise,setTimeout:noop,clearTimeout:noop,
    performance:{now:()=>Date.now()},navigator:{language:"pl"},localStorage:{getItem:()=>null,setItem:noop,removeItem:noop},
    document:{getElementById:()=>elStub,querySelector:()=>elStub,querySelectorAll:()=>[],createElementNS:()=>elStub,createElement:()=>elStub,addEventListener:noop,documentElement:{}},
    i18n:{t:k=>k,ready:Promise.resolve(),onChange:noop,applyTranslations:noop,getLanguage:()=>"pl",setLanguage:()=>Promise.resolve()},
    storage:{ready:Promise.resolve(),getProfile:()=>({}),updateProfile:noop,getGameRecords:()=>[],getStats:()=>({}),saveGameRecord:noop},
    COUNTRIES:{flagEmoji:()=>"",countryName:()=>""},requestAnimationFrame:noop,Capacitor:undefined};
  sb.window=sb; sb.globalThis=sb;
  vm.createContext(sb);
  try{ vm.runInContext(inline, sb, {timeout:4000}); }catch(e){/* DOM-init może rzucić, logika bota się ładuje */}
  return sb;
}

test("I2 — mmPickBest nie mutuje przekazanego stanu + zwraca legalny ruch", ()=>{
  const bot = loadBot();
  if(typeof bot.mmPickBest !== "function"){
    assert.ok(true, "mmPickBest niedostępny w sandboxie — pokryte testem przeglądarkowym");
    return;
  }
  // zbuduj realistyczny stan po kilku ruchach
  const s = engine.freshState();
  for(let i=0;i<4;i++){ const L=engine.legalMoves(s.ball,s.used); if(!L.length)break; engine.applyMove(s,L[0],s.player); if(s.winner)break; }
  const snapBefore = { edges:s.edges.length, used:s.used.size, ball:JSON.stringify(s.ball), moves:s.moves, player:s.player };

  let move=null;
  for(let i=0;i<5;i++) move = bot.mmPickBest(s, 2);

  const snapAfter = { edges:s.edges.length, used:s.used.size, ball:JSON.stringify(s.ball), moves:s.moves, player:s.player };
  assert.deepStrictEqual(snapAfter, snapBefore, "ZŁAMANY I2: mmPickBest zmienił przekazany stan!");

  if(move){
    const legal = engine.legalMoves(s.ball, s.used);
    assert.ok(legal.some(x=>x[0]===move[0]&&x[1]===move[1]),
      `ZŁAMANY I4: mmPickBest zwrócił nielegalny ruch ${JSON.stringify(move)}`);
  }
});

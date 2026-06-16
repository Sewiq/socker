/* engine.js — silnik gry „Piłkarzyki na kartce".
 *
 * Pure logic: geometria boiska, walidacja ruchów, wykrywanie golu/blokady.
 * Bez DOM, bez i18n, bez storage — żeby ten sam kod działał:
 *   1) we frontowej grze (window.engine)
 *   2) na serwerze Node jako serwer autorytatywny (require('./engine'))
 *
 * UMD-style export: dołącza się do window w przeglądarce i module.exports w Node.
 *
 * Stan gry to obiekt:
 *   { ball: [x,y], used: Set<edgeKey>, edges: [{a,b,p}], player: 1|2,
 *     winner: 0|1|2, winReason: null|"goal"|"block", bounce: bool, moves: int }
 *
 * `used` to Set string-kluczy ("x,y|x,y", posortowanych) — łatwo serializować
 * do JSON jako Array.from(used).
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else root.engine = api;
})(typeof window !== "undefined" ? window : globalThis, function () {
  "use strict";

  // ---- geometria ----
  const W = 8, H = 10, gL = 3, gR = 5;   // boisko 8x10, bramka 2 oczka
  const CENTER = [4, 5];

  function ek(a, b) {
    const ka = a[0] + "," + a[1], kb = b[0] + "," + b[1];
    return ka < kb ? ka + "|" + kb : kb + "|" + ka;
  }
  const isPitch = (x, y) => x >= 0 && x <= W && y >= 0 && y <= H;
  const isTopGoal = (m) => m[1] === -1 && m[0] >= gL && m[0] <= gR;
  const isBotGoal = (m) => m[1] === H + 1 && m[0] >= gL && m[0] <= gR;
  const isNode = (x, y) => isPitch(x, y) || isTopGoal([x, y]) || isBotGoal([x, y]);

  function inRegion(px, py) {
    if (px >= 0 && px <= W && py >= 0 && py <= H) return true;
    if (px >= gL && px <= gR && py >= -1 && py <= 0) return true;
    if (px >= gL && px <= gR && py >= H && py <= H + 1) return true;
    return false;
  }

  // Banda (fence) — krawędzie obwodu boiska, które są „użyte" od początku.
  const FENCE = new Set();
  (function buildFence() {
    const pts = [[0, 0], [gL, 0], [gL, -1], [gR, -1], [gR, 0], [W, 0],
                 [W, H], [gR, H], [gR, H + 1], [gL, H + 1], [gL, H], [0, H], [0, 0]];
    for (let i = 0; i < pts.length - 1; i++) {
      let [x1, y1] = pts[i], [x2, y2] = pts[i + 1];
      const dx = Math.sign(x2 - x1), dy = Math.sign(y2 - y1);
      let x = x1, y = y1;
      while (x !== x2 || y !== y2) {
        const nx = x + dx, ny = y + dy;
        FENCE.add(ek([x, y], [nx, ny]));
        x = nx; y = ny;
      }
    }
  })();

  // Wszystkie kropki (dla renderera frontu).
  const NODES = [];
  for (let y = 0; y <= H; y++) for (let x = 0; x <= W; x++) NODES.push([x, y]);
  for (let x = gL; x <= gR; x++) { NODES.push([x, -1]); NODES.push([x, H + 1]); }

  // ---- ruchy ----
  function legalMoves(ball, used) {
    const [cx, cy] = ball, res = [];
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      const nx = cx + dx, ny = cy + dy;
      if (!isNode(nx, ny)) continue;
      if (used.has(ek(ball, [nx, ny]))) continue;
      if (!inRegion((cx + nx) / 2, (cy + ny) / 2)) continue;
      res.push([nx, ny]);
    }
    return res;
  }

  function degreeOf(node, used) {
    let d = 0;
    const [x, y] = node;
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
      if (!dx && !dy) continue;
      if (used.has(ek(node, [x + dx, y + dy]))) d++;
    }
    return d;
  }

  // ---- stan i tranzycja ----
  function freshState() {
    return {
      ball: CENTER.slice(),
      used: new Set(FENCE),
      edges: [],
      player: 1,
      winner: 0,
      winReason: null,
      bounce: false,
      moves: 0
    };
  }

  // Wykonaj ruch ball→m gracza `by`. Zwraca mutowany state.
  // Wywołujący odpowiada za walidację (legalMoves) — ta funkcja TYLKO aplikuje.
  function applyMove(state, m, by) {
    const d0 = degreeOf(m, state.used);
    state.used.add(ek(state.ball, m));
    state.edges.push({ a: state.ball.slice(), b: m.slice(), p: by });
    state.ball = m.slice();
    state.moves++;
    if (isTopGoal(m)) { state.winner = 1; state.winReason = "goal"; return state; }
    if (isBotGoal(m)) { state.winner = 2; state.winReason = "goal"; return state; }
    const bounce = d0 >= 1;
    state.bounce = bounce;
    if (!bounce) state.player = by === 1 ? 2 : 1;
    if (legalMoves(state.ball, state.used).length === 0) {
      state.winner = state.player === 1 ? 2 : 1;
      state.winReason = "block";
    }
    return state;
  }

  // Czy ruch ball→m jest legalny dla bieżącego stanu i gracza `by`.
  function isLegalMove(state, m, by) {
    if (state.winner) return false;
    if (state.player !== by) return false;
    const legal = legalMoves(state.ball, state.used);
    return legal.some((x) => x[0] === m[0] && x[1] === m[1]);
  }

  // ---- serializacja (do sieci / storage) ----
  function serialize(state) {
    return {
      ball: state.ball,
      used: Array.from(state.used),
      edges: state.edges,
      player: state.player,
      winner: state.winner,
      winReason: state.winReason,
      bounce: state.bounce,
      moves: state.moves
    };
  }
  function deserialize(snap) {
    return {
      ball: snap.ball.slice(),
      used: new Set(snap.used),
      edges: snap.edges.map((e) => ({ a: e.a.slice(), b: e.b.slice(), p: e.p })),
      player: snap.player,
      winner: snap.winner,
      winReason: snap.winReason,
      bounce: snap.bounce,
      moves: snap.moves
    };
  }

  return {
    W, H, gL, gR, CENTER, FENCE, NODES,
    ek, isPitch, isTopGoal, isBotGoal, isNode, inRegion,
    legalMoves, degreeOf, freshState, applyMove, isLegalMove,
    serialize, deserialize
  };
});

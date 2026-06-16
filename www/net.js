/* net.js — klient WebSocket dla multiplayera.
 *
 * Opakowuje protokół z docs/MULTIPLAYER.md. UI rozmawia tylko z window.net —
 * nie zna szczegółów WS. Zdarzenia przez net.on(event, cb).
 *
 * URL serwera: window.MP_SERVER_URL (ustawiany przy deployu produkcyjnym),
 * fallback ws://localhost:3000/ws dla dev.
 *
 * Zdarzenia (net.on):
 *   open()                     połączono i wysłano HELLO
 *   welcome(serverTime)
 *   room(roomShape)            {code, state, players:[{nick,country,you,player}]}
 *   state(snap)                pełny stan gry (engine.serialize)
 *   moveOk({move,byPlayer,snap})
 *   rematchPending(who)
 *   opponentLeft()
 *   error({code,msg})
 *   close()                    rozłączono
 */
"use strict";

(function () {
  const DEFAULT_URL = "ws://localhost:3000/ws";

  let ws = null;
  let connected = false;
  let helloSent = false;
  let profile = null;            // {playerId, nick, country}
  let myPlayerNum = 0;           // 1 lub 2 — z ramki ROOM (pole `you`)
  let currentRoom = null;        // ostatni roomShape

  const listeners = {};          // event → Set<cb>
  function on(ev, cb) { (listeners[ev] = listeners[ev] || new Set()).add(cb); return () => listeners[ev].delete(cb); }
  function emit(ev, ...args) { (listeners[ev] || []).forEach(cb => { try { cb(...args); } catch (e) { console.warn(e); } }); }

  function url() { return window.MP_SERVER_URL || DEFAULT_URL; }

  function send(frame) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return false;
    ws.send(JSON.stringify(frame));
    return true;
  }

  function connect(prof) {
    profile = prof;
    return new Promise((resolve, reject) => {
      try { ws = new WebSocket(url()); }
      catch (e) { return reject(e); }
      helloSent = false;
      let settled = false;

      ws.onopen = () => {
        connected = true;
        send({ t: "HELLO", playerId: profile.playerId, nick: profile.nick || "", country: profile.country || null });
        helloSent = true;
        emit("open");
      };
      ws.onmessage = (ev) => {
        let msg; try { msg = JSON.parse(ev.data); } catch (e) { return; }
        route(msg);
        if (!settled && msg.t === "WELCOME") { settled = true; resolve(); }
      };
      ws.onerror = (e) => { emit("error", { code: "WS_ERROR", msg: "connection error" }); if (!settled) { settled = true; reject(e); } };
      ws.onclose = () => { connected = false; emit("close"); };

      setTimeout(() => { if (!settled) { settled = true; reject(new Error("connect timeout")); } }, 5000);
    });
  }

  function route(msg) {
    switch (msg.t) {
      case "WELCOME":       emit("welcome", msg.serverTime); break;
      case "ROOM":
        currentRoom = msg;
        { const me = (msg.players || []).find(p => p.you); if (me) myPlayerNum = me.player; }
        emit("room", msg); break;
      case "STATE":         emit("state", msg.snap); break;
      case "MOVE_OK":       emit("moveOk", { move: msg.move, byPlayer: msg.byPlayer, snap: msg.snap }); break;
      case "REMATCH_PENDING": emit("rematchPending", msg.who); break;
      case "OPPONENT_LEFT": emit("opponentLeft"); break;
      case "PONG":          emit("pong", msg); break;
      case "ERROR":         emit("error", { code: msg.code, msg: msg.msg }); break;
      default: break;
    }
  }

  function disconnect() { if (ws) { try { ws.close(); } catch (e) {} } ws = null; connected = false; }

  window.net = {
    on,
    connect,
    disconnect,
    isConnected: () => connected,
    getRoom: () => currentRoom,
    myPlayer: () => myPlayerNum,
    createRoom: () => send({ t: "CREATE_ROOM" }),
    joinRoom: (code) => send({ t: "JOIN_ROOM", code: String(code || "").toUpperCase() }),
    findMatch: () => send({ t: "FIND_MATCH" }),
    leave: () => send({ t: "LEAVE_ROOM" }),
    sendMove: (m) => send({ t: "MOVE", move: m }),
    rematch: () => send({ t: "REMATCH" }),
    ping: () => send({ t: "PING", t0: Date.now() })
  };
})();

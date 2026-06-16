# 🛡️ Niezłomne zasady gry (inwarianty)

**To jest nadrzędny dokument projektu.** Zasady gry są najważniejsze. Żaden kod —
bot, multiplayer, optymalizacja, refaktor — **nie może ich nigdy omijać ani łamać**.
Jeśli jakakolwiek zmiana stoi w sprzeczności z tym dokumentem, zmiana jest błędna.

> Geneza: minimaks bota raz zmutował żywy stan planszy podczas „myślenia" i dorysował
> dziesiątki linii w jednej turze. To NIE MOŻE się powtórzyć. Stąd ten dokument
> + automatyczny test (`test/rules.test.js`).

---

## Zasady gry (źródło prawdy)

Logika żyje w `www/engine.js`. Reguły:

1. **Jedna linia na turę.** Każdy ruch dodaje **dokładnie jedną** krawędź,
   od piłki do sąsiedniej kropki (poziomo, pionowo lub na skos).
2. **Żadnej linii dwa razy.** Krawędź raz użyta (`used`) nie może być użyta ponownie.
   Po bandzie (FENCE) nie wolno jeździć.
3. **Odbicie = dodatkowy ruch.** Jeśli ruch kończy się na zajętej kropce
   (stopień ≥ 1) lub o bandę → ten sam gracz gra dalej. W przeciwnym razie
   tura przechodzi na przeciwnika.
4. **Gol kończy grę.** Wejście w górną bramkę = wygrana gracza 1, w dolną = gracza 2.
5. **Blokada = przegrana.** Kto na swojej turze nie ma legalnego ruchu — przegrywa.

---

## Inwarianty techniczne (czego kod NIGDY nie może złamać)

### I1 — Tylko silnik zmienia stan gry
Stan gry (`ball`, `used`, `edges`, `player`, `winner`) zmienia się **wyłącznie**
przez `engine.applyMove(state, m, by)` po wcześniejszej walidacji
`engine.isLegalMove`. Żaden inny kod nie dopisuje krawędzi „ręcznie".

### I2 — Bot/AI nie mutuje żywego stanu
Każdy algorytm przeszukujący (minimaks, heurystyka, dowolne „myślenie")
operuje **wyłącznie na kopiach** (snapshotach). Żywy `state` jest dla nich
**tylko do odczytu**. Po wywołaniu `botPick()` / `mmPickBest()` żywy stan musi
być **bit-identyczny** jak przed.

> To był złamany inwariant w buggu z „plątaniną linii". Teraz minimaks jest
> czysto funkcyjny: `mmSnap` klonuje, `mmApply` aplikuje na kopii.

### I3 — Jeden ruch = dokładnie +1 krawędź
Po każdym `applyMove` liczba krawędzi (`state.edges.length`) rośnie o **dokładnie 1**.
Nigdy o 0, nigdy o więcej. (Łańcuch odbić = wiele osobnych `applyMove`, każdy +1.)

### I4 — Bot gra tylko legalne ruchy
Ruch zwrócony przez `botPick()` jest zawsze w `legalMoves(state.ball, state.used)`.
Bot nie strzela do własnej bramki jako „normalny" wybór (tylko gdy to jedyny ruch).

### I5 — Serwer multiplayer jest autorytatywny
Serwer waliduje **każdy** ruch przez `engine.isLegalMove` zanim go zastosuje.
Klient nigdy nie jest źródłem prawdy o stanie — dostaje go z serwera.
Zmodyfikowany klient nie może wymusić nielegalnego ruchu.

---

## Jak to jest pilnowane

- **`test/rules.test.js`** — automatyczny test (Node), uruchamiany `npm test`:
  - każdy `applyMove` dodaje dokładnie 1 krawędź
  - `botPick` nie zmienia żywego stanu (porównanie przed/po)
  - bot zwraca tylko legalne ruchy
  - pełna self-play partia bez naruszeń
- **Przy każdej zmianie w `engine.js`, botach lub multiplayerze** — uruchom `npm test`
  i sprawdź ten dokument. Jeśli zmiana łamie inwariant → zmiana jest do odrzucenia.

---

## Reguła dla każdego, kto dotyka kodu (w tym AI)

> Zanim zoptymalizujesz cokolwiek w przeszukiwaniu bota lub logice gry, zadaj pytanie:
> **„Czy ten kod może dopisać krawędź do żywego stanu albo pozwolić na ruch spoza
> `legalMoves`?"** Jeśli jest jakakolwiek szansa że tak — przepisz na operacje na
> kopiach i dodaj asercję. Wydajność nigdy nie usprawiedliwia złamania zasad gry.

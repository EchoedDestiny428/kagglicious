# Kaggriculture

Kaggle simulation competition, 2026-09-10 to 2026-09-30 (final ladder settles over the following two weeks).
Two farms share one market for 30 in-game days (720 turns). Each turn an agent moves its farmer and hired hands
and sends up to 10 market orders. The score is the cash you end with; the ladder rates agents by Elo.

- Team: **lost**, later **clove instalocker** (10,246 teams at the close)
- Our agent: **crimson**
- Best: rank **296** (2026-09-24, crimson v5.12 at 2598.6). In silver (top 5%) on 2026-09-25/26 (v10, best rank 387)
  and 2026-09-29 (v11.1, rank 488).
- At the submission deadline: rank **632** of 10,246 (crimson v11.6 at 1982; silver line 2048, bronze 1822). The
  ladder keeps running on the two final submissions (v11.6 and v11.3) until the final standings.

## Layout

| Folder | Contents |
|---|---|
| [src/](src/) | `build_crimson.py` and the pinned public bases it builds every version from (byte-identical to what was submitted) |
| [submissions/](submissions/) | Exact copy of every crimson file sent to Kaggle, with submission ids, dates, hashes and ladder scores |
| [scripts/](scripts/) | Arena, ladder-replay and analysis tools |
| [results/](results/) | Ladder scores and the raw ladder log from our watchdog |
| [findings.md](findings.md) | Everything we measured: game mechanics, what worked, what didn't |

## Results

Elo on Kaggle's ladder. The field deflated by roughly 45 points a day in the last week, so compare a version with
what was around it on the same day, not with earlier versions. Full table: [submissions/README.md](submissions/README.md).

| Version | Base | What changed | Evidence | Ladder |
|---|---|---|---|---|
| main.py v9 | own | hand-tuned heuristic (after a neural-net imitation attempt) | - | ~620 |
| v1 | V46 | sale lookahead 3 -> 16 turns | 661-59 vs the public panel | 2750 |
| v2 | V46 | turn-1 wheat buy 30 -> 15 | 59-5 vs v1 | peak 2862 |
| v2.1 | V46 | same-turn sale order | 31-1 vs v2; 68 vs 64 of v2's real ladder games | peak 2826 |
| v3 - v3.3 | V46 | day-6 route tables for more shop pairs | 206-22 on the changed pairs | 2740 -> 2332 |
| v4 | V50 | our routes, sale order and opening on the newer base | | 2614 |
| v5 - v5.14 | Metav4 v13 | our sale order, ported sale advance, crop swap, day-1 hire reserve, race window | rank 296 on 09-24 (v5.12 at 2599) | 2626 (v5.10) |
| v10 - v10.3 | cha22 | sale advance lookahead 10 (12 / 18 tested) | in silver 09-25/26 | 2307 |
| v11 - v11.2 | TTV1 | ported sale advance (lookahead 6), sell-now, order variants | in silver 09-29 | 2191 |
| v11.3 | TTV1 | **wheat tick trade** | 54/80 real ladder games vs v11.1's 29; held ~2080 | 2082 |
| v11.6 | TTV1 | wheat trade from day 6 + front-run stop | 32/32 vs v11.1; 26/32 vs a sandwich bot (v11.3: 2/32) | 1982 at the close |

## How it went

1. **Neural-net imitation (dropped).** A network trained on top-team replays peaked near 620 Elo; the local arena
   showed it won 6-12% against the strong public agents.
2. **Build on the best public agent, add only measured edges.** crimson v1-v3 put small changes on Ahmed Berat
   Ozer's V46 (Apache-2.0): a longer sale lookahead, a smaller turn-1 wheat buy, the order of sales inside a turn,
   and better route tables. Most of the ladder ran close copies of the same engine, so a consistent small edge
   turned ties into wins.
3. **Follow the public frontier.** New public engines kept appearing (V50, Metav4, cha22 on 09-24, TTV1 / 2965+ on
   09-27/28), each beating the previous line by a wide margin (TTV1 beat our cha22 build 28-4). crimson moved base
   four times, re-porting its own layers (sale advance, sale order, the stop) each time and re-testing them.
4. **The wheat tick trade (09-30).** Re-running our close ladder losses showed the winners buying ~60 wheat on every
   fourth turn, just before the town shops take wheat off the market, and selling it one turn later. Each lot makes
   only $4-12, but ~85 lots a game is ~$430 - about the size of our close losses. Our engine did this only on some
   route tapes; v11.3 does it every game. Placing the orders right after our last sale (ahead of the rivals'
   convention) turned it into +$3-4k a game against rivals trading the same tick.
5. **The counter-game.** At the 2000+ level rivals already exploited tick traders: buying in slot 0 and selling in
   slot 9 of the same turn (a sandwich), or buying the turn before the tick and selling in the last slot of the tick
   turn. v11.6 adds a stop that reads the real cost of a lot from the till and quits the trade for the game.

Where it ended: against today's field the wheat trade lifts the win rate in replays from ~40% (v11.1) to ~71%, but
the losses that remain are mostly to rivals with stronger farms (+11 wool, +20 strawberries, +16 carrots a game) and
to adaptive wheat traders. Our TTV1-based agents settled between ~1860 and ~2080 against a silver line near 2050-2080.

## Tools we built

See [scripts/README.md](scripts/README.md). The ones that mattered most:

- **Arena**: seeded head-to-head games in separate processes, both seats, loaded exactly as Kaggle loads an agent.
- **Exact builds**: every version is a list of text patches that must match once, built from a hashed public base.
- **Ladder replays**: download our games and re-run them in the engine; counterfactual replays put a candidate in
  our seat against the rival's recorded moves.
- **Rival identification**: shadow-run known agents in the rival's seat to see which engine (and which tweak) a
  rival runs.
- **Per-item gap analysis**: what each side sold, at what price, and who sold first - this is what found the wheat
  trade.

## Lessons

- **Re-run the losses.** Both big gains (v2.1's sale order, v11.3's wheat trade) came from taking real ladder
  losses apart turn by turn, not from tuning constants.
- **Local tests overrate some changes.** A longer sale lookahead or a different order convention beat our own
  variants every time and then did worse on the ladder (v10.2, v10.3, v11.2). Replays of recorded rivals cannot
  react; live rivals do.
- **Two identical submissions are no hedge.** We replaced a proven agent with a second copy of a newer one that
  replays rated equal; on the live ladder it settled ~100 points lower.
- **The rating has memory.** An early winning streak fixes where a submission settles for a long time: the same
  v11.3 file reached ~2080 once and ~1860 when resubmitted, at an 85% win rate both times.

## Credits

crimson builds on public Kaggle notebooks under the Apache License 2.0, with their notices kept in each file:
"Kaggriculture V46" and V50 by Ahmed Berat Ozer, Metav4, the V39 + v9 lineage as published in cha22 (abhinav0370),
and the "top-2 master engine v4" by guruprasaathas111 as republished in TTV1 (kunaldesale2408). Other public
notebooks were used as reference and as test opponents.

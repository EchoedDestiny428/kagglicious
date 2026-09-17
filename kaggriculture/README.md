# Kaggriculture

Kaggle simulation competition (deadline ~2026-10-01). Two farms share one market for 30 in-game days
(720 turns). Each turn an agent moves its farmer and hired hands, and sends up to 10 market orders. The
score is the cash you end with; the ladder rates agents by Elo.

- Team: **lost**
- Our agent: **crimson** (`crimson_vN.py`)
- Best ladder score so far: **2814** (crimson_v2); crimson_v2.1 is at **2800** and still settling.

The agent code and test tools will be added here after the competition ends.

## Results

| Version | What changed | Arena (fresh seeds) | Ladder Elo |
|---|---|---|---|
| main.py (v9) | hand-tuned heuristic | - | 625 |
| crimson_v1 | V46 base, sale lookahead 3 -> 16 turns | 661-59 vs the public panel | 2750 |
| crimson_v2 | v1 + turn-1 wheat buy 30 -> 15 units | 870-26 (97.1%), 59-5 vs v1 | 2814 |
| crimson_v2.1 | v2 + same-turn sale order | 346-38 (90.1%), 31-1 vs v2 | 2800 (settling) |

Details: [results/ladder_scores.md](results/ladder_scores.md), raw ladder log in
[results/ladder_history.log](results/ladder_history.log).

## How we got here

1. **Neural-net imitation (dropped).** The first attempt trained a network on top-team replays and a
   hand-tuned heuristic around it. It peaked at ~620 Elo. A local arena later showed it won only 6-12% of
   games against the strong public agents, and the imitation labels turned out to be degenerate.
2. **Build on the best public agent.** "Kaggriculture V46" by Ahmed Berat Ozer (Apache-2.0) replays 41
   recorded route plans, chosen by the first two town shops, with ~20 repair and market layers on top.
   crimson starts from V46 and only adds changes that win in our own arena.
3. **Find small, repeatable edges.** Most of the top of the ladder runs V46 or close copies of it. Two
   identical agents tie, so every consistent small edge turns ties into wins.

## Tools we built

- **Arena.** Seeded head-to-head games in separate processes, both seats, loaded exactly as Kaggle loads
  an agent; reports W-L-T, mean cash, margin and worst turn time.
- **Variant builder.** Every change is an exact text patch that must match once, so experiments can't
  silently stop applying.
- **Ledger.** Instruments the game engine to get each player's exact cash by product.
- **Ladder replay tools.** Download our ladder games, re-run each one in the engine from the recorded
  actions (reproduces the final score exactly), and report where the money was lost.
- **Counterfactual replays.** Play a candidate agent against a real ladder opponent's recorded moves on
  the same seed, to check a change against the rivals that actually beat us.
- **Route search.** Tests every recorded route for every pair of first shops.

## Findings

See [findings.md](findings.md) for the full list. Highlights:

- Selling a premium good a few turns ahead of the plan beats a rival running the same plan. Longer is
  better up to ~24-32 turns; beyond ~48 it loses money.
- The engine settles both players' orders position by position at the same price, so the order of sales
  inside one turn decides races between copies (the v2.1 change).
- Several ideas that looked good in replay statistics lost in controlled tests: bigger sheep herds,
  earlier tomato investment, filling the fourth land quadrant with carrots.
- One close ladder loss came from a full order list: nine morning hires left no slot for a valuable wool
  sale, which then sold one turn late for $95 instead of $533.

## Credits

crimson is built on "Kaggriculture V46: First-Turn Microstructure and Sale Timing" by Ahmed Berat Ozer
(Apache License 2.0). Other public notebooks were used as reference and test opponents.

# Findings

Everything here was measured in our local arena (seeded games, both seats) or by re-running real ladder
games in the official engine. Engine version: kaggle-environments 1.32.7.

## Game mechanics that matter

- **Shared market.** Prices move one unit at a time. Both players' order lists are settled position by
  position, one unit at a time, and both players get the same quote for the same unit. An item listed
  earlier than the rival's same item sells all its units first, at the better prices.
- **Order limit.** At most 10 market orders per turn; extra orders are dropped silently.
- **Town shops.** A shop unlocks every 3 days (up to 8, drawn with replacement). Each shop buys every 4
  turns: shops with one product (yarn store, pet cafe) take 2 units, the others 1 unit of each product.
- **Hired hands** disappear at the end of every day and must be hired again (Fibonacci cost per day).
- **Wool price** falls steeply once supply passes the target, so extra sheep only pay when yarn stores
  keep buying.

## What worked

| Change | Result |
|---|---|
| Sale advance lookahead 3 -> 16 turns (v1) | vs V46: 45-3. Head to head, longer lookahead wins up to ~24-32; 48+ loses money against the panel. |
| Turn-1 wheat buy 30 -> 15 units (v2) | 30-2 vs v1. Values above 30 (40, 50) collapse V46's cash to $57k-99k, a bug in the original. |
| Same-turn sale order (v2.1) | For each item in the turn's sales, compare selling before, alongside or after a copy of our list, and pick the best order. 31-1 vs v2; in replays of v2's real ladder games, 68 wins vs 64. |

## What didn't work

| Idea | Result |
|---|---|
| Per-product lookahead that grows when a rival sells first | No better than a fixed lookahead. |
| Skipping the fourth land quadrant ($4,000) | Worse: the land pays back in tomatoes, milk and strawberries. |
| Filling the fourth quadrant with carrots using one extra hired hand | 12-56-12; daily hire costs eat the profit. |
| Race-detection horizon constants | No measurable effect. |
| Longer sale reservation window, earlier advance start, dawn-turn advance | No effect. |
| Advancing fertilizer sales | Worse. |
| Lookahead 24 / 28 on top of v2.1 | Wins arena races against our own variants but loses real ladder games. |
| 8-10 sheep instead of 6 when yarn stores appear | 21-50% win rate, -$1.5k to -$7.5k. |
| Sheep expansion with only 1 yarn store | -$2.1k. |
| Tomatoes with 2 instead of 3 pizza/farmers-market shops | -$572. |
| Swapping a small sale for a big one when the order list is full | Fixes the loss it was built for, but 16-16 vs v2.1 overall; needs a narrower trigger. |

## Lessons

- **Correlation in replays is not a strategy.** In 1,465 top-team games, players with 3-5 more sheep won
  ~80% when two or more yarn stores appeared. Copying that in our agent lost: stronger teams simply run
  bigger herds.
- **Test against real opponents, not just copies of yourself.** A longer lookahead beats our own shorter
  variants every time, yet it loses games against the agents actually on the ladder.
- **Re-run the losses.** Ladder replays reproduce exactly from the recorded actions and seed, so a loss
  can be taken apart turn by turn (for example, a single wool sale one turn late decided a $67 game).
- **Seed handling matters.** A hand-written step loop resolved the episode seed differently from a real
  run and gave wrong town shops; only the engine's own run loop matches the ladder.

## Ladder loss breakdown (crimson_v2, 85 games)

- 64 wins, 21 losses.
- About half the losses were by under $1.1k against near-copies of V46, spread over many small sale
  timing and order differences.
- The rest were different strategies winning by $2k-17k: wool-heavy herds with many yarn stores,
  tomatoes, or heavy wheat trading.

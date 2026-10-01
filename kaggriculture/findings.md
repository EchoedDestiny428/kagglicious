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

# Late competition (2026-09-21 to 09-30)

## The field moved under us

- New public engines arrived every few days and each one beat the previous line by a wide margin: cha22 (public
  V39 + v9 layers, 09-24), then TTV1 / "2965+ Master Engine" (09-27/28), which beat our cha22 build 28-4. Within a
  day of each release most of our band ran it.
- The whole ladder deflated by roughly 45 Elo a day in the last week (the silver line went 2471 -> 2413 -> 2349 ->
  2305 -> ~2050), so ratings from different days do not compare.
- A notebook watch that only flags new notebooks misses the important updates: popular notebooks were re-run with
  new agents under the same name. Pull the outputs of recently re-run notebooks, not just new ones.
- Some public agents do not run as published: MarketShock-M1 defines its entry point before a final patch function,
  so Kaggle's "last callable in the module" loader would call the patch function instead of the agent.

## The wheat tick trade

- **Mechanics.** Every 4th turn each open shop takes wheat off the market (1 unit per wheat-buying shop: bakery,
  pizza shop, brunch spot, ice-cream shop, farmers market). The wheat quote is `25 + 20 * sqrt((10000 - stock) / 400)`
  below 10,000 units, rounded. Buying a lot on the tick turn and selling it on the next turn therefore sells every
  unit a little higher than it was bought: +$4-12 per 60-unit lot with 2-4 wheat shops, never negative.
- **Found by** taking apart close losses item by item: everything matched except wheat - in our close losses the
  rival bought ~1,070 wheat a game (we bought ~340); in our close wins the reverse (780 vs 550). The winner bought
  at hours 4/8/12/16/20 and sold an hour later.
- **Our engine already did it, sometimes.** The trade sits inside some of the recorded route tapes, so it ran only
  for certain shop openings. Making it a layer that runs every game (v11.3) was worth ~$430 a game against rivals
  that do not trade it: v11.3 beat v11.1 in 28 of 29 local games, and won 54 of 80 real ladder games in replay where
  v11.1 won 29.
- **Order position decides everything when both sides trade.** The market settles both order lists slot by slot,
  unit by unit. If both farms buy wheat on the tick, the earlier slot buys cheaper and, next turn, the earlier slot
  sells dearer; the later one loses up to ~$110 a lot. Units beyond the rival's lot always fill last, so a bigger
  lot than the rival's loses money (80- and 90-unit lots lost $4-10k a game to our own 60-unit build).
- **Our slot rule.** Ladder rivals put the buy at the end of their list and the sale right after their last SELL.
  Putting both of ours right after our last SELL (and merging the sale into the parent's own wheat sale) is never
  behind them on the same list: +$3.0-4.3k a game against a copy of that convention.
- **Hide the lot from the rest of the agent.** While the lot is held, the parent agent is shown a shed (and, from
  v11.5, a till) without it, so every other decision is the one it would have made anyway.
- **Shed limit.** Keeping the shed load at 75 or below is safe; 95 overflows and loses production.

## The counter-game at 2000+ Elo

Re-running our ladder losses showed rivals that exploit tick traders:

| Rival behaviour | Effect on a tick trader |
|---|---|
| Buy ~95 wheat in slot 0 and sell it in slot 9 of the same tick turn (a sandwich) | Our lot pays their lifted quote and sells at the normal one: about -$175 a lot, -$8-12k a game |
| Buy ~32 wheat the turn before the tick, sell it in the last slot of the tick turn (switches to this after seeing us trade) | +$60 a lot for them, -$54 for us |
| Buy 60 and sell 60 in adjacent slots of the tick turn | skims ~$26 off our lot |
| Trade the tick in lockstep with a smaller lot | the smaller lot wins; ours loses $5-15 a lot |

- **Front-run stop (v11.6).** On a turn where the lot is our only order, the till shows exactly what it cost and what
  it cleared for. A lot that cost more than $1.5 a unit above the modelled solo cost, or cleared below -$30, stops
  the trade for the rest of the game. Against a sandwich bot: v11.3 lost 30 of 32 (-$5,447 in one game), v11.6 won 26
  of 32. Until two clean lots have paid, lots go only on turns with no other order.
- **Replays do not see adaptive rivals.** Against 150 recorded ladder games v11.6 and v11.3 won the same number; on
  the live ladder v11.3 settled about 100 Elo higher. Rivals that switch tactics after seeing us trade are invisible
  to a replay of their recorded moves.

## What didn't work (late)

| Idea | Result |
|---|---|
| Longer sale lookahead on the cha22 base (12, 18) | Beat our own variants locally, did worse on the ladder (v10.2 / v10.3) |
| God's Mode shop overlay on top of our agent | 12/32 vs TTV1 (unwrapped: 26/32) |
| Bigger wheat lot while the rival trades no wheat (85 / shed 95) | 10/32 vs v11.1, -$196 a game: the shed overflows |
| Same at 80 / shed 90 | +$4-54 a game vs non-traders, but 8/32 vs a late-starting trader |
| Two-strike stop and a smaller lot while lots lose | 127 of 179 ladder replays, same as v11.6; 0/32 vs the sandwich bot |
| Opponent fingerprints (turn-1 cash, unit positions, race detector) | Identical across engine families through day 8 |

## Where the last losses came from (v11.6, 25 recent ladder games)

- 7 of 11 losses were to rivals that trade no wheat and simply out-produce us: per game ~11 more wool, ~20 more
  strawberries and ~16 more carrots (their route plans, not sale timing).
- 4 were adaptive wheat traders (the stop fired; 2 of those 4 games still lost).
- At ~2000 Elo a growing share of games are $10-30k losses to clearly stronger farms.

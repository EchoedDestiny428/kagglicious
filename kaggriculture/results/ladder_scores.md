# Ladder scores

Kaggle public ladder (Elo; new submissions start at 600). The table below is the snapshot from 2026-09-20; every later
submission, with its id, hash and ladder score, is in [../submissions/README.md](../submissions/README.md).

| Submission | File | Submitted (UTC) | Description | Peak Elo | Elo now |
|---|---|---|---|---|---|
| 56206351 / 56206346 / 56199647 | main.py | 2026-09-13 | NN-labelled and heuristic versions | 617 | 522-617 |
| 56279111 | main.py (v9) | 2026-09-16 | hand-tuned heuristic | 639 | 625 |
| 56293351 | crimson_v1.py | 2026-09-17 03:31 | sale lookahead 16 | 2750 | 2750 |
| 56295589 | crimson_v2.py | 2026-09-17 05:12 | sale lookahead 16, turn-1 wheat buy 30->15 | 2862 | 2814 |
| 56303867 | crimson_v2.1.py | 2026-09-17 11:58 | v2 + same-turn sale order fix | 2826 | 2826 |
| 56317029 | crimson_v3.py | 2026-09-18 | v2.1 + day-6 route table | ~2798 | 2747 |
| 56326472 | crimson_v3.1.py | 2026-09-18 | v3 + 7 more route-table pairs | - | 2552 |
| 56351518 | crimson_v3.2.py | 2026-09-19 | v3.1 + 6 more shop routes | 2454 | 2422 |
| 56358210 | crimson_v3.3.py | 2026-09-19 | v3.2 + routes used only against V46 openers | - | 2361 |
| 56380718 | crimson_v4.py | 2026-09-20 | new base (public V50) + our routes, sale order and opening | - | validating |

Leaderboard context (2026-09-17): #1 at ~3185, #10 at ~3034, #20 at ~2946. On 2026-09-13 there were 8,879
teams, 679 of them at 2500+.

`ladder_history.log` is the raw log from our watchdog script: one line per finished ladder game with the
submission and its Elo after the game.

## crimson_v2 ladder sample (85 games)

64 wins, 21 losses. Replaying the same 85 games with the opponents' recorded moves:

| Agent in our seat | Wins |
|---|---|
| crimson_v2 (what actually happened) | 64 |
| crimson_v2.1 | 68 |
| v2.1 + lookahead 24 | 65 |
| v2.1 + lookahead 28 | 63 |
| crimson_v3 | 72 |

## Standing over the last week

| Date (UTC) | Our best agent | Rank | Silver line (top 5%) |
|---|---|---|---|
| 2026-09-24 | crimson v5.12, 2598.6 | 296 of ~9,930 | ~2470 |
| 2026-09-26 | crimson v10, 2464 | 387 of 10,026 (silver) | 2413 |
| 2026-09-27 | crimson v10.1, 2276 | 668 | 2349 |
| 2026-09-29 | crimson v11.1, 2250 | 488 (silver) | 2239 |
| 2026-09-30 23:59 (deadline) | crimson v11.6, 1982 | 632 of 10,246 | 2048 |

`ladder_history.log` now runs from 2026-09-13 to the deadline: one line per finished ladder game with the submission
and its Elo after the game.

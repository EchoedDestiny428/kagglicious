# Ladder scores

Kaggle public ladder (Elo; new submissions start at 600). Snapshot 2026-09-19.

| Submission | File | Submitted (UTC) | Description | Peak Elo | Elo now |
|---|---|---|---|---|---|
| 56206351 / 56206346 / 56199647 | main.py | 2026-09-13 | NN-labelled and heuristic versions | 617 | 522-617 |
| 56279111 | main.py (v9) | 2026-09-16 | hand-tuned heuristic | 639 | 625 |
| 56293351 | crimson_v1.py | 2026-09-17 03:31 | sale lookahead 16 | 2750 | 2750 |
| 56295589 | crimson_v2.py | 2026-09-17 05:12 | sale lookahead 16, turn-1 wheat buy 30->15 | 2862 | 2814 |
| 56303867 | crimson_v2.1.py | 2026-09-17 11:58 | v2 + same-turn sale order fix | 2826 | 2826 |
| 56317029 | crimson_v3.py | 2026-09-18 | v2.1 + day-6 route table | ~2798 | 2747 |
| 56326472 | crimson_v3.1.py | 2026-09-18 | v3 + 7 more route-table pairs | - | 2552 |
| 56351518 | crimson_v3.2.py | 2026-09-19 | v3.1 + 6 more shop routes | - | validating |

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

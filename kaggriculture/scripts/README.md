# Tools

Local test tools for the kaggriculture environment (kaggle-environments 1.32.7). Agents are loaded exactly like
Kaggle loads `main.py`.

| Script | What it does |
|---|---|
| `arena.py` | Seeded head-to-head games, both seats, one process per game; W-L-T, mean cash, margin, worst move time. |
| `check_agent.py` | Pre-submission check: full games, per-move timing, statuses, the agent's own error counters. |
| `csweep.py`, `h2h_sweep.py` | Build every single-constant variant of an agent and play each against the base. |
| `fetch_losses.py` | Download our recent ladder replays (Kaggle CLI on PATH). |
| `replay_cf.py`, `diff_replay.py`, `cf_sweep.py` | Counterfactual replays: our candidate plays a real ladder game's seed against the rival's recorded moves. |
| `shadow_diff.py`, `who_is_rival.py` | Shadow-run a known agent in the rival's seat to identify which engine a rival runs. |
| `sale_gap.py` | Where close games are decided: units sold, prices and revenue per item for us and the rival. |
| `wheat_trace.py`, `wheat_slots.py` | Both farms' wheat orders around the shop ticks, with order-list slots. |
| `wt_lot_log.py` | Replays the wheat tick trade against ladder rivals and logs every lot's result and the stop. |
| `cash_check.py` | Lowest till and hired hands per game, to rule out cash starvation. |
| `hire_fail.py`, `stall_scan.py`, `loss_forensics.py` | Ladder-loss forensics: failed hires, idle units, the day a loss opens up. |
| `family_gap.py`, `family_vs.py`, `openings.py`, `diverge_probe.py` | Group rivals by opening and by the step where they stop matching us. |
| `watch_public.py`, `nb_extract.py`, `unpack_b85.py`, `nb_cell_code.py` | Watch public notebooks and extract their agents without running them. |
| `lb_line.py`, `recent_record.py`, `margintab.py`, `wintab.py` | Leaderboard lines, recent ladder record, win and margin tables. |

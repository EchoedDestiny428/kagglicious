"""Explain a ladder game between two near-identical agents.

  python diff_replay.py REPLAY.json [--team lost] [--races 25]

Re-runs the game in the official engine with both players' recorded actions (same seed and
configuration), checks that the rewards reproduce, and records every market unit. Prints:
  - first steps where the two players' actions differ (market / units)
  - per-product revenue for both players and the gap
  - sale races: steps where both players sold the same item within a few turns, who sold
    first (earlier step, or same step with an earlier list index) and what it was worth
  - the cash gap at the start of each day
"""
import argparse, contextlib, io, json
from collections import defaultdict


def tape_agent(actions):
    def agent(obs, config=None):
        step = int(obs["step"])
        return actions[step] if step < len(actions) else {}
    return agent


def reproduce(rep):
    from kaggle_environments import make
    from kaggle_environments.envs.kaggriculture import kaggriculture as K

    steps = rep["steps"]
    tapes = [[steps[t + 1][p].get("action") or {} for t in range(len(steps) - 1)] for p in (0, 1)]
    farms_ref, clock = {}, {"step": 0}
    events = []   # (step, player, seq, op, item, price, cash_delta)
    seq = defaultdict(int)
    orig_commit = K._commit_unit

    def commit(op, item, price, farm, private, market, shed_capacity=100):
        before = farm["money"]
        ok = orig_commit(op, item, price, farm, private, market, shed_capacity)
        p = farms_ref.get(id(farm))
        if ok and p is not None:
            # one counter per step shared by both players: a lower number committed earlier
            events.append((clock["step"], p, seq[clock["step"]], op, item, price, farm["money"] - before))
            seq[clock["step"]] += 1
        return ok

    orig_interp = K.interpreter

    def interp(state, env):
        obs0 = state[0].observation
        if getattr(obs0, "farms", None):
            for i, f in enumerate(obs0.farms):
                farms_ref[id(f)] = i
            clock["step"] = getattr(obs0, "step", 0) or 0
        return orig_interp(state, env)

    K._commit_unit = commit
    # Kaggle stores the episode seed in info, not in the configuration
    cfg = {"seed": rep["info"]["seed"], "episodeSteps": rep["configuration"]["episodeSteps"], "actTimeout": 30}
    try:
        with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            env = make("kaggriculture", configuration=cfg, debug=False)
            env.interpreter = interp
            final = env.run([tape_agent(tapes[0]), tape_agent(tapes[1])])[-1]
    finally:
        K._commit_unit = orig_commit
    return tapes, [final[0].reward, final[1].reward], events


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("replay")
    ap.add_argument("--team", default="clove instalocker")
    ap.add_argument("--races", type=int, default=25)
    ap.add_argument("--window", type=int, default=3)
    args = ap.parse_args()
    rep = json.load(open(args.replay))
    names = rep["info"].get("TeamNames", ["?", "?"])
    me = names.index(args.team) if args.team in names else 0
    op = 1 - me
    tapes, rewards, events = reproduce(rep)
    print(f"{args.replay} | us={names[me]} (P{me}) vs {names[op]} | replay rewards {rep['rewards']} | re-run {rewards}"
          f" | {'REPRODUCED' if list(rewards) == list(rep['rewards']) else 'MISMATCH'}")

    diffs = [t for t in range(len(tapes[0])) if tapes[0][t] != tapes[1][t]]
    mdiffs = [t for t in diffs if (tapes[0][t].get("market") or []) != (tapes[1][t].get("market") or [])]
    print(f"\nsteps with different actions: {len(diffs)} (market differs: {len(mdiffs)})")
    for t in mdiffs[:12]:
        print(f"  step {t:3d} d{t // 24}h{t % 24:02d}  us={tapes[me][t].get('market')}\n{'':19s}op={tapes[op][t].get('market')}")

    rev = [defaultdict(float), defaultdict(float)]
    cnt = [defaultdict(int), defaultdict(int)]
    for s, p, q, o, item, price, d in events:
        rev[p][f"{o}:{item}"] += d
        cnt[p][f"{o}:{item}"] += 1
    print("\nper product (us / op / gap):")
    for k in sorted(set(rev[0]) | set(rev[1]), key=lambda k: -abs(rev[me][k] - rev[op][k])):
        g = rev[me][k] - rev[op][k]
        if abs(g) >= 1:
            print(f"  {k:22s} {rev[me][k]:>10,.0f} ({cnt[me][k]:4d}u)  {rev[op][k]:>10,.0f} ({cnt[op][k]:4d}u)  gap {g:>+9,.0f}")

    # sale races: group each player's SELL units by (item, step)
    sells = [defaultdict(list), defaultdict(list)]
    for s, p, q, o, item, price, d in events:
        if o == "SELL":
            sells[p][(item, s)].append((q, price))
    races = []
    for (item, s), units in sells[me].items():
        for t in range(s - args.window, s + args.window + 1):
            if (item, t) not in sells[op]:
                continue
            ou = sells[op][(item, t)]
            if t == s:
                first = "us" if min(q for q, _ in units) < min(q for q, _ in ou) else "op" if min(q for q, _ in ou) < min(q for q, _ in units) else "tie"
            else:
                first = "us" if s < t else "op"
            races.append((s, t, item, len(units), sum(p for _, p in units), len(ou), sum(p for _, p in ou), first))
    races.sort()
    wins = defaultdict(int)
    for r in races:
        wins[r[-1]] += 1
    print(f"\nsale races (same item within {args.window} turns): {len(races)}  first seller: {dict(wins)}")
    for s, t, item, nu, pu, no, po, first in races[:args.races]:
        print(f"  {item:10s} us@{s:3d} {nu:3d}u ${pu:>7,.0f}  op@{t:3d} {no:3d}u ${po:>7,.0f}  first={first}")

    steps = rep["steps"]
    print("\ncash gap (us - op) at day start:")
    line = []
    for day in range(30):
        t = day * 24
        if t >= len(steps):
            break
        f = steps[t][0]["observation"]["farms"]
        line.append(f"d{day}:{f[me]['money'] - f[op]['money']:+.0f}")
    print("  " + " ".join(line))


if __name__ == "__main__":
    main()

"""Pre-submission check for one agent file: full games with no parallel load, per-call
timing against the 1 s actTimeout, final statuses, and the agent's own error counters.

  python check_agent.py AGENT OPPONENT [SEEDS...]
"""
import contextlib
import io
import sys
import time

from kaggle_environments import make
from kaggle_environments.agent import get_last_callable


def load(path):
    with open(path, encoding="utf-8") as f:
        return get_last_callable(f.read(), path=path)


def main():
    agent_path, opp_path = sys.argv[1], sys.argv[2]
    seeds = [int(s) for s in sys.argv[3:]] or [11, 12]
    worst = 0.0
    for seed in seeds:
        for seat in (0, 1):
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                me, opp = load(agent_path), load(opp_path)
            times = []

            def timed(obs, config, fn=me):
                t = time.perf_counter()
                out = fn(obs, config)
                times.append(time.perf_counter() - t)
                return out

            agents = [timed, opp] if seat == 0 else [opp, timed]
            env = make("kaggriculture", configuration={"seed": seed, "episodeSteps": 720}, debug=False)
            with contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
                final = env.run(agents)[-1]
            ts = sorted(times)
            worst = max(worst, ts[-1])
            tele = getattr(me, "telemetry", {}) or {}
            errs = {k: v for k, v in tele.items() if "error" in k and v}
            print(f"seed {seed} seat {seat}: rewards {[s.reward for s in final]} statuses {[s.status for s in final]} "
                  f"calls {len(ts)} first {1000 * times[0]:.0f}ms p99 {1000 * ts[int(0.99 * (len(ts) - 1))]:.1f}ms "
                  f"max {1000 * ts[-1]:.1f}ms errors {errs or 'none'}")
    print(f"worst call {1000 * worst:.1f} ms (limit 1000 ms)")


if __name__ == "__main__":
    main()

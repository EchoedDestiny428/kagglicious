# Recent ladder record per replay dir: totals, the last N results with margins, and the last N by opponent wheat trading.
import collections, json, sys
n = 25
for d in sys.argv[1:]:
    rows = [json.loads(l) for l in open(d + "/results.jsonl")]
    rows = [r for r in rows if r.get("seat", -1) >= 0]
    rows.sort(key=lambda r: r["episode"])
    c = collections.Counter(r["result"] for r in rows)
    last = rows[-n:]
    print(d, len(rows), dict(c), "| last", len(last), dict(collections.Counter(r["result"] for r in last)))
    print("   ", " ".join(r["result"] + str(int(r["rewards"][r["seat"]] - r["rewards"][1 - r["seat"]])) for r in last))

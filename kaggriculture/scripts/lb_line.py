# Our rank and the silver/bronze lines from a downloaded leaderboard zip (dir given as argv[1]).
import csv, glob, io, sys, zipfile
z = zipfile.ZipFile(glob.glob(sys.argv[1] + "/*.zip")[0])
rows = list(csv.DictReader(io.TextIOWrapper(z.open(z.namelist()[0]), encoding="utf-8")))
n = len(rows); s = round(n * 0.05); b = round(n * 0.10)
us = [f"{i + 1}@{r['Score']}" for i, r in enumerate(rows) if r["TeamName"] == "clove instalocker"]
print("us", *us, "| silver", s, rows[s - 1]["Score"], "| bronze", b, rows[b - 1]["Score"])

# crimson source

`build_crimson.py` builds every crimson version from a pinned public base in `base/` plus our own layers, so each
release is reproducible byte for byte:

```
python build_crimson.py 11.6          # writes versions/crimson_v11.6.py
sha256sum versions/crimson_v11.6.py   # compare with ../submissions/SHA256SUMS
```

Each version is a list of exact text patches and appended blocks; a patch must match the base exactly once, so a
change can never silently stop applying. The base file's SHA-256 is checked before building.

| Base (`base/`) | Public notebook it was taken from | Used by |
|---|---|---|
| `pub_v46.py` | Kaggriculture V46 (Ahmed Berat Ozer) | crimson v1-v3.3 |
| `pub_v50.py` | V50, same lineage | crimson v4 |
| `pub_meta13.py` | Metav4 v13 | crimson v5.x |
| `pub_rescue.py`, `pub_v56.py` | rescue / V56 lineage | experiments |
| `pub_cha22.py` | public V39 + v9 layers (abhinav0370) | crimson v10.x |
| `pub_ttv1.py` | "top-2 master engine v4" (guruprasaathas111), as republished in TTV1 | crimson v11.x |
| `pub_2965.py` | "2965+ Master Engine", a close variant of the TTV1 engine | test opponent |

All bases are Apache License 2.0; their notices are kept in each file. Kaggle runs `main.py` by calling the last
callable defined in the module, so every layer ends with `agent = globals().pop('agent')` to stay last.

"""Unpack a notebook's PAYLOAD_B85 bundle (base85 + lzma, [2-byte count][2-byte name len][name][8-byte size][data]...)
into a folder without executing the notebook, verifying the sha256 list the notebook carries.

  python unpack_b85.py NOTEBOOK.ipynb OUT_DIR
"""
import ast, base64, hashlib, json, lzma, pathlib, re, sys

nb, out = sys.argv[1], pathlib.Path(sys.argv[2])
cells = ["".join(c["source"]) for c in json.load(open(nb))["cells"] if c["cell_type"] == "code"]
src = next(c for c in cells if "PAYLOAD_B85" in c)
payload = ast.literal_eval(re.search(r"^PAYLOAD_B85 = (.*)$", src, re.M).group(1))
expected = ast.literal_eval(re.search(r"^EXPECTED_SHA256 = (.*)$", src, re.M).group(1))
blob = lzma.decompress(base64.b85decode(payload))
out.mkdir(parents=True, exist_ok=True)
cur = 0
n = int.from_bytes(blob[cur:cur + 2], "big"); cur += 2
for _ in range(n):
    k = int.from_bytes(blob[cur:cur + 2], "big"); cur += 2
    name = blob[cur:cur + k].decode(); cur += k
    size = int.from_bytes(blob[cur:cur + 8], "big"); cur += 8
    data = blob[cur:cur + size]; cur += size
    ok = hashlib.sha256(data).hexdigest() == expected.get(name)
    (out / name).write_bytes(data)
    print(f"{name:24s} {size:9d} bytes sha256 {'OK' if ok else 'MISMATCH'}")

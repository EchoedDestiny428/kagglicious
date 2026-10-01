"""Extract the agent (main.py) from pulled notebook folders and fingerprint it.

  python nb_extract.py ROOT SLUG [SLUG ...]

For each ROOT/SLUG: untar submission.tar.gz if present; otherwise decode base64 blobs (optionally compressed,
optionally a tar) or %%writefile cells from the .ipynb. Prints sha256, size, entry-point count, base markers and
the first bytes.
"""
import base64, bz2, glob, gzip, hashlib, io, json, lzma, os, re, sys, tarfile, zlib

MARKERS = ["_R108_SHOP_ROUTES", "Metav4", "7-Turn", "rescue", "_ALT_REPORT", "_CXD_", "EXP293", "Herd-Safe", "herd_safe", "_HS_",
           "HybridOpening", "order book", "V56", "V57", "Funding-Order", "sr18", "Market Stack"]


def from_tar(path, out_dir):
    try:
        with tarfile.open(path) as t:
            names = t.getnames()
            for m in t.getmembers():
                if m.name.endswith("main.py") or (m.name.endswith(".py") and len(names) == 1):
                    data = t.extractfile(m).read()
                    open(os.path.join(out_dir, "main.py"), "wb").write(data)
                    return f"tar member {m.name} of {names[:6]}"
            return f"tar without main.py: {names[:8]}"
    except Exception as e:
        return f"tar error {e}"


def from_notebook(nb, out_dir):
    d = json.load(open(nb, encoding="utf-8"))
    notes = []
    for i, c in enumerate(d.get("cells", [])):
        if c.get("cell_type") != "code":
            continue
        src = "".join(c.get("source", []))
        m = re.match(r"\s*%%writefile\s+(-a\s+)?(\S+)", src)
        if m and m.group(2).endswith("main.py") and "def agent" in src:
            body = src.split("\n", 1)[1] if "\n" in src else ""
            open(os.path.join(out_dir, "main.py"), "w", encoding="utf-8", newline="\n").write(body)
            return f"writefile cell {i}"
        for b in re.findall(r"[A-Za-z0-9+/=\n]{2000,}", src):
            try:
                raw = base64.b64decode(b.replace("\n", ""))
            except Exception:
                continue
            cands = [raw]
            for fn in (zlib.decompress, lzma.decompress, gzip.decompress, bz2.decompress):
                try:
                    cands.append(fn(raw))
                except Exception:
                    pass
            for cc in cands:
                try:
                    with tarfile.open(fileobj=io.BytesIO(cc)) as t:
                        for mm in t.getmembers():
                            if mm.name.endswith("main.py"):
                                open(os.path.join(out_dir, "main.py"), "wb").write(t.extractfile(mm).read())
                                return f"blob tar in cell {i}: {t.getnames()[:5]}"
                except Exception:
                    pass
                if b"def agent" in cc:
                    open(os.path.join(out_dir, "main.py"), "wb").write(cc)
                    return f"raw blob in cell {i}"
        notes.append(f"cell {i} {len(src)}b {src[:60]!r}")
    return "no agent found; cells: " + " | ".join(notes[:12])


def main():
    root = sys.argv[1]
    for slug in sys.argv[2:]:
        d = os.path.join(root, slug)
        print(f"==== {slug}")
        how = "already had main.py" if os.path.exists(os.path.join(d, "main.py")) else None
        if how is None:
            tars = glob.glob(os.path.join(d, "*.tar.gz")) + glob.glob(os.path.join(d, "*.tar"))
            for t in tars:
                how = from_tar(t, d)
                if os.path.exists(os.path.join(d, "main.py")):
                    break
        if not os.path.exists(os.path.join(d, "main.py")):
            for nb in glob.glob(os.path.join(d, "*.ipynb")):
                how = from_notebook(nb, d)
        p = os.path.join(d, "main.py")
        if not os.path.exists(p):
            print("  MISSING:", how); continue
        data = open(p, "rb").read(); text = data.decode("utf-8", "replace")
        print(f"  {how}; sha256 {hashlib.sha256(data).hexdigest()[:16]} size {len(data)} entry defs {len(re.findall(r'^def agent|^agent *=', text, re.M))}")
        found = {m: text.count(m) for m in MARKERS if m in text}
        print("  markers:", found)
        print("  head:", text[:300].replace("\n", " | "))


if __name__ == "__main__":
    main()

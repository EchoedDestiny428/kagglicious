"""Print a notebook code cell with its long string constants elided, so the unpacking logic can be read without the
payload. Constants are shown as NAME = <str len N>.

  python nb_cell_code.py NOTEBOOK.ipynb CELL_INDEX
"""
import ast, json, sys

src = "".join(json.load(open(sys.argv[1]))["cells"][int(sys.argv[2])]["source"])
tree = ast.parse(src)
for node in tree.body:
    if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, (str, bytes)) \
            and len(node.value.value) > 200:
        print(f"{ast.unparse(node.targets[0])} = <{type(node.value.value).__name__} len {len(node.value.value)}>")
    else:
        print(ast.unparse(node))

import sys, json
outs = json.load(sys.stdin)
act = [o for o in outs if o.get("active")]
ext = [o for o in act if not o["name"].startswith("eDP")]
sel = ext or act
if sel:
    r = sel[0]["rect"]
    print(f'{r["width"]}x{r["height"]}')

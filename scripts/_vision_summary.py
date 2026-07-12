"""Reduce a /parse response to two whitespace-separated fields for smoke.sh.

Its own file rather than an inline `python3 -c`: quoting a JSON-handling script
through bash needs escaping that is easy to get subtly wrong, and did (a stray
`<<<` silently replaced the program with its own input).
"""

import json
import sys

try:
    d = json.load(sys.stdin)
except ValueError:
    d = {}

hud = d.get("characterHud") or {}
counts = sorted(d.get("tokenCounts") or [], key=lambda t: t["tokenName"])

print(
    "{}/{}".format(hud.get("name"), hud.get("level")),
    ",".join("{}={}".format(t["tokenName"], t["quantity"]) for t in counts) or "none",
)

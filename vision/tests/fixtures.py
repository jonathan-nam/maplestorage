"""Where the vision corpus lives, resolved once.

Anchored to this file rather than the working directory: three of the four test modules
used to hardcode "../test-fixtures", which only resolved when pytest ran from vision/.

The subdirectories are roles, not file types. `occluded/` is the set the parser must
REFUSE, so a capture landing in the wrong one turns a refusal test into a parse test
that happens to pass.
"""

from pathlib import Path

REF = Path(__file__).resolve().parents[2] / "test-fixtures"

INVENTORY = REF / "inventory"
OCCLUDED = REF / "occluded"
PLANNER = REF / "planner"
HUD = REF / "hud"

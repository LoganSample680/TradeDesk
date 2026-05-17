#!/usr/bin/env python3
"""
One-time script to fetch SW color data from the Sherwin-Williams Prism API
and write a clean sw-colors.json with official colorFamilyNames.

Run from your Mac (not a server — datacenter IPs get blocked):
  python3 scripts/fetch-sw-colors.py

Output: sw-colors.json in the project root, ready to commit.
"""

import json, sys, re
try:
    import requests
except ImportError:
    print("pip install requests  — then re-run")
    sys.exit(1)

# ── Fetch ─────────────────────────────────────────────────────────────────────

URL = "https://api.sherwin-williams.com/prism/v1/colors/sherwin"
HEADERS = {
    "Accept": "application/json, text/plain, */*",
    "Referer": "https://www.sherwin-williams.com/",
    "Origin": "https://www.sherwin-williams.com",
    "User-Agent": (
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/125.0.0.0 Safari/537.36"
    ),
}

print("Fetching SW colors from Prism API…")
try:
    resp = requests.get(URL, headers=HEADERS, params={"lng": "en-US"}, timeout=30)
    resp.raise_for_status()
except Exception as e:
    print(f"Request failed: {e}")
    print("Make sure you're running this on a residential internet connection, not a VPN or server.")
    sys.exit(1)

raw = resp.json()
print(f"Got {len(raw)} colors from API")

# ── Map SW official families → our 13 display families ────────────────────────
#
# SW's colorFamilyNames uses these official values:
#   Red, Orange, Yellow, Green, Blue, Purple, Neutral, White
#
# "Neutral" is the big one — it covers grays, beiges, tans, browns, and blacks.
# We split it by lightness + chroma using the HSL values the API provides.

def sw_family_to_display(api_color):
    fams = [f.lower() for f in (api_color.get("colorFamilyNames") or [])]
    primary = fams[0] if fams else ""

    if primary == "red":
        # SW "Red" includes true reds and pinks — split by hue
        # Hue < 345 or > 0 and lightness high = pink; true red otherwise
        h = api_color.get("hue", 0)
        l = api_color.get("lightness", 0)
        if l > 55 or (h > 320 and h < 350 and l > 45):
            return "pink"
        return "red"

    if primary == "orange":
        # SW "Orange" contains warm browns at low lightness
        l = api_color.get("lightness", 0)
        s = api_color.get("saturation", 0)
        if l < 35 and s < 40:
            return "brown"
        return "orange"

    if primary == "yellow":
        l = api_color.get("lightness", 0)
        if l < 50:
            return "brown"
        return "yellow"

    if primary == "green":
        h = api_color.get("hue", 0)
        # Teal/blue-green range
        if 155 <= h <= 210:
            return "teal"
        return "green"

    if primary == "blue":
        h = api_color.get("hue", 0)
        if 155 <= h <= 200:
            return "teal"
        return "blue"

    if primary == "purple":
        return "purple"

    if primary == "white":
        return "white"

    if primary == "neutral":
        l = api_color.get("lightness", 0)
        s = api_color.get("saturation", 0)
        h = api_color.get("hue", 0)
        # Very dark → black
        if l < 18:
            return "black"
        # Very light, low chroma → white
        if l > 82 and s < 20:
            return "white"
        # Light-medium, low chroma → gray or beige depending on hue
        if s < 12:
            return "gray"
        # Warm hues (yellow-orange range) at medium lightness → beige
        if 20 <= h <= 60 and l > 45:
            return "beige"
        # Warm darker tones → brown
        if 15 <= h <= 55 and l <= 45:
            return "brown"
        # Everything else in neutral → gray
        return "gray"

    # Fallback: classify by HSL
    l = api_color.get("lightness", 0)
    if l > 85:
        return "white"
    if l < 18:
        return "black"
    return "gray"


# ── Build output ──────────────────────────────────────────────────────────────

output = []
skipped_archived = 0
skipped_no_hex = 0

for c in raw:
    # Skip archived (discontinued) colors
    if c.get("archived") or c.get("ignore"):
        skipped_archived += 1
        continue

    hex_val = (c.get("hex") or "").strip()
    if not hex_val or not re.match(r'^#[0-9a-fA-F]{6}$', hex_val):
        skipped_no_hex += 1
        continue

    num = (c.get("colorNumber") or "").strip()
    sw_code = f"SW {num}" if num and not num.upper().startswith("SW") else num

    output.append({
        "sw":     sw_code,
        "name":   (c.get("name") or "").strip(),
        "hex":    hex_val.upper() if not hex_val.startswith("#") else hex_val,
        "family": sw_family_to_display(c),
        # Bonus fields — useful for display and future features
        "lrv":    round(c.get("lrv", 0), 1),
        "isDark": bool(c.get("isDark")),
    })

# Sort by SW number
def sort_key(c):
    m = re.search(r'\d+', c["sw"])
    return int(m.group()) if m else 0

output.sort(key=sort_key)

# ── Family summary ────────────────────────────────────────────────────────────
from collections import Counter
counts = Counter(c["family"] for c in output)
print(f"\nFamily distribution:")
for fam, count in sorted(counts.items()):
    print(f"  {fam:10s}: {count}")
print(f"\nTotal: {len(output)} colors")
print(f"Skipped archived: {skipped_archived}")
print(f"Skipped no-hex:   {skipped_no_hex}")

# ── Write ─────────────────────────────────────────────────────────────────────
import os
out_path = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "sw-colors.json")
with open(out_path, "w") as f:
    json.dump(output, f, indent=2)
print(f"\nWritten to {out_path}")
print("Review the family distribution above, then commit sw-colors.json.")

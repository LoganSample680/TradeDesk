#!/usr/bin/env python3
"""Extract js/finance.js — expense flow, exports, income, money page."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/finance.js'

RANGES = [
    (3019, 3948),   # IRS Schedule C: expense flow functions (stops before Receipt viewer wait...
    # actually 3019-3948 inclusive is expense functions up to end before Receipt viewer
    # Receipt viewer section starts at 3949, but we want to include it in finance.js
    # So Range 1: 3019-5021 (IRS expense + receipt + exports + income + renderSummary, stops before Money page)
    # Range 2: 5022-5218 (Money page + nav badge + collect modal + toggleDarkMode, stops before Notes canvas)
]

# Redefine cleanly
RANGES = [
    (3019, 5021),   # IRS Schedule C through renderSummary (stops before Money page at 5022)
    (5022, 5218),   # Money page through toggleDarkMode (stops before Notes canvas at 5219)
]

INSERT_AFTER = '<script src="js/tax.js"></script>'
NEW_TAG      = '<script src="js/finance.js"></script>'

with open(INDEX, 'r', encoding='utf-8') as f:
    lines = f.readlines()

extract_set = set()
for (s, e) in RANGES:
    extract_set.update(range(s - 1, e))

out_lines = [lines[i] for i in sorted(extract_set)]
new_index = []
for i, line in enumerate(lines):
    if i in extract_set:
        continue
    new_index.append(line)
    if line.rstrip() == INSERT_AFTER:
        new_index.append(NEW_TAG + '\n')

print(f'finance.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

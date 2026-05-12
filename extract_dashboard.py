#!/usr/bin/env python3
"""Extract js/dashboard.js — Step 6."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/dashboard.js'

# Range 1: _renderDashRunning + renderDash through renderPipeline (incl. collection/lien sections)
# Range 2: renderLeadsPage
RANGES = [
    (3237, 4338),
    (14930, 14977),
]

INSERT_AFTER = '<script src="js/cloud.js"></script>'
NEW_TAG      = '<script src="js/dashboard.js"></script>'

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

print(f'dashboard.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')

with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

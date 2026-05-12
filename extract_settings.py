#!/usr/bin/env python3
"""Extract js/settings.js — licensing, HEPA, scheduling, settings form, vehicles, onboarding, search."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/settings.js'

RANGES = [
    (2363, 3018),   # Licensing & Compliance through _vehKey (stops before Stripe Connect orphan comment)
    (3020, 3688),   # toggleAccSection + renderSettingsTrades + onboarding + global search
]

INSERT_AFTER = '<script src="js/generic-estimate.js"></script>'
NEW_TAG      = '<script src="js/settings.js"></script>'

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

print(f'settings.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

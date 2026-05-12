#!/usr/bin/env python3
"""Extract js/proposals.js — Gallery + Client Hub + proposal flow + change orders."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/proposals.js'

# Range 1: Gallery + Client Hub + proposal sending + signing/contract flow
# Range 2: Change Order System
RANGES = [
    (3017, 4842),
    (7138, 7362),
]

INSERT_AFTER = '<script src="js/paint-estimate.js"></script>'
NEW_TAG      = '<script src="js/proposals.js"></script>'

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

print(f'proposals.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

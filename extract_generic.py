#!/usr/bin/env python3
"""Extract js/generic-estimate.js — notes canvas + multi-trade + GEI + T&M + free-form + panel + industrial."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/generic-estimate.js'

START = 3020   # // ── Notes canvas
END   = 4784   # last line before toggleAccSection / settings (after End Industrial comment)

INSERT_AFTER = '<script src="js/finance.js"></script>'
NEW_TAG      = '<script src="js/generic-estimate.js"></script>'

with open(INDEX, 'r', encoding='utf-8') as f:
    lines = f.readlines()

extract_set = set(range(START - 1, END))
out_lines = [lines[i] for i in sorted(extract_set)]
new_index = []
for i, line in enumerate(lines):
    if i in extract_set:
        continue
    new_index.append(line)
    if line.rstrip() == INSERT_AFTER:
        new_index.append(NEW_TAG + '\n')

print(f'generic-estimate.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

#!/usr/bin/env python3
"""Extract js/tax.js — STATE_TAX constant + setTaxTab + calcTax."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/tax.js'

RANGES = [
    (3948, 4038),   # STATE_TAX constant
    (5112, 5312),   # setTaxTab + calcTax + all tax calc functions
]

INSERT_AFTER = '<script src="js/proposals.js"></script>'
NEW_TAG      = '<script src="js/tax.js"></script>'

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

print(f'tax.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

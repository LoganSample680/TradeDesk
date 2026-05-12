#!/usr/bin/env python3
"""Extract js/paint-estimate.js — SW Color Browser + painting estimate flow."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/paint-estimate.js'

START = 3015   # // ── SW Color Browser
END   = 5311   # last line before Stripe/Gallery orphan comments

INSERT_AFTER = '<script src="js/mileage.js"></script>'
NEW_TAG      = '<script src="js/paint-estimate.js"></script>'

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

print(f'paint-estimate.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

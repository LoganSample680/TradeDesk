#!/usr/bin/env python3
"""Extract js/clients.js — Step 7."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/clients.js'

START = 2871   # function openClientDetail
END   = 4099   # last line before // ── Trade Opportunities

INSERT_AFTER = '<script src="js/dashboard.js"></script>'
NEW_TAG      = '<script src="js/clients.js"></script>'

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

print(f'clients.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')
with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

#!/usr/bin/env python3
"""Extract js/navigation.js — Step 5."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/navigation.js'

START = 2869   # function openMobileMore
END   = 2929   # closing } of goPg

INSERT_BEFORE = '<script src="js/cloud.js"></script>'
NEW_TAG       = '<script src="js/navigation.js"></script>'

with open(INDEX, 'r', encoding='utf-8') as f:
    lines = f.readlines()

extract_set = set(range(START - 1, END))

out_lines = [lines[i] for i in sorted(extract_set)]
new_index = []
for i, line in enumerate(lines):
    if line.rstrip() == INSERT_BEFORE:
        new_index.append(NEW_TAG + '\n')
    if i in extract_set:
        continue
    new_index.append(line)

print(f'navigation.js: {len(out_lines)} lines | index.html: {len(lines)} → {len(new_index)}')

with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(out_lines)
with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)
print('Done.')

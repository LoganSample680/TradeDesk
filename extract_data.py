#!/usr/bin/env python3
"""Extract js/data.js from index.html — Step 4 of monolith refactor."""

INDEX = '/home/user/TradeDesk/index.html'
OUT   = '/home/user/TradeDesk/js/data.js'

# Contiguous block: submit guard vars through last getClient* helper
START = 2351   # // ── Submit guard
END   = 2568   # blank line after getClientIncome

# Insert data.js tag BEFORE cloud.js (so order is: utils → data → cloud → inline)
INSERT_BEFORE = '<script src="js/cloud.js"></script>'
NEW_TAG       = '<script src="js/data.js"></script>'

with open(INDEX, 'r', encoding='utf-8') as f:
    lines = f.readlines()

total = len(lines)
print(f'index.html: {total} lines')

extract_set = set(range(START - 1, END))   # 0-indexed
print(f'Extracting lines {START}–{END}: {len(extract_set)} lines')

cloud_lines = [lines[i] for i in sorted(extract_set)]

new_index = []
for i, line in enumerate(lines):
    if line.rstrip() == INSERT_BEFORE:
        new_index.append(NEW_TAG + '\n')
    if i in extract_set:
        continue
    new_index.append(line)

print(f'data.js: {len(cloud_lines)} lines')
print(f'new index.html: {len(new_index)} lines (was {total})')

with open(OUT, 'w', encoding='utf-8') as f:
    f.writelines(cloud_lines)

with open(INDEX, 'w', encoding='utf-8') as f:
    f.writelines(new_index)

print('Done.')

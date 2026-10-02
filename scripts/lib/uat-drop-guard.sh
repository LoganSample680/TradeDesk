# shellcheck shell=bash
# ── NOTHING UAT HAD MAY VANISH (owner 2026-09-23: "I bet it has") ──────────
# It had. An audit of every roll found a resolver bug deleting code twice: the
# Tim session's sign-out privacy fix, and the call that starts the county
# property sync. Neither produced a conflict or a message.
#
# The rule: a line on uat that the incoming branch never had cannot quietly
# disappear in a merge. If one is gone, something ate it, and the roll stops
# before the push rather than after.
#
# ── "NEVER HAD" MEANS NEVER, NOT "NOT IN ONE MERGE BASE" (2026-10-01) ──────
# The first version compared against `git merge-base`, which returns ONE
# common ancestor. After a branch has been rolled and merged into main a few
# times, uat and the branch have several equally good common ancestors, and on
# 2026-10-01 it picked one from before the Phones card existed. Every line of
# the Phones test script then looked "added by uat", the branch's own rewrite
# of three of them looked like a theft, and the roll needed the owner to
# override it. A false stop teaches people to type the override, which is how
# the real one gets waved through.
#
# So a line counts as known to the branch when it is in ANY common ancestor,
# or when the commit that put it on uat is in the branch's own history. Either
# way the branch saw that line and chose to change it. A line from a commit
# the branch never had is still exactly the theft this exists to catch.
#
#   uat_lost_lines <uat-ref> <branch-ref> <merged-ref>
# Prints "    <file>" then "      - <line>" for each line lost; nothing when
# the merge kept everything.
uat_lost_lines() {
  local uat="$1" branch="$2" now="$3" bases f gone line sha keep
  bases="$(git merge-base --all "$uat" "$branch" 2>/dev/null)"
  [ -z "$bases" ] && return 0
  local files=""
  for b in $bases; do
    files="$files"$'\n'"$(git diff --name-only "$b" "$uat" -- '*.js' '*.html' '*.css' '*.sql' '*.ts' '*.mjs' 2>/dev/null)"
  done
  for f in $(printf '%s\n' "$files" | sed '/^$/d' | sort -u); do
    git cat-file -e "$now:$f" 2>/dev/null || continue
    gone="$(perl -e '
      my ($uat,$now,@bases)=@ARGV; my (%b,%n);
      for my $base (@bases) {
        open(B,"-|","git","show",$base) and do { while(<B>){$b{$_}=1} close B };
      }
      open(N,"-|","git","show",$now) and do { while(<N>){$n{$_}=1} close N };
      open(U,"-|","git","show",$uat) or exit;
      while(<U>){ next if /^\s*$/; next if /APP_VERSION|CACHE|"version"/;
        print $_ if !$b{$_} && !$n{$_}; }
    ' "$uat:$f" "$now:$f" $(for b in $bases; do printf '%s ' "$b:$f"; done) 2>/dev/null)"
    [ -z "$gone" ] && continue
    # Who put each line on uat. A commit the branch has in its own history is
    # a commit whose lines the branch was free to rewrite.
    local blame
    blame="$(git blame --line-porcelain "$uat" -- "$f" 2>/dev/null | perl -ne '
      if (/^([0-9a-f]{40}) \d+ \d+/) { $c = $1; next }
      if (/^\t(.*)$/) { print "$c\t$1\n" }')"
    keep=""
    while IFS= read -r line; do
      [ -z "$line" ] && continue
      sha="$(printf '%s\n' "$blame" | awk -F'\t' -v l="$line" 'substr($0, index($0, "\t") + 1) == l { print $1; exit }')"
      if [ -n "$sha" ] && git merge-base --is-ancestor "$sha" "$branch" 2>/dev/null; then continue; fi
      keep="$keep      - $line"$'\n'
    done <<< "$gone"
    [ -n "$keep" ] && printf '    %s\n%s' "$f" "$(printf '%s' "$keep" | head -6)"$'\n'
  done
  return 0
}

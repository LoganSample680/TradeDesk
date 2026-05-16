# TradeDesk — Claude Instructions

## Git Workflow

**Always merge to main after every push to the feature branch.** Do this automatically without asking.

Merge pattern:
```
git fetch origin main
git checkout -b temp-main-merge origin/main
git merge --no-ff claude/review-app-ux-flow-mRafw
git push origin HEAD:main
git checkout claude/review-app-ux-flow-mRafw
git branch -D temp-main-merge
```

## Version Bumps

Every commit must bump the version in all three places simultaneously:
- `js/cloud.js` — `APP_VERSION='MM.DD.YY.NN'`
- `sw.js` — `CACHE = 'tradedesk-MM.DD.YY.NN'`
- `version.json` — `{"version":"MM.DD.YY.NN"}`

## Dev Branch

All development work goes on branch: `claude/review-app-ux-flow-mRafw`

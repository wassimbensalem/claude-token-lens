---
name: Release workflow — push before publish
description: Always push git commit to origin before running npm publish
type: feedback
---

Always `git push` before `npm publish`. Git should have the release commit before the package goes live on npm.

**Why:** Wassim flagged this after 0.1.1 was published to npm but the commit hadn't been pushed to GitHub yet — the two got out of sync.

**How to apply:** Ship order is always: commit → push → publish. Never publish without confirming `git log origin/main..main` is empty first.

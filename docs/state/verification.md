---
id: shared-tree-verification
title: Shared tree verification
kind: guide
status: reference
summary: Checks and limits for the shared tree change.
parent: shared-tree
sources:
  - test/tree.test.js
  - test/view.test.js
  - test/worker.test.js
  - test/store.test.js
  - test/migration.test.js
  - test/database.js
  - test/relationship-benchmark.js
  - package.json
checked: 548f05b
---

Checks ran on 2026-10-31 with Node.js 24.14.1 and the installed Wrangler 4.151.3. The local Worker used separate storage at `/tmp/ancestree-shared-dev`. Live data was not changed.

The viewer update also passed 26 tests, a Wrangler deployment dry run, a 0.8 duplicate check, and browser checks with existing and synthetic records. Browser checks found no clipped names in the synthetic data. Thirty cards retained their positions when the timelapse moved from 2026 to 1900. The mute control changed its state. Audio output was not measured. The new view module had 100% line coverage and each measured function scored below CRAP 10. Mutation testing killed 109 of 163 mutations; 54 survived. The browser module is outside Node coverage. UML metrics were not displayed because the viewer and Clojure CLI were unavailable.

The later color update passed 26 tests. A local browser check found all 61 cards visible, centered card names, and no viewport movement when another person was selected. The view module had 100% line coverage and each measured function scored below CRAP 10. Mutation testing reported 113 killed and 60 surviving mutations across the view module.

The position-based color field passed 26 tests. A browser check found 61 distinct card colors that stayed fixed when a person was selected. The view module had 100% line coverage and each measured function scored below CRAP 10. Mutation testing reported 125 killed and 157 surviving mutations across the view module. Color contrast was calculated for field samples; browser rendering and display hardware can differ.

The light-color and sibling update passed 27 tests. The local browser showed black card text and six highlighted siblings for a selected person. A calculation over 100,000 field positions found at least 6.1:1 contrast for black text after the maximum brightness reduction. Mutation testing reported 138 killed and 99 surviving mutations; all four selected sibling-highlight mutations were killed.

The shared-junction update passed 28 tests and a local timelapse check. Mutation testing reported 148 killed and 127 surviving mutations in the view module. Separate parent sets can still cross or overlap.

The lifespan and overlay update passed 29 tests. A local browser check showed four unknown birth years as `????` and no relationship overlay. All three mutations on the changed lifespan lines were killed. Existing functions in the tree module still exceed the CRAP threshold.

## Results

| Check | Result |
| --- | --- |
| Tests | 18 passed with `npm test` and `npm run coverage`. |
| Coverage | 74.11% of lines and 82.66% of branches in loaded source modules. Browser `app.js` is outside this measurement. |
| Mutation tests | 35 selected mutations in lock, validation, and distance logic were killed. Another 21 selected HTTP mutations were killed. No selected mutation survived. This is not a full-repository mutation score. |
| Duplicate check | No candidates at the 0.8 threshold across the four source files. Dryer parsed JavaScript with its TypeScript grammar through a temporary extension mapping because its installed file discovery omits `.js`. |
| Complexity | The CRAP threshold of 10 was not met. `draw` scored 1056 with no automated browser coverage. The new access functions scored 4, 5, and 6; distance calculation scored 9. Existing validation and viewer functions still exceed the target. |
| Migration | Empty-install and two-tree collision tests passed. They checked records, foreign keys, creator attribution, relationships, comments, replay, and old media paths. All three migrations also ran in an isolated local D1 instance. |
| Stale writes | A stale edit could not overwrite a concurrent lock or advance the sequence. |
| Color contrast | All seven gradient levels passed a 4.5 text-contrast threshold for the card subtitle color. |
| Distance benchmark | All 100,000 people and 99,999 links were traversed correctly. Two local runs took 75.3 ms and 101.2 ms. This measures distance calculation only. |
| Browser | Public viewing, locked-node details, another user's unlocked-node edit, creator lock and unlock, and text distance labels were checked through the local UI. |
| State diagrams | Both Mermaid diagrams rendered in the browser. Behavior was checked against source. |
| Build | Wrangler's deployment dry run passed. JavaScript syntax checks and `git diff --check` passed. |
| Comment critic | A separate read-only critic reviewed the diff. Ten obsolete comment blocks were removed with their code. Three comments remain. The time comment was corrected to state the current rule. |
| UML viewer | Did not run. Its checkout and the Clojure CLI were not found. A Java runtime exists in Rider, but is not on PATH. Complexity, duplicate, and mutation snapshots were generated under `.metrics/`. |

The edit transaction uses the existing D1 batch pattern. See [D1 batch behavior](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch).

## Action record

1. Read the standing skills, source, schema, and all edit callers. Kept the pre-existing `temp/` files unchanged.
2. Added access and distance tests. Confirmed that they failed before the implementation changed.
3. Removed family creation, membership, roles, invites, and whole-tree deletion. Added the shared-tree migration and creator lock checks.
4. Connected public viewing, registered contributions, lock controls, and relation colors to the existing UI. Checked these with separate local accounts.
5. Ran the tests, migration, build, duplicate analysis, complexity analysis, mutation tests, contrast checks, and benchmark. Recorded both successful checks and limits.
6. Added the state map and migration instructions. Kept generated reports and test storage out of source control.

## Gaps

The full graph still loads for snapshots, validation, layout, and replay. There are no population-scale tests, viewport bounds, indexed neighborhood loading, or distributed writes. The benchmark does not establish whole-viewer performance.

The complexity target remains unmet in existing functions and browser code. The UML viewer needs its checkout and Clojure CLI. Full-repository mutation testing, automated browser coverage, live migration, and live deployment did not run.

The existing comment-count rule uses request time. A comment created during the snapshot can be included in the initial count and then counted again by polling. This existing behavior needs a separate sequence-based count test and fix.

The live migration makes prior tree data public and removes memberships and invites. Export and review existing data before applying it. There is no automatic merge for duplicate people or creator recovery process.

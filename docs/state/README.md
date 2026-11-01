---
id: shared-tree
title: Shared human tree
kind: system
status: implemented
summary: Public viewing and registered contributions use one graph.
parent: null
sources:
  - worker.js
  - store.js
  - public/app.js
  - public/tree.js
  - public/view.js
  - public/palette.js
  - migrations/0003_shared_tree.sql
checked: 3a12108
diagramLinks:
  Locks: node-locks
---

Anyone can read the shared tree. A registered user can add people and edit unlocked nodes. A creator can lock a node. There is no membership or owner role.

```mermaid
flowchart LR
    Browser[Tree viewer] --> API[Worker API]
    API --> Locks[Node edit rules]
    API --> Store[Data access]
    Store --> D1[People and history]
    Store --> R2[Media objects]
    Browser --> Colors[Branch colors and distance]
```

The arrows show calls and data access. They are not a sequence of states.

The Worker uses one internal tree record with ID `human`. The database retains `tree_id` columns for stored records. The viewer uses `/api/tree`. Public responses do not include account email addresses. Comments can be edited or deleted only by their author.

Edits read a sequence and the current entities. Validation checks node revisions, locks, relationship endpoints, and graph rules. The database batch writes only if the sequence is still current. If another write wins, the Worker reads the data again and repeats validation.

Each card samples a continuous color field at its layout position. Fixed seeded cell centers use 1,000 colors from the palette file. Colors are light enough for black card text. Colors remain stable when the selection changes, but can change when the layout changes. Each parent, child, or partner link adds one step. Cards and connections become less saturated and slightly darker with distance; all remain visible. Siblings who share a recorded parent and their connections to that parent are highlighted. The viewer starts with the most connected person selected. Clear selection removes the distance emphasis. Labels give the distance in text. Selecting a person does not move the viewport.

Timelapse uses one layout for all years. Cards enter from a visible relative when possible, and a sound can mark arrivals. The viewport stays in place while the year changes.

Children with the same visible parent set share a branch and junction. A recorded partner connection supplies its midpoint as the start of the branch. Shared segments retain their underlying relationship IDs for selection. A mixed dash pattern marks segments that represent both birth and non-birth links.

Branches meet at common endpoints and curve into each child. When a parent appears in multiple parent sets, overlapping outgoing segments are combined and split at their junctions.

When a death year is known but the birth year is not, the card shows `????` in place of the birth year.

See [node locks](node-locks.md), [migration and limits](../../README.md), and [verification results](verification.md).

## Gaps

The viewer and validator load the full graph. Population-scale loading, rendering, and concurrent writes need a separate design and load tests. Browser checks do not contribute to Node coverage. Separate parent sets and complex partnerships can still produce crossings or overlaps.

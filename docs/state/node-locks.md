---
id: node-locks
title: Node lock states
kind: statechart
status: implemented
summary: Creators can lock nodes while other registered users can edit unlocked nodes.
parent: shared-tree
sources:
  - public/tree.js
  - public/app.js
  - store.js
  - worker.js
  - migrations/0003_shared_tree.sql
checked: 46a96fc
---

A new person node records its creator and starts unlocked. A creator can lock it at creation or in a later edit. The server decides access from the stored creator ID and lock state. It does not trust creator IDs from an edit request.

```mermaid
stateDiagram-v2
    [*] --> Open: create open
    [*] --> Locked: create locked
    Open --> Open: edit [registered]
    Open --> Locked: lock [creator]
    Locked --> Locked: edit [creator]
    Locked --> Open: unlock [creator]
    Open --> Removed: remove [registered]
    Locked --> Removed: remove [creator]
    Removed --> Open: restore open [access allowed]
    Removed --> Locked: restore locked [creator]
```

## Open

Any registered user can edit the node. Only its creator can change the lock. Creator identity does not change when someone else edits it.

## Locked

Only the creator can edit or remove the node. Changes to relationships check both their previous and proposed endpoints. A change cannot remove or move a relationship away from a locked person without access to that person. If both endpoints are locked, the user must have access to both. Lock refusal returns HTTP 403. The same rules apply to undo and restore.

## Removed

Removal saves a deleted revision. It also removes linked relationships, so locks on other endpoints can refuse the operation. The stored creator and lock remain. A restore must pass the same access checks. The node can be restored unlocked by another registered user only if it was already unlocked when removed.

## Refused requests

Guests cannot write. Other users cannot change a lock. A stale node revision returns HTTP 409. A stale database sequence causes a retry against new data. After five failed attempts, the server returns HTTP 503. No failed batch changes the graph.

## Gaps

There is no creator-recovery or moderation process. A creator cannot change a relationship to another creator's locked node. There is no automatic duplicate-person merge. These behaviors have no additional user controls in this version.

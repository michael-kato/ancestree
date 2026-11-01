# Ancestree

One shared human tree. Anyone can view it for free. Any registered user can add people and edit unlocked nodes. There are no named family groups, memberships, invites, or owner roles.

A node creator can lock or unlock that node. A lock protects the person's details, removal, and relationships. Only its creator can edit it while it is locked. New nodes are unlocked by default. All edits have a history. Undo and restore add edits; they do not erase history.

Select a person to highlight their connections. Card colors sample a continuous field of seeded colors across the tree layout. The field uses 1,000 vivid colors selected from [nice-color-palettes](https://github.com/Experience-Monks/nice-color-palettes), a collection based on ColourLovers palettes. Its [MIT license](licenses/nice-color-palettes.txt) applies to the copied palette data. Colors can change if the tree layout changes; the timelapse keeps one layout across years.

Each parent, child, or partner link counts as one step. Distant cards and connections become less saturated and slightly darker. Adoptive, step, and foster links also count. These are graph distances, not genetic measurements. Select Clear selection to remove the emphasis, or use Find a person to select another person.

The timelapse keeps each person in the same position as the year changes. New cards grow from a visible relative when possible. A short sound marks new cards; use Sound on or Sound off to control it.

## Run locally

Use Node.js 24 or later.

```bash
npm install
cp .dev.vars.example .dev.vars
npx wrangler d1 migrations apply ancestree-db --local
npx wrangler dev
```

Open [the local viewer](http://localhost:8787). Sign in to contribute. Sign-in links are sent by email. In local development, Wrangler saves each email under `.wrangler/tmp/email/` and prints its path.

## Check

```bash
npm test
npm run coverage
npm run benchmark
npx wrangler deploy --dry-run
```

The tests use Node's SQLite module and an in-memory database. They check public reads, registered-user edits, node locks, stale writes, migration, replay, media paths, and color contrast. Browser controls need a separate browser check. See [the state map](docs/state/README.md) and [verification results](docs/state/verification.md).

## Existing data

Migration `0003_shared_tree.sql` combines all prior trees into the shared tree. Before applying it to a live database, export a backup and check that all existing records can become public. This includes prior chat, comments, notes, and media.

The migration preserves people, relationships, revisions, comments, and media paths. It keeps unique IDs and replaces IDs that occur in more than one old tree. It combines the sequence counters without losing edit order within each prior tree. A node's creator is the author of its first recorded revision. Older nodes start unlocked. Memberships and pending invites are removed. The migration does not identify or combine duplicate people.

The API now uses `/api/tree`. Old `/api/trees/:id` clients must change. Existing browser links open the shared viewer.

## Deploy

Configure the D1 database, R2 bucket, email sender, and Turnstile bindings in `wrangler.jsonc`. Set `TURNSTILE_SECRET` with Wrangler's secret command. Then apply migrations and deploy:

```bash
npx wrangler d1 migrations apply ancestree-db --remote
npx wrangler deploy
```

## Current limits

The data model has no family boundaries. The current viewer and edit validator still load the full graph. Global history and comments also share one sequence counter. This version has not been verified at population scale. Before large imports, add indexed neighborhood queries, bounded history loading, viewport rendering, and a write path that does not use one global counter. Test these with large synthetic graphs and concurrent edits.

One edit can change at most 200 people or relationships. Large restores need separate edits. A second edit to an old node revision is rejected and must be repeated against the current data.

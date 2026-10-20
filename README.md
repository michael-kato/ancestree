# Ancestree

A family tree your whole family edits together: a visual node tree, accounts, full edit history with undo, a replay that rewinds and plays the tree growing, a generations view, family chat and comments on each person. Runs on Cloudflare Workers + D1 + R2.

## Run locally

```bash
npm install
cp .dev.vars.example .dev.vars          # Turnstile test keys
npx wrangler d1 migrations apply ancestree --local
npx wrangler dev                         # http://localhost:8787
```

Sign-in links are emailed. Locally, wrangler writes each email to a text file under `.wrangler/tmp/email/` and prints its path in the dev log. Open the link from there.

## Deploy

```bash
npx wrangler d1 create ancestree         # paste database_id into wrangler.jsonc
npx wrangler r2 bucket create ancestree-media
npx wrangler email sending enable yourdomain.com
npx wrangler secret put TURNSTILE_SECRET
npx wrangler d1 migrations apply ancestree --remote
npx wrangler deploy
```

Set `MAIL_FROM` (an address on the onboarded domain) and `TURNSTILE_SITEKEY` in `wrangler.jsonc`.

## Gotchas

- Emailing arbitrary addresses needs the Workers Paid plan (Email Sending is in beta).
- Every edit is an immutable changeset. Undo and "Restore tree to this step" add new edits; nothing is deleted.
- Two people editing the same person: the second save is rejected with "changed by someone else" and must be redone.
- One edit can change at most 200 people/relationships, so restoring a very old step of a large tree may need doing in parts.
- Roles: owner (invites, roles), editor (edits), viewer (reads, comments). An invite link signs its recipient in as the invited address, so it shouldn't be forwarded.

## API example

```bash
curl -b cookies -H 'Origin: http://localhost:8787' -H 'Content-Type: application/json' \
  http://localhost:8787/api/trees/$TREE/changesets \
  -d '{"message":"Added Ann","ops":[{"id":"ann","kind":"person","base_rev":0,"data":{"given":"Ann","birth":"1950"}}]}'
# → {"changeset":{"seq":1,"user_name":"…","ops":[{"entity_id":"ann","rev":1,…}]}}
```

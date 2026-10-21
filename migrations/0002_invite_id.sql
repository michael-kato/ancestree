-- Stable public id so owners can list, resend and cancel pending invites
-- (token_hash changes on resend and stays server-side).
ALTER TABLE invite ADD COLUMN id TEXT;
UPDATE invite SET id = lower(hex(randomblob(16))) WHERE id IS NULL;
CREATE UNIQUE INDEX invite_tree_id ON invite(tree_id, id);

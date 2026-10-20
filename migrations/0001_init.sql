-- All times are epoch milliseconds. Every family-data table is keyed by tree_id
-- so trees can later be sharded across databases without schema changes.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

CREATE TABLE login (
  token_hash TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX login_email ON login(email, created_at);

CREATE TABLE session (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- seq is the tree's version counter; every changeset and comment write takes the next value.
CREATE TABLE tree (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  seq INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL
);

CREATE TABLE member (
  tree_id TEXT NOT NULL REFERENCES tree(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  role TEXT NOT NULL CHECK (role IN ('owner', 'editor', 'viewer')),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tree_id, user_id)
);
CREATE INDEX member_user ON member(user_id);

CREATE TABLE invite (
  token_hash TEXT PRIMARY KEY,
  tree_id TEXT NOT NULL REFERENCES tree(id),
  email TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('editor', 'viewer')),
  invited_by TEXT NOT NULL REFERENCES users(id),
  expires_at INTEGER NOT NULL
);

-- Current state of each person / relationship; revision holds every version.
CREATE TABLE entity (
  tree_id TEXT NOT NULL REFERENCES tree(id),
  id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('person', 'parent', 'partner')),
  rev INTEGER NOT NULL,
  data TEXT NOT NULL,
  deleted INTEGER NOT NULL DEFAULT 0,
  created_seq INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (tree_id, id)
);

CREATE TABLE changeset (
  tree_id TEXT NOT NULL REFERENCES tree(id),
  seq INTEGER NOT NULL,
  user_id TEXT NOT NULL REFERENCES users(id),
  message TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tree_id, seq)
);

CREATE TABLE revision (
  tree_id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  rev INTEGER NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  deleted INTEGER NOT NULL,
  PRIMARY KEY (tree_id, entity_id, rev)
);
CREATE INDEX revision_seq ON revision(tree_id, seq);

-- target_id NULL is the family chat; otherwise the person being discussed.
CREATE TABLE comment (
  tree_id TEXT NOT NULL REFERENCES tree(id),
  id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  target_id TEXT,
  parent_id TEXT,
  user_id TEXT NOT NULL REFERENCES users(id),
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  PRIMARY KEY (tree_id, id)
);
CREATE INDEX comment_seq ON comment(tree_id, seq);
CREATE INDEX comment_target ON comment(tree_id, target_id, created_at);

-- Object lives in R2 at trees/{tree_id}/media/{id}.
CREATE TABLE media (
  tree_id TEXT NOT NULL REFERENCES tree(id),
  id TEXT NOT NULL,
  entity_id TEXT,
  content_type TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  uploaded_by TEXT NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY (tree_id, id)
);

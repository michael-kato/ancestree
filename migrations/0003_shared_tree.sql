ALTER TABLE tree DROP COLUMN name;
ALTER TABLE tree DROP COLUMN created_by;
INSERT INTO tree (id, seq, created_at) VALUES ('human', 0, 0);

CREATE TABLE _merge_entity AS
SELECT tree_id, id, CASE WHEN COUNT(*) OVER (PARTITION BY id) = 1 THEN id ELSE lower(hex(randomblob(16))) END AS new_id
FROM entity;
CREATE UNIQUE INDEX _merge_entity_key ON _merge_entity(tree_id, id);
CREATE TABLE _merge_media AS
SELECT tree_id, id, CASE WHEN COUNT(*) OVER (PARTITION BY id) = 1 THEN id ELSE lower(hex(randomblob(16))) END AS new_id
FROM media;
CREATE UNIQUE INDEX _merge_media_key ON _merge_media(tree_id, id);
CREATE TABLE _merge_comment AS
SELECT tree_id, id, CASE WHEN COUNT(*) OVER (PARTITION BY id) = 1 THEN id ELSE lower(hex(randomblob(16))) END AS new_id
FROM comment;
CREATE UNIQUE INDEX _merge_comment_key ON _merge_comment(tree_id, id);
CREATE TABLE _merge_seq AS
SELECT events.tree_id, events.seq, ROW_NUMBER() OVER (ORDER BY t.created_at, events.tree_id, events.seq) AS new_seq
FROM (SELECT tree_id, seq FROM changeset UNION SELECT tree_id, seq FROM comment) events
JOIN tree t ON t.id = events.tree_id;
CREATE UNIQUE INDEX _merge_seq_key ON _merge_seq(tree_id, seq);

ALTER TABLE entity ADD COLUMN created_by TEXT REFERENCES users(id);
UPDATE entity SET created_by = (
  SELECT c.user_id FROM revision r JOIN changeset c ON c.tree_id = r.tree_id AND c.seq = r.seq
  WHERE r.tree_id = entity.tree_id AND r.entity_id = entity.id ORDER BY r.rev LIMIT 1
);
ALTER TABLE media ADD COLUMN storage_key TEXT;
UPDATE media SET storage_key = 'trees/' || tree_id || '/media/' || id;

UPDATE revision SET data = CASE kind
  WHEN 'person' THEN json_set(data, '$.locked', json('false'), '$.photo', COALESCE((SELECT new_id FROM _merge_media m WHERE m.tree_id = revision.tree_id AND m.id = json_extract(data, '$.photo')), ''))
  WHEN 'parent' THEN json_set(data,
    '$.parent', (SELECT new_id FROM _merge_entity e WHERE e.tree_id = revision.tree_id AND e.id = json_extract(data, '$.parent')),
    '$.child', (SELECT new_id FROM _merge_entity e WHERE e.tree_id = revision.tree_id AND e.id = json_extract(data, '$.child')))
  WHEN 'partner' THEN json_set(data,
    '$.a', (SELECT new_id FROM _merge_entity e WHERE e.tree_id = revision.tree_id AND e.id = json_extract(data, '$.a')),
    '$.b', (SELECT new_id FROM _merge_entity e WHERE e.tree_id = revision.tree_id AND e.id = json_extract(data, '$.b')))
END;
UPDATE entity SET data = (SELECT r.data FROM revision r WHERE r.tree_id = entity.tree_id AND r.entity_id = entity.id AND r.rev = entity.rev);
UPDATE revision SET
  entity_id = (SELECT new_id FROM _merge_entity e WHERE e.tree_id = revision.tree_id AND e.id = revision.entity_id),
  seq = (SELECT new_seq FROM _merge_seq s WHERE s.tree_id = revision.tree_id AND s.seq = revision.seq),
  tree_id = 'human';
UPDATE entity SET
  id = (SELECT new_id FROM _merge_entity e WHERE e.tree_id = entity.tree_id AND e.id = entity.id),
  created_seq = (SELECT new_seq FROM _merge_seq s WHERE s.tree_id = entity.tree_id AND s.seq = entity.created_seq),
  seq = (SELECT new_seq FROM _merge_seq s WHERE s.tree_id = entity.tree_id AND s.seq = entity.seq),
  tree_id = 'human';
UPDATE changeset SET
  seq = (SELECT new_seq FROM _merge_seq s WHERE s.tree_id = changeset.tree_id AND s.seq = changeset.seq),
  tree_id = 'human';
UPDATE comment SET
  id = (SELECT new_id FROM _merge_comment m WHERE m.tree_id = comment.tree_id AND m.id = comment.id),
  target_id = (SELECT new_id FROM _merge_entity e WHERE e.tree_id = comment.tree_id AND e.id = comment.target_id),
  parent_id = (SELECT new_id FROM _merge_comment m WHERE m.tree_id = comment.tree_id AND m.id = comment.parent_id),
  seq = (SELECT new_seq FROM _merge_seq s WHERE s.tree_id = comment.tree_id AND s.seq = comment.seq),
  tree_id = 'human';
UPDATE media SET
  id = (SELECT new_id FROM _merge_media m WHERE m.tree_id = media.tree_id AND m.id = media.id),
  entity_id = (SELECT new_id FROM _merge_entity e WHERE e.tree_id = media.tree_id AND e.id = media.entity_id),
  tree_id = 'human';
UPDATE tree SET seq = COALESCE((SELECT MAX(new_seq) FROM _merge_seq), 0) WHERE id = 'human';
DROP TABLE invite;
DROP TABLE member;
DELETE FROM tree WHERE id != 'human';
DROP TABLE _merge_entity;
DROP TABLE _merge_media;
DROP TABLE _merge_comment;
DROP TABLE _merge_seq;

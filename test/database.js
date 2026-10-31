import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';

export function database({ legacy = false } = {}) {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec('PRAGMA foreign_keys = ON');
  const migrations = readdirSync(new URL('../migrations/', import.meta.url)).sort();
  for (const file of migrations.filter((name) => !legacy || name < '0003')) {
    sqlite.exec(readFileSync(new URL(`../migrations/${file}`, import.meta.url), 'utf8'));
  }
  const db = {
    sqlite,
    prepare(sql) {
      return {
        values: [],
        bind(...values) { this.values = values; return this; },
        async first() { return sqlite.prepare(sql).get(...this.values) || null; },
        async all() { return { results: sqlite.prepare(sql).all(...this.values) }; },
        async run() { return sqlite.prepare(sql).run(...this.values); },
      };
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
  return db;
}

export async function register(db, id) {
  db.sqlite.prepare('INSERT INTO users (id, email, name, created_at) VALUES (?, ?, ?, 0)').run(id, `${id}@example.com`, id);
  const hash = Buffer.from(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(id))).toString('hex');
  db.sqlite.prepare('INSERT INTO session (token_hash, user_id, expires_at) VALUES (?, ?, ?)').run(hash, id, Date.now() + 60000);
}

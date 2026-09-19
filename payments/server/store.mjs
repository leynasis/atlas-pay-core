import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";

export class InvoiceStore {
  constructor(path) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db
      .exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000;
      CREATE TABLE IF NOT EXISTS invoices (id TEXT PRIMARY KEY, created_at TEXT NOT NULL, data TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS operations (key TEXT PRIMARY KEY, fingerprint TEXT NOT NULL, state TEXT NOT NULL, invoice_id TEXT, response TEXT, error TEXT, created_at TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS operations_invoice ON operations(invoice_id, state);
    `);
  }
  get(id) {
    const row = this.db.prepare("SELECT data FROM invoices WHERE id=?").get(id);
    return row ? JSON.parse(row.data) : null;
  }
  all() {
    return this.db
      .prepare("SELECT data FROM invoices ORDER BY created_at DESC, rowid DESC")
      .all()
      .map((row) => JSON.parse(row.data));
  }
  put(invoice) {
    this.db
      .prepare(
        "INSERT INTO invoices(id,created_at,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(invoice.id, invoice.createdAt, JSON.stringify(invoice));
  }
  operation(key) {
    const row = this.db
      .prepare("SELECT * FROM operations WHERE key=?")
      .get(key);
    return row
      ? {
          ...row,
          response: row.response ? JSON.parse(row.response) : null,
          error: row.error ? JSON.parse(row.error) : null,
        }
      : null;
  }
  beginOperation(key, fingerprint, invoiceId) {
    this.db
      .prepare(
        "INSERT INTO operations(key,fingerprint,state,invoice_id,created_at) VALUES(?,?,?,?,?)",
      )
      .run(key, fingerprint, "pending", invoiceId, new Date().toISOString());
  }
  setOperation(key, state, response = null, error = null) {
    this.db
      .prepare("UPDATE operations SET state=?,response=?,error=? WHERE key=?")
      .run(
        state,
        response ? JSON.stringify(response) : null,
        error ? JSON.stringify(error) : null,
        key,
      );
  }
  uncertainFor(id) {
    return this.db
      .prepare(
        "SELECT key FROM operations WHERE invoice_id=? AND state IN ('pending','uncertain') LIMIT 1",
      )
      .get(id);
  }
  atomic(fn) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const result = fn();
      this.db.exec("COMMIT");
      return result;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}

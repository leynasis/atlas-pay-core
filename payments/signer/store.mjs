import { DatabaseSync } from "node:sqlite";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import { SignerError } from "./policy.mjs";

export class SignerStore {
  constructor(path) {
    if (path !== ":memory:")
      mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(path);
    if (path !== ":memory:") chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS requests(id TEXT PRIMARY KEY, hash TEXT NOT NULL, state TEXT NOT NULL, data TEXT NOT NULL);",
    );
  }
  get(id) {
    const row = this.db.prepare("SELECT data FROM requests WHERE id=?").get(id);
    return row ? JSON.parse(row.data) : null;
  }
  create(record) {
    this.db
      .prepare("INSERT INTO requests(id,hash,state,data) VALUES(?,?,?,?)")
      .run(
        record.id,
        record.request.requestHash,
        record.state,
        JSON.stringify(record),
      );
  }
  put(record) {
    this.db
      .prepare("UPDATE requests SET state=?,data=? WHERE id=?")
      .run(record.state, JSON.stringify(record), record.id);
  }
  claim(id, from, to) {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const record = this.get(id);
      if (!record || !from.includes(record.state))
        throw new SignerError(
          "OPERATION_BUSY",
          "Another signing operation is active or requires inspection.",
        );
      record.state = to;
      this.put(record);
      this.db.exec("COMMIT");
      return record;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }
  close() {
    this.db.close();
  }
}

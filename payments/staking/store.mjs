import { canonical, requirePolicy } from "../signer/policy.mjs";
import { IDENTITY } from "./config.mjs";

// Shares the role signing journal, its FULL durability and its backup lock.
// Operator secrets are private journal data, never fields of public reviews.
export class StakingStore {
  constructor(store, role) {
    this.store = store;
    this.db = store.db;
    this.role = role;
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS staking_state(id INTEGER PRIMARY KEY CHECK(id=1),data TEXT NOT NULL); CREATE TABLE IF NOT EXISTS staking_requests(id TEXT PRIMARY KEY,state TEXT NOT NULL,data TEXT NOT NULL);",
    );
  }
  state() {
    const row = this.db
      .prepare("SELECT data FROM staking_state WHERE id=1")
      .get();
    if (!row) return null;
    const value = JSON.parse(row.data);
    requirePolicy(
      value.format === 1 &&
        value.role === this.role &&
        canonical(value.network) === canonical(IDENTITY),
      "WRONG_NETWORK",
      "Masternode journal belongs to another wallet role or chain.",
    );
    return value;
  }
  save(value) {
    this.db
      .prepare(
        "INSERT INTO staking_state(id,data) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
      )
      .run(JSON.stringify(value));
  }
  get(id) {
    const row = this.db
      .prepare("SELECT data FROM staking_requests WHERE id=?")
      .get(id);
    return row ? JSON.parse(row.data) : null;
  }
  put(value) {
    this.db
      .prepare(
        "INSERT INTO staking_requests(id,state,data) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,data=excluded.data",
      )
      .run(value.id, value.state, JSON.stringify(value));
  }
  pending(generation) {
    return (
      this.db
        .prepare(
          "SELECT data FROM staking_requests WHERE state NOT IN ('confirmed','cancelled') ORDER BY rowid",
        )
        .all()
        .map((row) => JSON.parse(row.data))
        .find((row) => row.generation === generation) || null
    );
  }
  records() {
    return this.db
      .prepare("SELECT data FROM staking_requests ORDER BY rowid")
      .all()
      .map((row) => JSON.parse(row.data));
  }
}

import Database from "better-sqlite3";

const db = new Database("leetoff.db");

db.exec(`
  CREATE TABLE IF NOT EXISTS players (
    channel_id TEXT,
    discord_id TEXT,
    username   TEXT,
    leetcode   TEXT,
    easy INTEGER, medium INTEGER, hard INTEGER,   -- snapshot at join
    PRIMARY KEY (channel_id, discord_id)
  )
`);

export default db;

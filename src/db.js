// src/db.js
import Database from "better-sqlite3";

const db = new Database("leetoff.db");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    discord_id     TEXT PRIMARY KEY,
    username       TEXT,
    leetcode       TEXT NOT NULL,
    streak         INTEGER DEFAULT 0,
    last_solve_day TEXT
  );

  CREATE TABLE IF NOT EXISTS games (
    channel_id TEXT PRIMARY KEY,
    week_start INTEGER NOT NULL,
    threshold  INTEGER NOT NULL DEFAULT 10
  );

  CREATE TABLE IF NOT EXISTS players (
    channel_id   TEXT REFERENCES games(channel_id),
    discord_id   TEXT REFERENCES users(discord_id),
    easy INTEGER, medium INTEGER, hard INTEGER,
    saved_points INTEGER DEFAULT 0,
    PRIMARY KEY (channel_id, discord_id)
  );

  CREATE TABLE IF NOT EXISTS weekly_results (
    channel_id TEXT,
    discord_id TEXT,
    week_start INTEGER,
    points     INTEGER,
    passed     INTEGER,
    PRIMARY KEY (channel_id, discord_id, week_start)
  );
`);

const now = () => Math.floor(Date.now() / 1000);

// ---------- users ----------
export function get_user(discord_id) {
	return db.prepare("SELECT * FROM users WHERE discord_id = ?").get(discord_id);
}

export function save_user(discord_id, username, leetcode) {
	db.prepare(
		`INSERT INTO users (discord_id, username, leetcode) VALUES (?, ?, ?)
		 ON CONFLICT(discord_id) DO UPDATE SET username = excluded.username, leetcode = excluded.leetcode`,
	).run(discord_id, username, leetcode);
}

// ---------- games ----------
export function get_or_create_game(channel_id) {
	db.prepare(
		"INSERT OR IGNORE INTO games (channel_id, week_start) VALUES (?, ?)",
	).run(channel_id, now());
	return db.prepare("SELECT * FROM games WHERE channel_id = ?").get(channel_id);
}

// ---------- players ----------
export function get_player(channel_id, discord_id) {
	return db
		.prepare("SELECT * FROM players WHERE channel_id = ? AND discord_id = ?")
		.get(channel_id, discord_id);
}

export function add_player(channel_id, discord_id, easy, medium, hard) {
	db.prepare(
		`INSERT INTO players (channel_id, discord_id, easy, medium, hard, saved_points)
		 VALUES (?, ?, ?, ?, ?, 0)
		 ON CONFLICT(channel_id, discord_id) DO NOTHING`,
	).run(channel_id, discord_id, easy, medium, hard);
}

export function get_players(channel_id) {
	return db
		.prepare(
			`SELECT p.*, u.username, u.leetcode, u.streak
			 FROM players p JOIN users u ON u.discord_id = p.discord_id
			 WHERE p.channel_id = ?`,
		)
		.all(channel_id);
}

export function save_points(channel_id, discord_id, points) {
	db.prepare(
		"UPDATE players SET saved_points = ? WHERE channel_id = ? AND discord_id = ?",
	).run(points, channel_id, discord_id);
}

// ---------- end of week ----------
// live_stats: { [discord_id]: { easy, medium, hard } } fetched from LeetCode
export const end_week = db.transaction((channel_id, live_stats) => {
	const game = get_or_create_game(channel_id);

	for (const p of get_players(channel_id)) {
		db.prepare(
			"INSERT OR REPLACE INTO weekly_results (channel_id, discord_id, week_start, points, passed) VALUES (?, ?, ?, ?, ?)",
		).run(
			channel_id,
			p.discord_id,
			game.week_start,
			p.saved_points,
			p.saved_points >= game.threshold ? 1 : 0,
		);

		const live = live_stats[p.discord_id];
		if (live) {
			db.prepare(
				"UPDATE players SET easy = ?, medium = ?, hard = ?, saved_points = 0 WHERE channel_id = ? AND discord_id = ?",
			).run(live.easy, live.medium, live.hard, channel_id, p.discord_id);
		}
	}

	db.prepare("UPDATE games SET week_start = ? WHERE channel_id = ?").run(
		now(),
		channel_id,
	);
});

export { db };

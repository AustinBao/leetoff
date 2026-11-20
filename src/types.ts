// Shared shapes used across the bot.

export type Difficulty = "easy" | "medium" | "hard";
export type LeetCodeDifficulty = "Easy" | "Medium" | "Hard";

export interface SolveCounts {
	easy: number;
	medium: number;
	hard: number;
}

// live stats keyed by discord_id; null when the LeetCode lookup failed
export type LiveStats = Record<string, SolveCounts | null>;

// ---------- database rows ----------
export interface User {
	discord_id: string;
	username: string | null;
	leetcode: string;
	streak: number;
	last_solve_day: string | null;
}

export interface Game {
	channel_id: string;
	week_start: number; // unix seconds
	threshold: number;
}

// players row joined with users (see get_players)
export interface Player extends SolveCounts {
	channel_id: string;
	discord_id: string;
	saved_points: number;
	username: string | null;
	leetcode: string;
	streak: number;
}

// ---------- LeetCode ----------
export interface Problem {
	questionFrontendId: string;
	title: string;
	titleSlug: string;
	difficulty: LeetCodeDifficulty;
	acRate: number;
	topicTags: { name: string }[];
	url: string;
}

// ---------- scoring ----------
export interface Score extends SolveCounts {
	name: string | null;
	points: number;
}

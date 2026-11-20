import "dotenv/config";
import express from "express";
import {
	ButtonStyleTypes,
	InteractionResponseFlags,
	InteractionResponseType,
	InteractionType,
	MessageComponentTypes,
	verifyKeyMiddleware,
} from "discord-interactions";

import { get_counts, get_live_stats, get_random_problem } from "./leetcode.ts";
import {
	db,
	get_user,
	save_user,
	get_or_create_game,
	get_player,
	add_player,
	get_players,
	save_points,
	end_week,
} from "./db.ts";

import { Temporal } from 'temporal-polyfill';
import type {
	Difficulty,
	Game,
	LeetCodeDifficulty,
	LiveStats,
	Player,
	Problem,
	Score,
} from "./types.ts";

function is_new_day(last_date: string): boolean {
	const today = Temporal.Now.plainDateISO()
	const previous = Temporal.PlainDate.from(last_date)
	return Temporal.PlainDate.compare(today, previous) > 0; // either -1, 0, or 1
}
console.log(is_new_day('2026-11-17'))


function is_new_week(game_start: string): boolean {
	const today = Temporal.Now.plainDateISO()
	const start_date = Temporal.PlainDate.from(game_start)
	const daysPassed = today.since(start_date).days
	return daysPassed >= 7;
}
console.log(is_new_week('2026-11-13'))

// Temporal.Now.plainDateISO().toString()

const app = express();
const PORT = process.env.PORT || 3002;
const WEEKLY_THRESHOLD = 10;
const PUBLIC_KEY = process.env.PUBLIC_KEY;
if (!PUBLIC_KEY) throw new Error("PUBLIC_KEY is not set in .env");

const DIFFICULTY_COLOR: Record<LeetCodeDifficulty, number> = {
	Easy: 0x2ecc71,
	Medium: 0xffc01e,
	Hard: 0xff375f,
};

function render_progress_bar(score: Score): string {
	const filled = Math.max(0, Math.min(score.points, WEEKLY_THRESHOLD));
	let bar = "▰".repeat(filled) + "▱".repeat(WEEKLY_THRESHOLD - filled);
	bar += score.easy != 0 ? ` · ${score.easy}E` : ``;
	bar += score.medium != 0 ? ` · ${score.medium}M` : ``;
	bar += score.hard != 0 ? ` · ${score.hard}H` : ``;
	return bar;
}

function get_scores(players: Player[], live_stats: LiveStats): Score[] {
	const scores: Score[] = [];
	for (const player of players) {
		const live = live_stats[player.discord_id];
		if (!live) {
			scores.push({ name: player.username, points: 0, easy: 0, medium: 0, hard: 0 });
			continue;
		}
		const start_total = player.easy + player.medium * 3 + player.hard * 6;
		const new_total = live.easy + live.medium * 3 + live.hard * 6;
		scores.push({
			name: player.username,
			points: new_total - start_total,
			easy: live.easy - player.easy,
			medium: live.medium - player.medium,
			hard: live.hard - player.hard,
		});
	}
	scores.sort((a, b) => b.points - a.points);
	return scores;
}

function list_scores(players: Player[], live_stats: LiveStats): string {
	const scores = get_scores(players, live_stats);
	let msg = "";
	let count = 1;
	for (const score of scores) {
		msg += `${count}. **${score.name}** · ${score.points} ${score.points === 1 ? "pt" : "pts"}\n`;
		msg += `-# ${render_progress_bar(score)}\n\n`;
		count++;
	}
	return msg;
}

function num_of_green_players(players: Player[], live_stats: LiveStats, game: Game): number {
	const threshold = game.threshold;
	const scores = get_scores(players, live_stats);
	let green_count = 0;
	for (const score of scores) {
		if (score.points >= threshold) green_count++;
	}
	return green_count;
}

function num_of_days_passed(game: Game): number {
	const week_start = game.week_start;
	const now = Math.floor(Date.now() / 1000);
	const seconds_passed = now - week_start;
	const days_passed = Math.floor(seconds_passed / 86400);
	return Math.max(0, days_passed);
}

function render_leaderboard(players: Player[], live_stats: LiveStats, game: Game) {
	const green_count = num_of_green_players(players, live_stats, game);
	const days_passed = num_of_days_passed(game);
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [
			{
				type: MessageComponentTypes.CONTAINER, // 17
				accent_color: 0xff7a00, // orange bar on the side
				components: [
					{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: `### 📊  Leaderboard `,
					},
					{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: `-# Week started ${days_passed} days ago · goal ${game.threshold} pts · ${green_count}/${players.length} on track`,
					},
					{ type: MessageComponentTypes.SEPARATOR },
					{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content:
							list_scores(players, live_stats) || "No players yet. Hit Join!",
					},
					{ type: MessageComponentTypes.SEPARATOR },
					{
						type: MessageComponentTypes.ACTION_ROW,
						components: [
							{
								type: MessageComponentTypes.BUTTON,
								style: 1,
								custom_id: "join",
								label: "Join",
							},
							{
								type: MessageComponentTypes.BUTTON,
								style: 2,
								custom_id: "refresh",
								label: "Refresh",
							},
						],
					},
				],
			},
		],
	};
}

function render_random_question(problem: Problem | null, difficulty: Difficulty, username: string) {
	const reroll_button = {
		type: MessageComponentTypes.BUTTON,
		style: ButtonStyleTypes.SECONDARY,
		custom_id: `reroll_${difficulty}`,
		label: "Reroll",
		emoji: { name: "🎲" },
	};

	if (!problem) {
		return {
			flags: InteractionResponseFlags.IS_COMPONENTS_V2,
			components: [
				{
					type: MessageComponentTypes.CONTAINER,
					accent_color: 0x808080, // gray bar for errors
					components: [
						{
							type: MessageComponentTypes.TEXT_DISPLAY,
							content: "Couldn't fetch a problem from LeetCode ❌",
						},
						{
							type: MessageComponentTypes.ACTION_ROW,
							components: [reroll_button],
						},
					],
				},
			],
		};
	}

	const tags = problem.topicTags.map((tag) => `\`${tag.name}\``).join(" ");
	const details = `-# ${problem.difficulty} · ${problem.acRate.toFixed(1)}% acceptance · rolled by ${username}`;

	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [
			{
				type: MessageComponentTypes.CONTAINER,
				accent_color: DIFFICULTY_COLOR[problem.difficulty], // bar colored by difficulty
				components: [
					{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: `### [${problem.questionFrontendId}. ${problem.title}](${problem.url})`,
					},
					{ type: MessageComponentTypes.SEPARATOR },
					{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: tags ? `${tags}\n${details}` : details,
					},
					{
						type: MessageComponentTypes.ACTION_ROW,
						components: [
							{
								type: MessageComponentTypes.BUTTON,
								style: ButtonStyleTypes.LINK,
								url: problem.url,
								label: "Open on LeetCode",
							},
							reroll_button,
						],
					},
				],
			},
		],
	};
}

function get_random_difficuly(easy: number, medium: number, hard: number): Difficulty {
	if (easy + medium + hard != 1) {
		throw new Error("difficulty weights don't add up to 1.");
	}
	const DIFFICULTY_WEIGHTS: { name: Difficulty; weight: number }[] = [
		{ name: "easy", weight: easy },
		{ name: "medium", weight: medium },
		{ name: "hard", weight: hard },
	];
	const random = Math.random(); // 0 - 1
	let cumulativeWeight = 0;
	for (const item of DIFFICULTY_WEIGHTS) {
		cumulativeWeight += item.weight;
		if (random <= cumulativeWeight) {
			return item.name;
		}
	}
	return "hard"; // only reached if floating-point rounding leaves random just above the total
}
const DAILY_DIFFICULTY = await get_random_difficuly(0.2, 0.6, 0.2);
const DAILY_PROBLEM = await get_random_problem(DAILY_DIFFICULTY);

app.post(
	"/interactions",
	verifyKeyMiddleware(PUBLIC_KEY),
	async function (req, res) {
		const { member, type, data } = req.body;
		const username = member.user.username; // only works in servers since it returns member field
		const user = member.user;
		const channelId = req.body.channel_id;

		if (type == InteractionType.APPLICATION_COMMAND) {
			if (data.name === "leaderboard") {
				const players = get_players(channelId);
				const live_stats = await get_live_stats(players);
				const game = get_or_create_game(channelId);
				return res.send({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: render_leaderboard(players, live_stats, game),
				});
			}
			if (data.name === "daily") {
				return res.send({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: render_random_question(
						DAILY_PROBLEM,
						DAILY_DIFFICULTY,
						username,
					),
				});
			}
			if (data.name === "random") {
				const difficulty = data.options.find(
					(opt: { name: string; value: string }) => opt.name === "difficulty",
				).value as Difficulty;
				const problem = await get_random_problem(difficulty);
				return res.send({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: render_random_question(problem, difficulty, username),
				});
			}
		}
		if (type === InteractionType.MODAL_SUBMIT) {
			const componentId = data.custom_id;
			if (componentId === "lc_username_modal") {
				const lcUsername = data.components[0].component.value.trim();
				const channelId = req.body.channel_id;

				const counts = await get_counts(lcUsername);
				if (!counts) {
					return res.send({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: `LeetCode user "${lcUsername}" not found ❌`,
							flags: InteractionResponseFlags.EPHEMERAL,
						},
					});
				}
				save_user(user.id, user.username, lcUsername);
				get_or_create_game(channelId);
				add_player(channelId, user.id, counts.easy, counts.medium, counts.hard);

				const players = get_players(channelId);
				const live_stats = await get_live_stats(players);
				const game = get_or_create_game(channelId);

				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE,
					data: render_leaderboard(players, live_stats, game),
				});
			}
		}

		// handles all message component interactions
		if (type === InteractionType.MESSAGE_COMPONENT) {
			const componentId = data.custom_id;
			const channelId = req.body.channel_id;

			const games = get_or_create_game(channelId);
			console.log(games);
			const players = get_players(channelId);
			console.log(players);

			if (componentId.startsWith("reroll_")) {
				const difficulty = componentId.slice("reroll_".length) as Difficulty;
				const problem = await get_random_problem(difficulty);
				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE, // replace the problem in place
					data: render_random_question(problem, difficulty, username),
				});
			}
			if (componentId === "join") {
				const players = get_players(channelId);
				if (players.some((p) => p.discord_id === user.id)) {
					return res.send({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: "You've already joined!",
							flags: InteractionResponseFlags.EPHEMERAL,
						},
					});
				}
				// OPEN MODAL HERE
				return res.send({
					type: InteractionResponseType.MODAL,
					data: {
						custom_id: "lc_username_modal",
						title: "Link your LeetCode",
						components: [
							{
								type: 18, // Label
								label: "Enter LeetCode Username",
								component: {
									type: 4, // Text input
									custom_id: "lc_username",
									style: 1, // short, single line
									required: true,
								},
							},
						],
					},
				});
			}
			if (componentId === "refresh") {
				const players = get_players(channelId);
				const live_stats = await get_live_stats(players);
				const game = get_or_create_game(channelId);
				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE,
					data: render_leaderboard(players, live_stats, game),
				});
			}
		}

		// no interaction matched
		console.error(
			"Unhandled interaction:",
			type,
			data?.name ?? data?.custom_id,
		);
		return res.status(400).json({ error: "unknown interaction" });
	},
);

app.listen(PORT, () => {
	console.log("Listening on port", PORT);
});

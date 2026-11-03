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

import { get_counts, get_live_stats, get_random_problem } from "./leetcode.js";
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
} from "./db.js";

const app = express();
const PORT = process.env.PORT || 3000;
const WEEKLY_THRESHOLD = 10;

const DIFFICULTY_COLOR = {
	Easy: 0x2ecc71,
	Medium: 0xffc01e,
	Hard: 0xff375f,
};

function list_scores(players, live_stats) {
	const scores = [];
	for (const player of players) {
		const live_counts = live_stats[player.discord_id];
		if (!live_counts) {
			scores.push({ name: player.username, points: 0 });
			continue;
		}
		const start_total = player.easy + player.medium * 3 + player.hard * 6;
		const new_total =
			live_counts.easy + live_counts.medium * 3 + live_counts.hard * 6;
		scores.push({ name: player.username, points: new_total - start_total });
	}
	scores.sort((a, b) => b.points - a.points);

	let msg = "";
	let count = 1;
	for (const score of scores) {
		let pass = "";
		if (score.points >= WEEKLY_THRESHOLD) {
			pass = "✅";
		} else {
			pass = "❌";
		}
		msg += `${count}. ${score.name} - ${score.points} ${pass}\n`;
		count++;
	}
	return msg;
}

function render_leaderboard(players, live_stats) {
	return {
		flags: InteractionResponseFlags.IS_COMPONENTS_V2,
		components: [
			{
				type: MessageComponentTypes.CONTAINER, // 17
				accent_color: 0xff7a00, // orange bar on the side
				components: [
					{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content: `## 🏆 Week 1 · ${WEEKLY_THRESHOLD} Points`,
					},
					{ type: MessageComponentTypes.SEPARATOR },
					{
						type: MessageComponentTypes.TEXT_DISPLAY,
						content:
							list_scores(players, live_stats) || "No players yet. Hit Join!",
					},
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

function render_random_question(problem, difficulty, username) {
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

app.post(
	"/interactions",
	verifyKeyMiddleware(process.env.PUBLIC_KEY),
	async function (req, res) {
		const { member, type, data } = req.body;
		const username = member.user.username; // only works in servers since it returns member field
		const user = member.user;
		const channelId = req.body.channel_id;

		if (type == InteractionType.APPLICATION_COMMAND) {
			if (data.name === "leaderboard") {
				const players = get_players(channelId);
				const live_stats = await get_live_stats(players);
				return res.send({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: render_leaderboard(players, live_stats),
				});
			}
			if (data.name === "random") {
				const difficulty = data.options.find(
					(opt) => opt.name === "difficulty",
				).value;
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
				console.log(players);
				const live_stats = await get_live_stats(players);

				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE,
					data: render_leaderboard(players, live_stats),
				});
			}
		}

		// handles all message component interactions
		if (type === InteractionType.MESSAGE_COMPONENT) {
			const componentId = data.custom_id;
			const channelId = req.body.channel_id;
			if (componentId.startsWith("reroll_")) {
				const difficulty = componentId.slice("reroll_".length);
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
				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE,
					data: render_leaderboard(players, live_stats),
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

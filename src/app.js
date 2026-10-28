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

import { get_user_stats, get_counts, get_live_stats } from "./leetcode.js";
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

function list_scores(players, live_stats) {
	const scores = [];
	for (const player of players) {
		const live_counts = live_stats[player.discord_id];
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
				accent_color: 0xf2a623, // orange bar on the side
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
		}
		if (type === InteractionType.MODAL_SUBMIT) {
			const componentId = data.custom_id;
			if (componentId === "lc_username_modal") {
				const lcUsername = data.components[0].component.value.trim();
				const channelId = req.body.channel_id;

				const stats = await get_user_stats(lcUsername);
				if (!stats) {
					return followUp(
						req.body.token,
						`LeetCode user "${lcUsername}" not found ❌`,
					);
				}
				const submissions =
					stats.data.matchedUser.submitStatsGlobal.acSubmissionNum;
				let easy = 0;
				let medium = 0;
				let hard = 0;
				for (const submission of submissions) {
					if (submission.difficulty === "Easy") {
						easy = submission.count;
					} else if (submission.difficulty === "Medium") {
						medium = submission.count;
					} else if (submission.difficulty === "Hard") {
						hard = submission.count;
					}
				}
				save_user(user.id, user.username, lcUsername);
				get_or_create_game(channelId);
				add_player(channelId, user.id, easy, medium, hard);

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
			if (componentId === "join") {
				const players = get_players(channelId);
				if (username in players) {
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
	},
);

app.listen(PORT, () => {
	console.log("Listening on port", PORT);
});

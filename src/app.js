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

import { get_user_stats } from "./leetcode.js";
import db from "./db.js";

const app = express();
const PORT = process.env.PORT || 3000;
const WEEKLY_THRESHOLD = 10;
// const user_scores = { chadder_tough: 14, bustinaao: 9, austin: 11 };
const user_scores = {};

function list_scores(scores) {
	const sorted = Object.entries(scores).sort((a, b) => b[1] - a[1]);
	console.log(sorted);

	let msg = "";
	let count = 1;
	for (const score of sorted) {
		let pass = "";
		if (score[1] >= WEEKLY_THRESHOLD) {
			pass = "✅";
		} else {
			pass = "❌";
		}
		msg += `${count}. ${score[0]} - ${score[1]} ${pass}\n`;
		count++;
	}
	return msg;
}

function renderLeaderboard(user_scores) {
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
						content: list_scores(user_scores) || "No players yet. Hit Join!",
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

		if (type == InteractionType.APPLICATION_COMMAND) {
			if (data.name === "leaderboard") {
				return res.send({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: renderLeaderboard(user_scores),
				});
			}
		}
		if (type === InteractionType.MODAL_SUBMIT) {
			const componentId = data.custom_id;
			if (componentId === "lc_username_modal") {
				console.log(JSON.stringify(data, null, 2));

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

				db.prepare(
					"INSERT OR IGNORE INTO players (channel_id, discord_id, username, leetcode, easy, medium, hard) VALUES (?, ?, ?, ?, ?, ?, ?)",
				).run(
					channelId,
					user.id,
					user.username,
					lcUsername,
					easy,
					medium,
					hard,
				);

				const players = db
					.prepare("SELECT * FROM players WHERE channel_id = ?")
					.all(channelId);
				console.log(players);

				user_scores[username] = easy + medium * 3 + hard * 6;
				console.log(user_scores);

				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE,
					data: renderLeaderboard(user_scores),
				});
			}
		}

		// handles all message component interactions
		if (type === InteractionType.MESSAGE_COMPONENT) {
			const componentId = data.custom_id;

			if (componentId === "join") {
				const channelId = req.body.channel_id;

				if (username in user_scores) {
					return res.send({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: "You've already joined!",
							flags: InteractionResponseFlags.EPHEMERAL,
						},
					});
				}
				// SHOULD OPEN A MODAL HERE
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
				user_scores.bustinaao += 1;
				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE,
					data: renderLeaderboard(user_scores),
				});
			}
		}
	},
);

app.listen(PORT, () => {
	console.log("Listening on port", PORT);
});

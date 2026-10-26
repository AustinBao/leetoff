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

const app = express();
const PORT = process.env.PORT || 3000;

let joined_users = [];

function list_users(users) {
	let msg = "";
	let count = 1;
	for (const user of users) {
		console.log(user);
		msg += `${count}. ${user}\n`;
		count++;
	}
	return msg;
}

app.post(
	"/interactions",
	verifyKeyMiddleware(process.env.PUBLIC_KEY),
	async function (req, res) {
		const { member, type, data } = req.body;
		const username = member.user.username; // only works in servers since it returns member field

		if (type == InteractionType.APPLICATION_COMMAND) {
			if (data.name == "hello") {
				console.log(InteractionResponseType);

				res.send({
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: { content: `hello, ${member.user.username}` },
				});
			} else if (data.name == "join") {
				const response = {
					type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
					data: {
						components: [
							{
								type: 1,
								components: [
									{
										type: 2,
										style: 1,
										custom_id: "mainjoinbutton",
										label: `join us, ${username}`,
									},
								],
							},
						],
					},
				};

				console.log("OUT:", JSON.stringify(response, null, 2));

				res.send(response);
			}
		}
		// handles all message component interactions
		if (type === InteractionType.MESSAGE_COMPONENT) {
			const componentId = data.custom_id;

			// handle the join button request (or all message component interactions)
			if (componentId === "mainjoinbutton") {
				if (joined_users.includes(username)) {
					return res.send({
						type: InteractionResponseType.CHANNEL_MESSAGE_WITH_SOURCE,
						data: {
							content: "You've already joined!",
							flags: InteractionResponseFlags.EPHEMERAL,
						},
					});
				}

				joined_users.push(username);

				// Send results
				return res.send({
					type: InteractionResponseType.UPDATE_MESSAGE,
					data: {
						content: `${username} joined! \n current joined users: \n ${list_users(joined_users)}`,

						components: [
							{
								type: 1,
								components: [
									{
										type: 2,
										style: 1,
										custom_id: "mainjoinbutton",
										label: `Join us`,
									},
								],
							},
						],
					},
				});
			}
		}
	},
);

app.listen(PORT, () => {
	console.log("Listening on port", PORT);
});

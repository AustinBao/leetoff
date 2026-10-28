export async function get_user_stats(username) {
	// looked in devtools to find the right graphql query (userSessionProgress)
	const query = `
	query ($u: String!) {
		matchedUser(username: $u) {
		username
		submitStatsGlobal { acSubmissionNum { difficulty count } }
		}
		recentAcSubmissionList(username: $u, limit: 20) { title titleSlug timestamp }
	}`;

	const r = await fetch("https://leetcode.com/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Referer: "https://leetcode.com",
		},
		body: JSON.stringify({ query, variables: { u: username } }),
	});
	const json = await r.json();
	console.log(JSON.stringify(await json, null, 2));
	return json;
}

export async function get_counts(lcUsername) {
	const stats = await get_user_stats(lcUsername);
	const user = stats?.data?.matchedUser;
	if (!user) return null; // user doesn't exist

	const counts = { easy: 0, medium: 0, hard: 0 };
	for (const s of user.submitStatsGlobal.acSubmissionNum) {
		if (s.difficulty === "Easy") counts.easy = s.count;
		else if (s.difficulty === "Medium") counts.medium = s.count;
		else if (s.difficulty === "Hard") counts.hard = s.count;
	}
	return counts;
}

// might require async in future to avoid discord's 3 sec rule
export async function get_live_stats(players) {
	const live = {};
	for (const player of players) {
		live[player.discord_id] = await get_counts(player.leetcode);
	}
	return live;
}

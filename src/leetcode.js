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

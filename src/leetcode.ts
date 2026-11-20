import type { Difficulty, LiveStats, Player, Problem, SolveCounts } from "./types.ts";

interface UserStatsResponse {
	data?: {
		matchedUser: {
			username: string;
			submitStatsGlobal: {
				acSubmissionNum: { difficulty: "All" | "Easy" | "Medium" | "Hard"; count: number }[];
			};
		} | null;
		recentAcSubmissionList: { title: string; titleSlug: string; timestamp: string }[] | null;
	};
}

interface RandomQuestionResponse {
	data?: {
		randomQuestion: Omit<Problem, "url"> | null;
	};
}

export async function get_user_stats(username: string): Promise<UserStatsResponse> {
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
	const json = (await r.json()) as UserStatsResponse;
	return json;
}

export async function get_counts(lcUsername: string): Promise<SolveCounts | null> {
	const stats = await get_user_stats(lcUsername);
	const user = stats?.data?.matchedUser;
	if (!user) return null; // user doesn't exist

	const counts: SolveCounts = { easy: 0, medium: 0, hard: 0 };
	for (const s of user.submitStatsGlobal.acSubmissionNum) {
		if (s.difficulty === "Easy") counts.easy = s.count;
		else if (s.difficulty === "Medium") counts.medium = s.count;
		else if (s.difficulty === "Hard") counts.hard = s.count;
	}
	return counts;
}

// might require async in future to avoid discord's 3 sec rule
export async function get_live_stats(players: Player[]): Promise<LiveStats> {
	const live: LiveStats = {};
	for (const player of players) {
		try {
			live[player.discord_id] = await get_counts(player.leetcode);
		} catch (err) {
			console.error(
				`Couldn't fetch stats for ${player.leetcode}:`,
				err instanceof Error ? err.message : err,
			);
			live[player.discord_id] = null;
		}
	}
	return live;
}

export async function get_random_problem(difficulty: Difficulty): Promise<Problem | null> {
	const query = `
	query ($categorySlug: String, $filters: QuestionListFilterInput) {
		randomQuestion(categorySlug: $categorySlug, filters: $filters) {
			questionFrontendId title titleSlug difficulty acRate
			topicTags { name }
		}
	}`;

	const r = await fetch("https://leetcode.com/graphql", {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Referer: "https://leetcode.com",
		},
		body: JSON.stringify({
			query,
			variables: {
				categorySlug: "",
				filters: { difficulty: difficulty.toUpperCase() },
			},
		}),
	});
	const json = (await r.json()) as RandomQuestionResponse;
	const q = json?.data?.randomQuestion;
	if (!q) return null; // fetching problem failed
	return { ...q, url: `https://leetcode.com/problems/${q.titleSlug}/` };
}

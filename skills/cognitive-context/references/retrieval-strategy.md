# Retrieval Strategy

Use staged retrieval instead of raw top-k dumps:

1. Detect the project and current task.
2. Load active open loops.
3. Load procedural/user preferences.
4. Search semantic memories.
5. Add recent episodic events only when sequence matters.
6. Add artifact state when files or tests are in play.
7. Include stale or conflicting facts only as warnings.

Keep briefs under the requested token budget and deduplicate aggressively.

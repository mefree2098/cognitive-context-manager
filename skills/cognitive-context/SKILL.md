---
name: cognitive-context
description: Use when a Codex task spans multiple turns, modifies code, resumes prior work, depends on project memory, requires remembering decisions, or needs clean working context. Do not use for trivial one-shot questions.
---

# Cognitive Context Manager Skill

Use this skill to keep long Codex sessions clean, grounded, and resumable.

Before starting non-trivial work:
1. Call `get_working_context` with the current task, repo path, and known project name if available.
2. Read the returned `working_context_brief`.
3. Treat `AGENTS.md` and checked-in project docs as source-of-truth for required rules.
4. Treat plugin memories as helpful recall that may require verification.

During work:
1. Record important decisions with `record_decision`.
2. Use `get_open_loops` before claiming a task is complete.
3. Use `get_artifact_state` when editing files across multiple turns.
4. Use `search_memories` when the user says "last time", "as before", "you know", "continue", "same issue", or references prior project context.
5. Mark stale assumptions using `mark_stale` when new evidence contradicts older memory.

At the end of meaningful work:
1. Call `compact_session` to create a concise handoff.
2. Make sure open questions, test status, changed files, and next steps are recorded.
3. Do not dump raw memory into the answer. Use only the relevant distilled context.

Memory use rules:
- Never trust memory over the current repo state.
- Never store secrets, credentials, tokens, private keys, or raw personal data.
- Prefer short, structured memories with provenance.
- If memory conflicts with files or tool output, prefer current verified evidence.

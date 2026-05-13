# Context Policy

Cognitive Context Manager keeps working context compact. It records structured evidence from hooks and explicit MCP tool calls, then returns short briefs scoped to the current task.

Project files, tests, AGENTS.md, and tool output are stronger evidence than memory. When memory conflicts with current repo evidence, verify and prefer the current evidence.

The plugin stores summaries by default. Raw prompts and raw tool output are disabled unless configured otherwise. Secrets are always redacted before writes.

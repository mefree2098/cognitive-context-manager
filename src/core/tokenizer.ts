export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.replace(/\s+/g, " ").trim().length / 4);
}

export function truncateToTokens(text: string, maxTokens: number): string {
  if (estimateTokens(text) <= maxTokens) return text;
  const maxChars = Math.max(0, maxTokens * 4);
  if (text.length <= maxChars) return text;
  const slice = text.slice(0, maxChars);
  const lastBreak = Math.max(slice.lastIndexOf("\n"), slice.lastIndexOf(" "));
  const trimmed = slice.slice(0, lastBreak > maxChars * 0.7 ? lastBreak : maxChars).trim();
  return `${trimmed}\n\n[truncated to fit context budget]`;
}

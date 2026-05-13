export interface RedactionResult {
  text: string;
  redactions: string[];
}

const REDACTION_PATTERNS: Array<[RegExp, string]> = [
  [/-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/g, "PRIVATE_KEY"],
  [/sk-[A-Za-z0-9_-]{20,}/g, "OPENAI_API_KEY"],
  [/gh[pousr]_[A-Za-z0-9_]{20,}/g, "GITHUB_TOKEN"],
  [/\bAKIA[0-9A-Z]{16}\b/g, "AWS_ACCESS_KEY"],
  [/\bASIA[0-9A-Z]{16}\b/g, "AWS_SESSION_KEY"],
  [/\b(?:password|passwd|pwd|secret|token|api[_-]?key)\s*[:=]\s*["']?[^"'\s]{8,}["']?/gi, "CREDENTIAL_ASSIGNMENT"],
  [/\b(?:Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{16,}/gi, "AUTH_HEADER"],
  [/mongodb(?:\+srv)?:\/\/[^\s"']+/gi, "CONNECTION_STRING"],
  [/postgres(?:ql)?:\/\/[^\s"']+/gi, "CONNECTION_STRING"],
  [/mysql:\/\/[^\s"']+/gi, "CONNECTION_STRING"],
  [/redis:\/\/[^\s"']+/gi, "CONNECTION_STRING"],
  [/"private_key"\s*:\s*"-----BEGIN PRIVATE KEY-----[\s\S]*?-----END PRIVATE KEY-----\\n?"/g, "GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY"],
  [/\b(?:session|sid|cookie)=([A-Za-z0-9._~%+-]{16,})/gi, "SESSION_COOKIE"],
  [/\b(?:azure|client)[_-]?(?:secret|token)\s*[:=]\s*["']?[^"'\s]{12,}["']?/gi, "AZURE_CREDENTIAL"]
];

export function redactSecrets(input: string | undefined | null): RedactionResult {
  let text = input ?? "";
  const redactions = new Set<string>();

  for (const [pattern, label] of REDACTION_PATTERNS) {
    text = text.replace(pattern, () => {
      redactions.add(label);
      return `[REDACTED_${label}]`;
    });
  }

  return { text, redactions: [...redactions].sort() };
}

export function containsSecret(input: string | undefined | null): boolean {
  return redactSecrets(input).redactions.length > 0;
}

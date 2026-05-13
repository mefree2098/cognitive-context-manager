const HIGH_IMPORTANCE = /\b(from now on|always|never|must|critical|important|remember|do not|don't|wrong|broken|urgent)\b/i;
const FAILURE = /\b(error|failed|failure|exception|traceback|denied|timeout|blocked)\b/i;
const TASK = /\b(fix|implement|build|ship|deploy|test|verify|continue|resume|todo|open loop)\b/i;
const FRUSTRATION = /\b(frustrated|annoying|again|still|why|stop doing|this is wrong)\b/i;
const SECURITY = /\b(secret|token|password|credential|private key|sudo|rm -rf|force push)\b/i;

export interface SalienceInput {
  text?: string;
  signals?: string[];
  relevanceToCurrentGoal?: number;
  explicitUserImportance?: number;
  projectPersistence?: number;
  failureOrBlockerWeight?: number;
  repeatedReferenceCount?: number;
  recency?: number;
  urgencyOrFrustration?: number;
  securityImpact?: number;
}

function clamp(score: number): number {
  return Math.max(0, Math.min(1, Number(score.toFixed(3))));
}

export function scoreSalience(input: SalienceInput): number {
  const text = input.text ?? "";
  const signals = new Set(input.signals ?? []);
  const relevanceToCurrentGoal =
    input.relevanceToCurrentGoal ?? (TASK.test(text) || HIGH_IMPORTANCE.test(text) || signals.has("failure") ? 0.85 : 0.35);
  const explicitUserImportance =
    input.explicitUserImportance ??
    (HIGH_IMPORTANCE.test(text) || signals.has("preference") || signals.has("safety") ? 1 : 0.25);
  const projectPersistence =
    input.projectPersistence ?? (signals.has("artifact_change") || signals.has("decision") ? 0.8 : 0.35);
  const failureOrBlockerWeight =
    input.failureOrBlockerWeight ?? (FAILURE.test(text) || signals.has("failure") || signals.has("blocker") ? 1 : 0.1);
  const repeatedReferenceCount =
    input.repeatedReferenceCount ?? (/\b(last time|same issue|as before|continue|again)\b/i.test(text) ? 0.8 : 0.1);
  const recency = input.recency ?? 1;
  const urgencyOrFrustration = input.urgencyOrFrustration ?? (FRUSTRATION.test(text) ? 0.9 : 0.1);
  const securityImpact = input.securityImpact ?? (SECURITY.test(text) || signals.has("safety") ? 1 : 0.05);

  return clamp(
    relevanceToCurrentGoal * 0.3 +
      explicitUserImportance * 0.2 +
      projectPersistence * 0.15 +
      failureOrBlockerWeight * 0.1 +
      repeatedReferenceCount * 0.1 +
      recency * 0.05 +
      urgencyOrFrustration * 0.05 +
      securityImpact * 0.05
  );
}

export function scoreSignals(signals: string[], text = ""): number {
  return scoreSalience({ signals, text });
}

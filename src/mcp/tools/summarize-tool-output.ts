import { z } from "zod";
import { DeterministicSummarizationProvider } from "../../core/summarization-provider.js";
import { jsonContent, optionalString } from "./common.js";

export const summarizeToolOutputSchema = {
  command: optionalString,
  output: z.string(),
  exitCode: z.number().int().optional()
};

export function registerSummarizeToolOutput(server: any): void {
  server.tool("summarize_tool_output", "Summarize redacted tool output without injecting raw logs.", summarizeToolOutputSchema, async (input: z.infer<z.ZodObject<typeof summarizeToolOutputSchema>>) =>
    jsonContent(await new DeterministicSummarizationProvider().summarizeToolOutput(input))
  );
}

import { z } from "zod";

export function jsonContent(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(value, null, 2)
      }
    ]
  };
}

export const optionalString = z.string().min(1).optional();

export const memoryTypeSchema = z.enum([
  "episodic",
  "semantic",
  "procedural",
  "salience",
  "open_loop",
  "artifact",
  "safety"
]);

/**
 * Global filter configuration for aiMessage V3.
 * Add patterns here to hide "mechanical noise" from the UI.
 */

export const HIDDEN_SESSION_PATTERNS = [
  "you are a memory extraction",
  "memory extraction",
  "create these memory entities using the create_entities tool",
  "here is the json array:",
  "@/var/folders", // Image attachment paths
];

export const SMART_NAMING_PROMPT = `
Read the conversation and give it a short name — 2 to 4 words. The name should be how the person would refer to this work out loud to themselves. Think "that auth bug" not "Authentication Bug Fix." Think "csv export" not "Implementing CSV Export Functionality." Be casual, specific. Sentence case is fine (capitalize the first word if it feels natural). Use the words the person actually used, not technical synonyms. If they said "that weird thing with the routes" the title is "weird routes thing." If the work is about a specific file, the filename might be the best title. Never use gerunds like "fixing" or "implementing." Never describe what the AI did. Name what the work is about.

Output ONLY the 2-4 words. No quotes, no preamble, no period.
`.trim();

/**
 * Returns true if the text matches any of our "noise" patterns.
 */
export function isNoise(text: string): boolean {
  if (!text) return true;
  const lower = text.toLowerCase();
  return HIDDEN_SESSION_PATTERNS.some((pattern) => lower.includes(pattern.toLowerCase()));
}

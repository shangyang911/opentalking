/** Speech providers deployed for this demo. */
export type TtsProviderExtended = "edge" | "dashscope" | "cosyvoice";

export function isEdgeTts(provider: string): boolean {
  return provider === "edge";
}

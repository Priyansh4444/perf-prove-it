import type { DynamicStreamerData } from "@/lib/dynamicStreamer";
import { DATA_URL, EMOTE_NAMES } from "./corpus";

const FAKE_DATA = {
  channel: "harness",
  targets: EMOTE_NAMES.map((name, i) => ({
    name,
    url: DATA_URL,
    kind: i % 4 === 0 ? "twitch" : "7tv",
  })),
} as unknown as DynamicStreamerData;

export function useStreamer() {
  return { data: FAKE_DATA, seData: null, archiveData: null };
}

import { useMemo, type ReactNode } from "react";
import { useStreamer } from "./streamerContext";

/**
 * Hook to retrieve all 7TV, Twitch, BTTV, and FFZ emote URL mappings
 * for the currently loaded streamer channel.
 */
export function useEmoteMap(): Map<string, string> {
  const { data, seData, archiveData } = useStreamer();

  return useMemo(() => {
    const map = new Map<string, string>();
    const sources = [data, seData, archiveData];
    for (const src of sources) {
      if (!src) continue;
      // 1. From targets list (contains resolved 7TV/Twitch/BTTV/FFZ CDN URLs)
      if (src.targets) {
        for (const t of src.targets) {
          if (t.url && (t.kind === "7tv" || t.kind === "twitch")) {
            map.set(t.name, t.url);
          }
        }
      }
      // 2. From StreamElements 7TV / Twitch / BTTV / FFZ emote list
      if (src.streamelements?.emotes) {
        const allEmotes = [
          ...(src.streamelements.emotes["7tv"] || []),
          ...(src.streamelements.emotes.twitch || []),
          ...(src.streamelements.emotes.bttv || []),
          ...(src.streamelements.emotes.ffz || []),
        ];
        for (const em of allEmotes) {
          if (!map.has(em.name)) {
            if (em.url) {
              map.set(em.name, em.url);
            } else if (em.id) {
              map.set(em.name, `https://cdn.7tv.app/emote/${em.id}/2x.webp`);
            }
          }
        }
      }
    }
    return map;
  }, [data, seData, archiveData]);
}

/**
 * Hotswaps 7TV, Twitch, BTTV, and FFZ emote words in live chat messages
 * with inline emote images. Also highlights matched vote tokens.
 */
export function renderChatEmotes(
  text: string,
  emoteMap?: Map<string, string> | Record<string, string>,
  matchedToken?: string
): ReactNode {
  if (!text) return null;

  // Split text by whitespace into words and spaces while preserving whitespace
  const tokens = text.split(/(\s+)/);

  return (
    <span>
      {tokens.map((token, i) => {
        // If it's pure whitespace, render as-is
        if (/^\s+$/.test(token)) {
          return <span key={i}>{token}</span>;
        }

        // Check if token matches an emote in emoteMap
        let emoteUrl: string | undefined;
        if (emoteMap) {
          if (emoteMap instanceof Map) {
            emoteUrl = emoteMap.get(token) || emoteMap.get(token.toLowerCase());
          } else {
            emoteUrl = emoteMap[token] || emoteMap[token.toLowerCase()];
          }
        }

        if (emoteUrl) {
          return (
            <img
              key={i}
              src={emoteUrl}
              alt={token}
              title={token}
              className="inline-block h-[1.3em] max-h-5 min-w-[1.2em] w-auto align-middle mx-0.5 object-contain select-none transition-transform hover:scale-125"
              loading="lazy"
            />
          );
        }

        // Check if token matches highlighted vote token
        if (matchedToken && token.toLowerCase() === matchedToken.toLowerCase()) {
          return (
            <span key={i} className="bg-primary/20 text-primary font-semibold px-0.5 rounded">
              {token}
            </span>
          );
        }

        return <span key={i}>{token}</span>;
      })}
    </span>
  );
}

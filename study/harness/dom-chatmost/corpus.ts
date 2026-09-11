import type { TwitchChatMessage } from "@/lib/twitchChat";

export const DATA_URL =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

export const EMOTE_NAMES = [
  "KEKW", "PogU", "peepoHappy", "catJAM", "5Head", "Clap", "monkaS", "EZ",
  "LULW", "Sadge", "widepeepoHappy", "pepeD", "modCheck", "Jupij", "NOOO",
  "Hmm", "Prayge", "GIGACHAD", "PauseChamp", "gladge", "peepoClap", "Aware",
  "BASED", "COPIUM", "HOPIUM", "kekW", "Pog", "PogChamp", "ratJAM", "Sussy",
  "pepeLaugh", "pepeHands", "NODDERS", "ICANT", "Susge", "WICKED", "YEP",
  "Okayge", "FeelsOkayMan", "xqcL",
];

const WORDS = [
  "lol", "wow", "nice", "gg", "this", "is", "so", "good", "bad", "actually",
  "chat", "are", "we", "doing", "today", "stream", "looks", "insane", "crazy",
  "bro", "fr", "real", "hype", "lets", "gooo", "that", "clip", "was", "wild",
  "hello", "thanks", "for", "the", "stream", "no", "way", "yes", "please",
];

const NAMES = [
  "pixelpioneer", "lurker_42", "midnightMuse", "carried_away", "tuna_sandwich",
  "GG_Enjoyer", "quietstorm", "bubblewrap", "night_owl", "sunnyday",
  "toastCrunch", "sad_gecko", "happy_hazard", "mocha_latte", "ctrl_alt_defeat",
  "idle_afk", "waffle_iron", "tiny_dancer",
];

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface HarnessMessage extends TwitchChatMessage {}

export function makeMessages(count: number, seed: number, startId: number): HarnessMessage[] {
  const rnd = mulberry32(seed);
  const emoteSet = EMOTE_NAMES;
  const messages: HarnessMessage[] = [];
  const base = 1_760_000_000_000;

  for (let i = 0; i < count; i++) {
    const tokenCount = 4 + Math.floor(rnd() * 11);
    const tokens: string[] = [];
    for (let t = 0; t < tokenCount; t++) {
      const roll = rnd();
      if (roll < 0.28) {
        const name = emoteSet[Math.floor(rnd() * emoteSet.length)];
        tokens.push(rnd() < 0.15 ? name.toLowerCase() : name);
      } else if (roll < 0.32) {
        tokens.push(String(1 + Math.floor(rnd() * 4)));
      } else {
        tokens.push(WORDS[Math.floor(rnd() * WORDS.length)]);
      }
    }

    const isVote = i % 9 === 0;
    const voteToken = isVote ? WORDS[Math.floor(rnd() * WORDS.length)] : undefined;
    if (voteToken) tokens.splice(Math.floor(rnd() * tokens.length), 0, voteToken);

    const username = NAMES[i % NAMES.length];
    messages.push({
      id: `msg-${startId + i}`,
      username,
      displayName: username,
      color: i % 5 === 0 ? "#38bdf8" : "#00f0ff",
      message: tokens.join(" "),
      timestamp: base + i * 4000,
      voteIndex: voteToken ? i % 4 : undefined,
      voteChoiceName: voteToken ? `Choice ${(i % 4) + 1}` : undefined,
      matchedToken: voteToken,
      isOverride: isVote && i % 27 === 0 ? true : undefined,
    });
  }
  // State is newest-first in the real hook (`[msg, ...prev.slice(0, 79)]`).
  return messages.reverse();
}

export const INITIAL_COUNT = 80;
export const INITIAL_MESSAGES = makeMessages(INITIAL_COUNT, 0xc0ffee, 0);

let nextId = INITIAL_COUNT;
export function makeAppendedMessage(): HarnessMessage {
  const [msg] = makeMessages(1, 0xbeef + nextId, nextId);
  msg.timestamp = Date.now();
  nextId += 1;
  return msg;
}

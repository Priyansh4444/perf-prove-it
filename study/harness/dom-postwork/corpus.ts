export type CorpusReply = {
  _id: string;
  orgId: string;
  postId: string;
  parentId: string | null;
  authorId: string;
  author: {
    _id: string;
    name: string;
    initials: string;
    avatarColor: string;
    avatarUrl?: string;
    role: "member" | "admin" | "tester";
    isAgent: boolean;
    title: string;
  };
  body: string;
  createdAt: number;
  editedAt?: number;
  unread: boolean;
  lastReadAt: number;
};

const AUTHORS = [
  {
    _id: "u1",
    name: "maya",
    initials: "M",
    avatarColor: "#8c1862",
    role: "member" as const,
    isAgent: false,
    title: "design",
  },
  {
    _id: "u2",
    name: "otto",
    initials: "O",
    avatarColor: "#3a2526",
    role: "admin" as const,
    isAgent: false,
    title: "engineering",
  },
  {
    _id: "u3",
    name: "quill bot",
    initials: "Q",
    avatarColor: "#1f3a2d",
    role: "member" as const,
    isAgent: true,
    title: "agent",
  },
  {
    _id: "u4",
    name: "ada",
    initials: "A",
    avatarColor: "#2d2a4a",
    role: "tester" as const,
    isAgent: false,
    title: "research",
  },
  {
    _id: "u5",
    name: "rens",
    initials: "R",
    avatarColor: "#4a2d1f",
    role: "member" as const,
    isAgent: false,
    title: "product",
  },
];

const OPENERS = [
  "the feed card still shows the old participant count after a reply lands",
  "unread state survives a full reload but the dot disappears on hover",
  "search ranks exact titles below body matches when the title is short",
  "the reply composer keeps the draft after switching spaces",
  "agent summaries go stale after an edit but the chip never refreshes",
  "keyboard focus escapes the popover on shift tab",
  "the unread divider is off by one when a post is marked read from the list",
  "long urls in reply bodies push the action row off screen",
  "the presence dot renders at the wrong size on retina displays",
  "catch up skips posts that were bumped while the tab was hidden",
  "editing a reply drops the mention pill styling",
  "attachments over ten megabytes fail without a visible error",
  "the thread indent collapses after the fourth level on mobile",
  "priority chips do not announce state changes to screen readers",
  "the composer send button stays disabled after pasting text",
];

const DETAILS = [
  "i can reproduce it on a cold load with a seeded workspace, and it does not need a reply from another account",
  "the network tab shows one refetch that resolves after the first paint, so the stale frame is visible",
  "this started after the pagination change but i have not bisected it",
  "safari and chrome agree, so it is probably logic rather than layout",
  "adding @quill bot to the thread does not change the outcome",
  "the screenshot in the report shows the same layout as my local build",
  "i checked the convex logs and the mutation succeeds, so the optimistic overlay is the suspect",
  "a hard refresh fixes it until the next mutation resolves",
  "the issue is behind the beta flag for spaces, which is why it is easy to miss",
  "the a11y tree still reports aria-expanded false after the panel opens",
];

const CLOSERS = [
  "happy to pair on it tomorrow if that helps",
  "i will leave the thread open until someone picks it up",
  "marked this as high because it blocks the demo walkthrough",
  "low priority if the fix is invasive, but it bothers me",
  "repro steps are in the linked doc, section two",
  "cc @otto since the ranking code is near the unread logic",
  "let us decide before the next release cut",
  "this one is cosmetic but it shows up in every screenshot",
];

function lcg(seed: number) {
  let state = seed >>> 0;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

function makeBody(rand: () => number, index: number): string {
  const pick = <T>(items: T[]): T => items[Math.floor(rand() * items.length)] as T;
  const parts = [pick(OPENERS)];
  if (rand() < 0.7) parts.push(pick(DETAILS));
  if (rand() < 0.35) parts.push(pick(CLOSERS));
  if (index % 3 === 0) parts.push(`notes: https://example.com/threads/2026/${1000 + index}`);
  if (index % 5 === 0) parts.push("trace: `ReplyTree.tsx:213` renders the child section per node");
  return parts.join(". ").replace(/\.\. /g, ". ");
}

export function makeCorpus(): CorpusReply[] {
  const rand = lcg(20260910);
  const replies: CorpusReply[] = [];
  const base = 1757500000000;
  let created = 0;

  const push = (parentId: string | null, index: number) => {
    const author = AUTHORS[Math.floor(rand() * AUTHORS.length)]!;
    created += 1;
    replies.push({
      _id: `r${index}`,
      orgId: "org1",
      postId: "post-harness",
      parentId,
      authorId: author._id,
      author,
      body: makeBody(rand, index),
      createdAt: base + created * 60000,
      ...(rand() < 0.12 ? { editedAt: base + created * 60000 + 30000 } : {}),
      unread: rand() < 0.25,
      lastReadAt: base,
    });
    return `r${index}`;
  };

  let index = 0;
  const rootCount = 15;
  const childrenPerRoot = 4;
  const childIds: string[] = [];

  for (let r = 0; r < rootCount; r++) {
    const rootId = push(null, index++);
    for (let c = 0; c < childrenPerRoot; c++) {
      childIds.push(push(rootId, index++));
    }
  }

  for (const [childIndex, childId] of childIds.entries()) {
    const count = childIndex < 5 ? 3 : 2;
    for (let g = 0; g < count; g++) {
      push(childId, index++);
    }
  }

  return replies;
}

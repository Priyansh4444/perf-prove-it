// Interleaved old-vs-new A/B in one process. This is the setup that produced
// the 16x phantom result: both module instances deoptimize each other.
async function main() {
  const N = await import("./after.mjs");
  const O = await import("./before.mjs");
  const TERMS = ["linux", "box", "cheap", "laptop", "convex", "rust", "token", "server", "cache", "query", "index", "rank"];
  const STOP = new Set(["the", "and", "for", "with", "from", "that", "this"]);
  const xqOf = (E) => {
    const x = E.emptyXQuery();
    x.must = [...TERMS];
    x.should = ["kernel"];
    x.exclude = ["iphone"];
    x.aspects = ["~price"];
    return x;
  };
  const candsOf = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) out.push({
      tweetId: `t${i}`,
      tf: new Map([[TERMS[i % TERMS.length], 1 + (i % 3)], ["kernel", 1]]),
      matchedVia: "L0",
      likeCount: (i * 7) % 5000,
      replyCount: i % 50,
      retweetCount: i % 100,
      quoteCount: i % 10,
      propagatedBoost: 0,
      createdAt: 1750000000000 - i * 60000,
      tokenCount: 20 + (i % 15),
      authorAuthority: 1 + (i % 9),
      mediaType: "none",
      feedbackVotes: (i % 11) - 5,
      sourceTweetId: `t${i}`,
    });
    return out;
  };
  const dfsOf = () => new Map([...TERMS.map((t, i) => [t, 100 + i * 137]), ["kernel", 50], ["~price", 8000], ["iphone", 300]]);
  const statsOf = () => ({ totalDocs: 100000, avgTokenCount: 30, dfs: dfsOf() });
  const TEXTS = [
    "Just shipped convex search Phase 2: tier A+B ladder with rerank. p50 12ms.",
    "Long thread on pagerank vs follower counts for authority: like velocity decays fast, quotes carry 4x signal, replies weighted 2x.",
    "cheap laptop pricing too expensive? comparing boxes for the homelab $99",
    "What did karpathy say about Scale AI this week?",
  ];
  const XN = xqOf(N), XO = xqOf(O);
  const CN = candsOf(200), CO = candsOf(200);
  const SN = statsOf(), SO = statsOf();
  console.error("same-result", JSON.stringify(N.rerank(XN, CN, SN, 1750000000000).map((s) => s.tweetId)) === JSON.stringify(O.rerank(XO, CO, SO, 1750000000000).map((s) => s.tweetId)) ? "YES" : "NO");
  for (const [E, X, C, S] of [[N, XN, CN, SN], [O, XO, CO, SO]]) {
    for (let i = 0; i < 12000; i++) {
      E.rerank(X, C, S, 1750000000000);
      E.tokenize(TEXTS[i % 4], STOP);
      E.planL0(X, S.dfs);
      E.mapAspects(TERMS, TEXTS[2], { aspects: {} });
    }
  }
  for (const E of [N, O]) for (const f of [E.rerank, E.tokenize, E.planL0, E.escalate, E.mapAspects]) %PrepareFunctionForOptimization(f);
  for (const E of [N, O]) for (const f of [E.rerank, E.tokenize, E.planL0, E.escalate, E.mapAspects]) %OptimizeFunctionOnNextCall(f);
  for (const [E, X, C, S] of [[N, XN, CN, SN], [O, XO, CO, SO]]) {
    E.rerank(X, C, S, 1750000000000);
    E.tokenize(TEXTS[0], STOP);
    E.planL0(X, S.dfs);
    E.mapAspects(TERMS, TEXTS[2], { aspects: {} });
  }
  let acc = 0;
  for (let i = 0; i < 4000; i++) {
    acc += N.rerank(XN, CN, SN, 1750000000000 + i).length;
    acc += O.rerank(XO, CO, SO, 1750000000000 + i).length;
  }
  console.error("acc", acc);
}
main();

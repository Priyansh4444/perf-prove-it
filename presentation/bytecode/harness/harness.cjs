async function main() {
  const enginePath = process.argv[2] ?? "./before.mjs";
  const E = await import(enginePath);
  const TERMS = ["linux", "box", "cheap", "laptop", "convex", "rust", "token", "server", "cache", "query", "index", "rank"];
  const STOP = new Set(["the", "and", "for", "with", "from", "that", "this"]);
  const makeXq = () => {
    const xq = E.emptyXQuery();
    xq.must = [...TERMS];
    xq.should = ["kernel"];
    xq.exclude = ["iphone"];
    xq.aspects = ["~price"];
    return xq;
  };
  const makeCands = (n) => {
    const out = [];
    for (let i = 0; i < n; i++) {
      out.push({
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
    }
    return out;
  };
  const DFS = new Map([...TERMS.map((t, i) => [t, 100 + i * 137]), ["kernel", 50], ["~price", 8000], ["iphone", 300]]);
  const STATS = { totalDocs: 100000, avgTokenCount: 30, dfs: DFS };
  const NOW = 1750000000000;
  const TEXTS = [
    "Just shipped convex search Phase 2: tier A+B ladder with rerank. p50 12ms.",
    "Long thread on pagerank vs follower counts for authority: like velocity decays fast, quotes carry 4x signal, replies weighted 2x. Full writeup with ablation numbers on 165k posts below.",
    "cheap laptop pricing too expensive? comparing boxes for the homelab $99",
    "What did karpathy say about Scale AI this week?",
  ];
  const xq = makeXq();
  const cands = makeCands(200);
  let sink = 0;
  for (let i = 0; i < 12000; i++) {
    sink += E.rerank(xq, cands, STATS, NOW).length;
    sink += E.tokenize(TEXTS[i % TEXTS.length], STOP).tokens.length;
    sink += E.planL0(xq, DFS).gates.length;
    sink += E.mapAspects(TERMS, "cheap laptop", { aspects: {} }).length;
    sink += E.uniqueTerms(xq.must, xq.should, xq.aspects).length;
  }
  const fns = [E.rerank, E.tokenize, E.planL0, E.escalate, E.mapAspects, E.uniqueTerms];
  for (const f of fns) %PrepareFunctionForOptimization(f);
  for (const f of fns) %OptimizeFunctionOnNextCall(f);
  sink += E.rerank(xq, cands, STATS, NOW).length;
  sink += E.tokenize(TEXTS[0], STOP).tokens.length;
  sink += E.planL0(xq, DFS).gates.length;
  sink += E.escalate(E.planL0(xq, DFS), 0, xq, DFS)?.gates.length ?? -1;
  sink += E.mapAspects(TERMS, "cheap laptop", { aspects: {} }).length;
  sink += E.uniqueTerms(xq.must, xq.should, xq.aspects).length;
  for (const [name, fn] of [
    ["rerank", E.rerank],
    ["tokenize", E.tokenize],
    ["planL0", E.planL0],
    ["escalate", E.escalate],
    ["mapAspects", E.mapAspects],
    ["uniqueTerms", E.uniqueTerms],
  ]) {
    console.error("opt-status", name, %GetOptimizationStatus(fn));
  }
  console.error("sink", sink);
}
main();

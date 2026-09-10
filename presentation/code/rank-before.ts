// convex/engine/rank.ts, rerank, before (PR #10)
  const raw = candidates.map((c) => {
    let rel = 0;
    for (const [term, tf] of c.tf) {
      rel += bm25(
        tf,
        stats.dfs.get(term) ?? 0,
        stats.totalDocs,
        c.tokenCount,
        stats.avgTokenCount,
      );
    }
    const eng = Math.log1p(
      WEIGHTS.w_like * c.likeCount +
        WEIGHTS.w_reply * c.replyCount +
        WEIGHTS.w_rt * c.retweetCount +
        WEIGHTS.w_quote * c.quoteCount +
        Math.max(0, c.propagatedBoost),
    );
    return { rel, eng, auth: Math.max(0, c.authorAuthority) };
  });
  const z = {
    rel: maxSignal(raw, (r) => r.rel),
    eng: maxSignal(raw, (r) => r.eng),
    auth: maxSignal(raw, (r) => r.auth),
  };


export const codeBefore = `  const raw = candidates.map((c) => {
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
`;

export const codeAfter = `  const rels: number[] = new Array(candidates.length);
  const engs: number[] = new Array(candidates.length);
  const auths: number[] = new Array(candidates.length);
  let zRel = 1e-9;
  let zEng = 1e-9;
  let zAuth = 1e-9;
  for (let i = 0; i < candidates.length; i++) {
    const c = candidates[i]!;
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
    const auth = Math.max(0, c.authorAuthority);
    rels[i] = rel;
    engs[i] = eng;
    auths[i] = auth;
    if (rel > zRel) zRel = rel;
    if (eng > zEng) zEng = eng;
    if (auth > zAuth) zAuth = auth;
  }`;

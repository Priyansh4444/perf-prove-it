# Runtime matrix

Read this only when evidence may cross runtimes.

Node and Chromium use V8 but different builds and tier policies. Bun uses JavaScriptCore. Deno may differ in bundling and embedding. A Node bytecode or tier result is not a browser or Bun result. Use Node for deterministic floor/model probes, then rebuild and measure the shipped runtime when the claim is runtime-specific.

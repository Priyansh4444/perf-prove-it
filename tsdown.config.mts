import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/cli.mts", "src/index.mts"],
  format: "esm",
  platform: "node",
  target: "node22",
  deps: { neverBundle: ["oxc-parser"] },
  dts: true,
  clean: true,
  outDir: "dist",
});

import { defineConfig } from "vite";
import babel from "@rolldown/plugin-babel";
import react, { reactCompilerPreset } from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const postworkSrc = path.resolve(here, "../../../../postwork/src");

const overrides = new Map<string, string>([
  [path.join(postworkSrc, "lib/store.tsx"), path.resolve(here, "stubs/store.tsx")],
  [path.join(postworkSrc, "lib/session.tsx"), path.resolve(here, "stubs/session.tsx")],
  [path.join(postworkSrc, "lib/agentTasks.tsx"), path.resolve(here, "stubs/agentTasks.tsx")],
]);

function postworkStubs() {
  return {
    name: "postwork-stubs",
    enforce: "pre" as const,
    async resolveId(source: string, importer: string | undefined) {
      if (!importer) return null;
      if (source === "convex/react") return path.resolve(here, "stubs/convex-react.ts");
      const resolved = await this.resolve(source, importer, { skipSelf: true });
      if (!resolved) return null;
      const id = resolved.id.split("?")[0] ?? resolved.id;
      const override = overrides.get(id);
      if (process.env.DEBUG_STUBS) console.log("[stub]", source, "->", id, override ? "STUBBED" : "");
      return override ?? null;
    },
  };
}

export default defineConfig({
  root: here,
  plugins: [postworkStubs(), react(), babel({ presets: [reactCompilerPreset()] }), tailwindcss()],
  define: { "import.meta.env.VITE_DEMO": JSON.stringify("true") },
  build: {
    outDir: process.env.OUT_DIR ?? "dist",
    emptyOutDir: true,
    target: "chrome152",
  },
});

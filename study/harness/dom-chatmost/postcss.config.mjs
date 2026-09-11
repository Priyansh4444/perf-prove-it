import path from "node:path";

export default {
  plugins: {
    tailwindcss: { config: path.resolve(import.meta.dirname, "tailwind.config.cjs") },
    autoprefixer: {},
  },
};

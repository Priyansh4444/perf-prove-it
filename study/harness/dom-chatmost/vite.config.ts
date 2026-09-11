import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "node:path";

const CHAT_SRC = path.resolve("/home/pronsh/Coding/chatmost/web/src");

export default defineConfig({
  root: import.meta.dirname,
  base: "./",
  plugins: [
    react({
      babel: {
        plugins: [["babel-plugin-react-compiler", { target: "18" }]],
      },
    }),
  ],
  resolve: {
    alias: [
      ...(process.env.HARNESS_ARM === "before"
        ? [
            {
              find: /^@\/lib\/renderChatEmotes$/,
              replacement: path.resolve(import.meta.dirname, "renderChatEmotes.before.tsx"),
            },
          ]
        : []),
      { find: /^@\//, replacement: CHAT_SRC + "/" },
      {
        find: /^\.\/streamerContext$/,
        replacement: path.resolve(import.meta.dirname, "streamerContextStub.tsx"),
      },
    ],
  },
  build: {
    outDir: process.env.HARNESS_OUT ?? "dist",
    emptyOutDir: true,
  },
});

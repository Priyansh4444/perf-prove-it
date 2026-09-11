const path = require("node:path");
const base = require("/home/pronsh/Coding/chatmost/web/tailwind.config.js");

/** @type {import('tailwindcss').Config} */
module.exports = {
  ...base,
  content: [...base.content, path.join(__dirname, "*.{ts,tsx,html}")],
};

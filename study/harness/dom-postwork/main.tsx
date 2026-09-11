import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/inter/index.css";
import "./harness.css";
import { ReplyTree } from "../../../../postwork/src/components/ReplyTree";
import { makeCorpus, type CorpusReply } from "./corpus";

const REPLIES = makeCorpus();
const POST_ID = "post-harness";

declare global {
  interface Window {
    __ready?: boolean;
    __mount?: () => void;
    __stats?: () => Record<string, number>;
    __structure?: () => string;
    __text?: () => string;
    __replyCount?: number;
  }
}

function HarnessPage() {
  return (
    <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10">
      <div className="mt-6">
        <h2 className="type-numeric mb-1 text-body font-semibold text-muted">
          {REPLIES.length} replies
        </h2>
        <ReplyTree
          replies={REPLIES as never}
          postId={POST_ID as never}
        />
      </div>
    </div>
  );
}

window.__mount = () => {
  const root = createRoot(document.getElementById("root")!);
  flushSync(() => root.render(<HarnessPage />));
};

window.__stats = () => ({
  elements: document.querySelectorAll("*").length,
  articles: document.querySelectorAll("article").length,
  sections: document.querySelectorAll("section[aria-label^='Replies to']").length,
  links: document.querySelectorAll("a").length,
  iframes: document.querySelectorAll("iframe").length,
  scrollHeight: document.documentElement.scrollHeight,
});

function serialize(el: Element, depth: number, out: string[]) {
  const tag = el.tagName.toLowerCase();
  const attrs: string[] = [];
  for (const attr of Array.from(el.attributes)) {
    if (attr.name === "class" || attr.name === "style") continue;
    attrs.push(`${attr.name}=${attr.value}`);
  }
  attrs.sort();
  out.push(`${depth}:${tag}[${attrs.join(",")}]`);
  for (const child of Array.from(el.childNodes)) {
    if (child.nodeType === 3) {
      const text = child.textContent?.replace(/\s+/g, " ").trim();
      if (text) out.push(`${depth}:text<${text}>`);
    } else if (child.nodeType === 1) {
      serialize(child as Element, depth + 1, out);
    }
  }
}

window.__structure = () => {
  const out: string[] = [];
  serialize(document.getElementById("root")!, 0, out);
  return out.join("\n");
};

window.__text = () => document.getElementById("root")!.textContent ?? "";

window.__replyCount = REPLIES.length;

window.__ready = true;

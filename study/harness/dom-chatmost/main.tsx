import { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import { TwitchChatFeed } from "@/components/TwitchChatFeed";
import { INITIAL_MESSAGES, makeAppendedMessage, type HarnessMessage } from "./corpus";
import "@/index.css";

declare global {
  interface Window {
    __harness: {
      mount: () => void;
      appendOne: () => void;
      messageCount: () => number;
    };
  }
}

function Harness() {
  const [messages, setMessages] = useState<HarnessMessage[]>([]);
  const messagesRef = useRef(0);
  messagesRef.current = messages.length;

  useEffect(() => {
    window.__harness = {
      mount: () => setMessages(INITIAL_MESSAGES),
      appendOne: () => setMessages((prev) => [makeAppendedMessage(), ...prev.slice(0, 79)]),
      messageCount: () => messagesRef.current,
    };
  }, []);

  return (
    <div className="mx-auto w-[760px] p-4">
      <div id="feed-root">
        <TwitchChatFeed messages={messages} status="connected" channel="harness" totalVotes={0} />
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<Harness />);

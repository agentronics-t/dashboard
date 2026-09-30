"use client";

import { useRef, useState } from "react";

interface Msg {
  role: "user" | "assistant";
  text: string;
}

const SUGGESTIONS = [
  "What changed in agent traffic this week?",
  "Which agents are being blocked most?",
  "How much of my traffic is stealth?"
];

export default function ChatPage() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  const send = async (q: string) => {
    if (!q.trim() || busy) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", text: q }, { role: "assistant", text: "" }]);
    setBusy(true);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q })
      });
      if (!res.body) throw new Error("no stream");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        setMessages((m) => {
          const copy = [...m];
          copy[copy.length - 1] = { role: "assistant", text: copy[copy.length - 1]!.text + chunk };
          return copy;
        });
        scrollRef.current?.scrollTo(0, scrollRef.current.scrollHeight);
      }
    } catch (e) {
      setMessages((m) => {
        const copy = [...m];
        copy[copy.length - 1] = { role: "assistant", text: `Error: ${e instanceof Error ? e.message : "failed"}` };
        return copy;
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "calc(100vh - 60px)" }}>
      <h1 style={{ margin: "0 0 4px", fontSize: 22, fontWeight: 700, letterSpacing: "-0.01em" }}>Agent Chat</h1>
      <p style={{ margin: "0 0 18px", color: "var(--content-muted)", fontSize: 14 }}>
        Ask about your agent traffic — answers are grounded in your insights and aggregates.
      </p>

      <div ref={scrollRef} style={{ flex: 1, overflowY: "auto", display: "flex", flexDirection: "column", gap: 14, paddingRight: 4 }}>
        {messages.length === 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 10 }}>
            {SUGGESTIONS.map((s) => (
              <button key={s} onClick={() => send(s)} style={{ padding: "10px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border)", background: "var(--surface)", color: "var(--content-secondary)", fontSize: 13, cursor: "pointer", textAlign: "left" }}>
                {s}
              </button>
            ))}
          </div>
        )}
        {messages.map((m, i) => (
          <div key={i} style={{ alignSelf: m.role === "user" ? "flex-end" : "flex-start", maxWidth: "80%" }}>
            <div style={{
              padding: "11px 15px",
              borderRadius: "var(--radius-lg)",
              background: m.role === "user" ? "var(--brand-solid)" : "var(--surface)",
              color: m.role === "user" ? "#fff" : "var(--content)",
              border: m.role === "user" ? "none" : "1px solid var(--border)",
              fontSize: 14,
              lineHeight: 1.55,
              whiteSpace: "pre-wrap"
            }}>
              {m.text || (busy ? "…" : "")}
            </div>
          </div>
        ))}
      </div>

      <form
        onSubmit={(e) => { e.preventDefault(); send(input); }}
        style={{ display: "flex", gap: 10, marginTop: 16, borderTop: "1px solid var(--border)", paddingTop: 16 }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Ask about your agent traffic…"
          style={{ flex: 1, padding: "12px 14px", borderRadius: "var(--radius-md)", border: "1px solid var(--border-strong)", background: "var(--surface)", color: "var(--content)", fontSize: 14, outline: "none" }}
        />
        <button type="submit" disabled={busy || !input.trim()} style={{ padding: "0 20px", borderRadius: "var(--radius-md)", border: "none", background: busy || !input.trim() ? "var(--surface-raised)" : "var(--brand-solid)", color: busy || !input.trim() ? "var(--content-muted)" : "#fff", fontWeight: 600, fontSize: 14, cursor: busy || !input.trim() ? "default" : "pointer" }}>
          Send
        </button>
      </form>
    </div>
  );
}

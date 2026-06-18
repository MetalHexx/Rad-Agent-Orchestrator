"use client";

import { useState, useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SessionIdField } from "./session-id-field";

interface ChatMessage {
  role: "user" | "assistant";
  text: string;
}

export function ChatPanel() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [thinking, setThinking] = useState(false);
  const [sessionId, setSessionId] = useState("");
  const [resume, setResume] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // The client owns the session: mint a fresh id on mount. The first turn creates
  // it (resume=false) and every later turn resumes it (FR-4, FR-5, AD-6).
  useEffect(() => {
    setSessionId(crypto.randomUUID());
    setResume(false);
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages, thinking]);

  async function send() {
    const text = input.trim();
    if (!text || thinking) return;
    setError(null);
    setMessages((m) => [...m, { role: "user", text }]);
    setInput("");
    setThinking(true);
    try {
      const res = await fetch("/api/brainstorm-poc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, sessionId, resume }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Request failed");
      // Adopt the id Claude actually used, then resume it from here on.
      if (data.sessionId) setSessionId(data.sessionId);
      setResume(true);
      setMessages((m) => [...m, { role: "assistant", text: data.reply ?? "" }]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setThinking(false);
    }
  }

  // "New session" is purely client-side now: a fresh id, no server round-trip.
  function newSession() {
    setError(null);
    setSessionId(crypto.randomUUID());
    setResume(false);
    setMessages([]);
  }

  // A manual paste/edit means the user wants to resume that id on the next turn
  // (the portability / hijack probe, FR-5). Programmatic updates use setSessionId
  // directly so they never flip resume.
  function handleManualSessionIdChange(value: string) {
    setSessionId(value);
    setResume(true);
  }

  return (
    <Card className="m-4 flex flex-1 flex-col overflow-hidden">
      <div className="flex flex-col gap-2 border-b px-4 py-3">
        <h1 className="text-sm font-semibold">Brainstorm POC</h1>
        <SessionIdField
          sessionId={sessionId}
          onSessionIdChange={handleManualSessionIdChange}
          onNewSession={newSession}
          disabled={thinking}
        />
      </div>
      <ScrollArea className="flex-1">
        <div ref={scrollRef} className="flex flex-col gap-3 p-4">
          {messages.length === 0 && (
            <p className="text-sm text-muted-foreground">
              Say hello to start a conversation with a background Claude Code session.
            </p>
          )}
          {messages.map((m, i) => (
            <div key={i} className={m.role === "user" ? "self-end" : "self-start"}>
              <div
                className={
                  m.role === "user"
                    ? "rounded-lg bg-primary px-3 py-2 text-sm text-primary-foreground"
                    : "rounded-lg bg-muted px-3 py-2 text-sm text-foreground"
                }
              >
                {m.text}
              </div>
            </div>
          ))}
          {thinking && (
            <div className="self-start">
              <div className="rounded-lg bg-muted px-3 py-2 text-sm text-muted-foreground">thinking…</div>
            </div>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>
      </ScrollArea>
      <Separator />
      <div className="flex items-end gap-2 p-3">
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder="Type a message…"
          rows={2}
          className="flex-1 resize-none"
        />
        <Button onClick={send} disabled={thinking || !input.trim()}>Send</Button>
      </div>
      <div className="px-3 pb-3 text-center text-xs text-muted-foreground">
        running on your Max plan · no API key
      </div>
    </Card>
  );
}

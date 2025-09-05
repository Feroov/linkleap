"use client";

import { supabase } from "@/lib/supabase";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/components/ui/toast";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { motion } from "framer-motion";
import { Link as LinkIcon, Play } from "lucide-react";
import { nanoid } from "nanoid/non-secure";

type Player = { id: string; name: string; ready: boolean; you?: boolean };

export default function WaitingRoom({
  code,
  seed,
  isHost,
}: {
  code: string;
  seed: string;
  isHost: boolean;
}) {
  const { push } = useToast();
  const [name, setName] = useState<string>("Player");
  const [ready, setReady] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myIdRef = useRef<string>("");

  // read saved name after mount
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem("ll_name") : null;
    if (saved) setName(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("ll_name", name);
  }, [name]);

  // Join presence
  useEffect(() => {
    myIdRef.current = nanoid(16);
    const chan = supabase.channel(`lobby:${code}`, {
      config: { presence: { key: myIdRef.current } },
    });
    channelRef.current = chan;

    chan.on("presence", { event: "sync" }, () => {
      const state = chan.presenceState() as Record<
        string,
        Array<{ name: string; ready: boolean }>
      >;
      const list: Player[] = [];
      for (const [id, arr] of Object.entries(state)) {
        const last = arr[arr.length - 1] || { name: "Player", ready: false };
        list.push({
          id,
          name: last.name,
          ready: last.ready,
          you: id === myIdRef.current,
        });
      }
      setPlayers(list.sort((a, b) => (a.you ? -1 : 1)));
    });

    chan.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await chan.track({ name, ready: false });
      }
    });

    return () => {
      chan.unsubscribe();
    };
  }, [code]);

  // Update presence when name/ready changes
  useEffect(() => {
    const chan = channelRef.current;
    if (!chan) return;
    chan.track({ name, ready }).catch(() => {});
  }, [name, ready]);

  useEffect(() => {
    const tick = () => {
      fetch("/api/lobby-keepalive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      }).catch(() => {});
    };
    tick();
    const id = setInterval(tick, 20_000);
    return () => clearInterval(id);
  }, [code]);

  const canStart = useMemo(
    () => isHost && players.filter((p) => p.ready).length >= 2,
    [isHost, players]
  );

type NavigatorWithShare = Navigator & {
  share?: (data: { title?: string; text?: string; url?: string }) => Promise<void>;
};

async function copyInvite() {
  const url = `${location.origin}/lobby/${code}`;

  try {
    // 1) Preferred (requires HTTPS or localhost)
    if (typeof navigator !== "undefined" && navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(url);
      push({ title: "Invite link copied" });
      return;
    }

    // 2) Fallback: legacy execCommand copy (works on HTTP and older webviews)
    const ta = document.createElement("textarea");
    ta.value = url;
    ta.setAttribute("readonly", "");
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(ta);
    if (ok) {
      push({ title: "Invite link copied" });
      return;
    }

    // 3) Extra fallback: Web Share API (mobile PWAs etc.)
    const nav = navigator as NavigatorWithShare;
    if (nav.share) {
      await nav.share({ title: "LinkLeap lobby", url });
      return;
    }

    // 4) Last resort: show the URL to copy manually
    push({ title: `Copy this: ${url}`, kind: "err" });
  } catch {
    push({ title: `Copy this: ${url}`, kind: "err" });
  }
}


  return (
    <main className="pt-8">
      <div className="flex items-baseline justify-between">
        <h1 className="text-2xl font-semibold">
          Lobby <span className="text-accent">#{code}</span>
        </h1>
        <div className="text-xs text-white/70">
          seed <code>{seed}</code>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-2">
          <span className="text-sm text-white/70">Your name</span>
          <Input
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="w-44"
          />
        </div>
        <Button
          onClick={() => setReady((v) => !v)}
          look={ready ? "accent" : "solid"}
        >
          {ready ? "Ready ✓" : "Ready up"}
        </Button>
        <Button onClick={copyInvite} look="ghost" className="gap-2">
          <LinkIcon className="h-4 w-4" /> Copy invite
        </Button>
        <Button
          disabled={!canStart}
          className="gap-2"
          look="accent"
          onClick={() =>
            push({ title: "Game start (stub) — next: game scene" })
          }
        >
          <Play className="h-4 w-4" /> Start game
        </Button>
        <Link href="/" className="ml-auto text-white/70 hover:text-white">
          ← Main menu
        </Link>
      </div>

      <div className="mt-5 grid gap-3 sm:grid-cols-2 md:grid-cols-3">
        {players.map((p, i) => (
          <motion.div
            key={p.id}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.05 }}
          >
            <Card
              className={
                "p-4 flex items-center gap-3 transition-shadow " +
                (p.ready
                  ? "shadow-[0_0_0_1px_rgba(73,242,194,.35),0_10px_30px_rgba(73,242,194,.15)]"
                  : "")
              }
            >
              {/* Avatar */}
              <div
                className={
                  "relative h-10 w-10 rounded-full " +
                  (p.ready
                    ? "bg-[linear-gradient(90deg,#49f2c2,#7c9cff,#49f2c2)] bg-[length:200%_200%] animate-gradientX"
                    : "bg-gradient-to-br from-accent/60 to-accent2/60")
                }
              />
              <div className="flex-1">
                <div
                  className={
                    "font-medium " +
                    (p.ready
                      ? "bg-[linear-gradient(90deg,#49f2c2,#7c9cff,#49f2c2)] bg-clip-text text-transparent animate-gradientX"
                      : "")
                  }
                >
                  {p.name}
                  {p.you ? " (you)" : ""}
                </div>
                <div className="text-xs text-white/60">
                  {p.ready ? "ready" : "not ready"}
                </div>
              </div>
            </Card>
          </motion.div>
        ))}
      </div>

      {/* Placeholder game art strip */}
      <div className="mt-8 grid grid-cols-3 gap-3">
        <div className="h-20 rounded-xl2 border border-[#23283a] bg-[linear-gradient(135deg,#1a1f30,#1b2037)] shadow-glow" />
        <div className="h-20 rounded-xl2 border border-[#23283a] bg-[linear-gradient(135deg,#1a1f30,#1b2037)] shadow-glow" />
        <div className="h-20 rounded-xl2 border border-[#23283a] bg-[linear-gradient(135deg,#1a1f30,#1b2037)] shadow-glow" />
      </div>
    </main>
  );
}

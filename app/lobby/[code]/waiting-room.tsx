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
import { useRouter } from "next/navigation";

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
  const r = useRouter();
  const { push } = useToast();

  const [name, setName] = useState<string>("Player");
  const [ready, setReady] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const debounceIdRef = useRef<ReturnType<typeof setTimeout> | null>(null);


  const nameRef = useRef(name);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myIdRef = useRef<string>(nanoid(16)); // stable for the whole session

  useEffect(() => {
    nameRef.current = name;
  }, [name]);

  // Immediately reflect my typed name in the list without waiting for presence roundtrip
  useEffect(() => {
    setPlayers((prev) =>
      prev.map((p) => (p.id === myIdRef.current ? { ...p, name } : p))
    );
  }, [name]);

  // single channel: presence + START
  useEffect(() => {
    const chan = supabase.channel(`lobby:${code}`, {
      config: {
        presence: { key: myIdRef.current },
        broadcast: { self: false },
      },
    });
    channelRef.current = chan;

    // stable roster (collapse multi-connections; cap at two)
    chan.on("presence", { event: "sync" }, () => {
      const state = chan.presenceState() as Record<
        string,
        Array<{ name: string; ready: boolean }>
      >;

      setPlayers((prev) => {
        // Build fresh list from presence state (no mutation of prev)
        const built: Player[] = Object.entries(state).map(([id, arr]) => {
          const last = arr[arr.length - 1] || { name: "Player", ready: false };
          return {
            id,
            name: id === myIdRef.current ? nameRef.current : last.name,
            ready: last.ready,
            you: id === myIdRef.current,
          };
        });

        const next = built
          .sort((a, b) => (a.you ? -1 : b.you ? 1 : a.id.localeCompare(b.id)))
          .slice(0, 2);

        // Preserve object identity when nothing changed to avoid re-animating rows
        const prevById = new Map(prev.map((p) => [p.id, p]));
        const merged = next.map((n) => {
          const p = prevById.get(n.id);
          return p &&
            p.name === n.name &&
            p.ready === n.ready &&
            !!p.you === !!n.you
            ? p
            : n; // return new object only if something actually changed
        });

        return merged;
      });
    });

    // navigate when someone broadcasts START (use the latest name from ref)
    chan.on("broadcast", { event: "START" }, () => {
      const qs = `?n=${encodeURIComponent(nameRef.current)}`;
      // guest uses ?n= only; host uses the button below (pushes ?host=1&n=…)
      r.push(`/lobby/${code}/game${qs}`);
    });

    chan.subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        await chan.track({ name: nameRef.current, ready: false });
      }
    });

    return () => {
      chan.unsubscribe();
      channelRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [code]); // <-- ONLY depends on code

  // load/save name
  useEffect(() => {
    const saved =
      typeof window !== "undefined" ? localStorage.getItem("ll_name") : null;
    if (saved) setName(saved);
  }, []);
  useEffect(() => {
    if (typeof window !== "undefined") localStorage.setItem("ll_name", name);
  }, [name]);

  // debounced presence updates so typing name doesn't jitter the list
  useEffect(() => {
    const chan = channelRef.current;
    if (!chan) return;

    if (debounceIdRef.current) clearTimeout(debounceIdRef.current);
    debounceIdRef.current = setTimeout(() => {
      chan.track({ name, ready }).catch(() => {});
    }, 250);

    return () => {
      if (debounceIdRef.current) clearTimeout(debounceIdRef.current);
    };
  }, [name, ready]);

  // keep lobby alive (optional)
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
    share?: (data: {
      title?: string;
      text?: string;
      url?: string;
    }) => Promise<void>;
  };

  async function copyInvite() {
    const url = `${location.origin}/lobby/${code}`;
    try {
      if (
        typeof navigator !== "undefined" &&
        navigator.clipboard &&
        window.isSecureContext
      ) {
        await navigator.clipboard.writeText(url);
        push({ title: "Invite link copied" });
        return;
      }
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

      const nav = navigator as NavigatorWithShare;
      if (nav.share) {
        await nav.share({ title: "LinkLeap lobby", url });
        return;
      }

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
          onClick={async () => {
            await channelRef.current?.send({
              type: "broadcast",
              event: "START",
              payload: {},
            });
            r.push(`/lobby/${code}/game?host=1&n=${encodeURIComponent(name)}`);
          }}
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
            transition={{ duration: 0.18 }}
            layout={false}
          >
            <Card
              className={
                "p-4 flex items-center gap-3 transition-shadow " +
                (p.ready
                  ? "shadow-[0_0_0_1px_rgba(73,242,194,.35),0_10px_30px_rgba(73,242,194,.15)]"
                  : "")
              }
            >
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

      <div className="mt-8 grid grid-cols-3 gap-3">
        <div className="h-20 rounded-xl2 border border-[#23283a] bg-[linear-gradient(135deg,#1a1f30,#1b2037)] shadow-glow" />
        <div className="h-20 rounded-xl2 border border-[#23283a] bg-[linear-gradient(135deg,#1a1f30,#1b2037)] shadow-glow" />
        <div className="h-20 rounded-xl2 border border-[#23283a] bg-[linear-gradient(135deg,#1a1f30,#1b2037)] shadow-glow" />
      </div>
    </main>
  );
}

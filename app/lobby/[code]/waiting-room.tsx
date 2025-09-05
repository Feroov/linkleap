"use client";

import { supabase } from "@/lib/supabase";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

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
  const [name, setName] = useState<string>("Player");

  // hydrate name from localStorage after mount
  useEffect(() => {
    if (typeof window !== "undefined") {
      const saved = localStorage.getItem("ll_name");
      if (saved) setName(saved);
    }
  }, []);

  // persist whenever it changes
  useEffect(() => {
    if (typeof window !== "undefined") {
      localStorage.setItem("ll_name", name);
    }
  }, [name]);

  const [ready, setReady] = useState(false);
  const [players, setPlayers] = useState<Player[]>([]);
  const channelRef = useRef<ReturnType<typeof supabase.channel> | null>(null);
  const myIdRef = useRef<string>("");

  // Join presence
  useEffect(() => {
    myIdRef.current = crypto.randomUUID();
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
    localStorage.setItem("ll_name", name);
    const chan = channelRef.current;
    if (!chan) return;
    // re-track overwrites our presence metadata
    chan.track({ name, ready }).catch(() => {});
  }, [name, ready]);

  const canStart = useMemo(
    () => isHost && players.filter((p) => p.ready).length >= 2,
    [isHost, players]
  );

  return (
    <main style={{ paddingTop: 24 }}>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
        }}
      >
        <h1 style={{ fontSize: 28 }}>Lobby #{code}</h1>
        <div style={{ fontSize: 12, opacity: 0.7 }}>
          seed <code>{seed}</code>
        </div>
      </div>

      <div
        style={{
          marginTop: 12,
          display: "flex",
          gap: 18,
          alignItems: "center",
        }}
      >
        <label style={{ fontSize: 14 }}>
          Your name:{" "}
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Player"
            style={{
              background: "#0f1116",
              color: "white",
              border: "1px solid #2a2d35",
              borderRadius: 8,
              padding: "6px 8px",
            }}
          />
        </label>
        <button
          onClick={() => setReady((v) => !v)}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: ready ? "#14351a" : "#1a1d24",
            border: "1px solid #2a2d35",
          }}
        >
          {ready ? "Ready ✓" : "Ready up"}
        </button>
        <button
          disabled={!canStart}
          title={isHost ? "" : "Only host can start"}
          onClick={() =>
            alert("Game start stub — next step is the Phaser scene")
          }
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#272b35",
            border: "1px solid #3a3f4a",
            opacity: canStart ? 1 : 0.6,
          }}
        >
          Start game
        </button>
      </div>

      <div style={{ marginTop: 20, display: "grid", gap: 10 }}>
        {players.map((p) => (
          <div
            key={p.id}
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              padding: "10px 12px",
              background: "#14161c",
              border: "1px solid #2a2d35",
              borderRadius: 12,
            }}
          >
            <div>
              {p.name}
              {p.you ? " (you)" : ""}
            </div>
            <div style={{ fontSize: 12, opacity: 0.8 }}>
              {p.ready ? "ready" : "not ready"}
            </div>
          </div>
        ))}
      </div>

      <div style={{ marginTop: 16, display: "flex", gap: 12 }}>
        <button
          onClick={async () => {
            await navigator.clipboard.writeText(
              `${location.origin}/lobby/${code}`
            );
            alert("Lobby link copied!");
          }}
          style={{
            padding: "8px 12px",
            borderRadius: 8,
            background: "#1a1d24",
            border: "1px solid #3a3f4a",
          }}
        >
          Copy invite link
        </button>
        <Link href="/" style={{ opacity: 0.8 }}>
          ← Main menu
        </Link>
      </div>
    </main>
  );
}

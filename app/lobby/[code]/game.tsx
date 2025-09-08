"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

/* ========= Types ========= */
type Player = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  color: "blue" | "orange";
};
type InputState = { left: boolean; right: boolean; jump: boolean; seq: number };
type NetInput = InputState & { from: "guest" | "host" };
type Snapshot = { t: number; p1: Player; p2: Player };
type Tile = { x: number; y: number; w: number; h: number };

/* ========= Utils ========= */
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function hashSeed(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function genLevel(seed: string) {
  const rnd = mulberry32(hashSeed(seed));
  const W = 64,
    H = 16,
    tile = 24;
  const tiles: Tile[] = [];

  // base floor
  for (let x = 0; x < W; x++)
    tiles.push({ x: x * tile, y: (H - 2) * tile, w: tile, h: 2 * tile });

  // random platforms
  for (let i = 0; i < 48; i++) {
    const x = 2 + Math.floor(rnd() * (W - 6));
    const y = 5 + Math.floor(rnd() * 7);
    const w = 1 + Math.floor(rnd() * 3);
    if (x < 4 || x > W - 8) continue; // keep start/finish corridor clear
    tiles.push({ x: x * tile, y: y * tile, w: w * tile, h: tile });
  }

  const start = { x: 1 * tile, y: (H - 4) * tile, w: 2 * tile, h: 2 * tile };
  const finish = { x: (W - 4) * tile, y: (H - 4) * tile, w: 2 * tile, h: 2 * tile };
  const size = { pxWidth: W * tile, pxHeight: H * tile };
  return { tiles, start, finish, size };
}
function aabb(a: Tile, b: Tile) {
  return (
    a.x < b.x + b.w &&
    a.x + a.w > b.x &&
    a.y < b.y + b.h &&
    a.y + a.h > b.y
  );
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/* ========= Physics constants (outside component so deps stay stable) ========= */
const GRAV = 0.7;
const MOVE = 0.6;
const MAXVX = 3.2;
const JUMP = -10;
const FRICTION = 0.85;
const STEP_MS = 1000 / 60;

/* ========= Component ========= */
export default function GamePage({ params }: { params: { code: string } }) {
  const code = params.code;
  const r = useRouter();

  const [seed, setSeed] = useState<string>("");
  const [isHost, setIsHost] = useState(false);

  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // build level
  const level = useMemo(() => (seed ? genLevel(seed) : null), [seed]);

  // canvas + sim refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reqRef = useRef<number | null>(null);

  // players
  const meColorRef = useRef<"blue" | "orange">("blue");
  const p1Ref = useRef<Player | null>(null);
  const p2Ref = useRef<Player | null>(null);

  // input (local)
  const inputRef = useRef<InputState>({
    left: false,
    right: false,
    jump: false,
    seq: 0,
  });

  // latest input received from the guest (host uses this)
  const lastGuestInputRef = useRef<InputState>({
    left: false,
    right: false,
    jump: false,
    seq: 0,
  });

  /* ====== fetch seed and infer host from ?host=1 ====== */
  useEffect(() => {
    fetch(`/api/lobby?code=${code}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((meta) => setSeed(meta?.seed || "fallback"))
      .catch(() => setSeed("fallback"));

    setIsHost(
      typeof window !== "undefined" &&
        new URLSearchParams(location.search).get("host") === "1"
    );
  }, [code]);

  /* ====== set up realtime ====== */
  useEffect(() => {
    if (!seed) return;
    const ch = supabase.channel(`lobby:${code}`, {
      config: { broadcast: { self: false } },
    });
    chanRef.current = ch;

    // host = blue, guest = orange
    meColorRef.current = isHost ? "blue" : "orange";

    // guest listens for authoritative snapshots
    ch.on(
      "broadcast",
      { event: "SNAP" },
      ({ payload }: { payload: Snapshot }) => {
        if (isHost) return; // host doesn't apply its own snapshots
        p1Ref.current = payload.p1;
        p2Ref.current = payload.p2;
      }
    );

    // host receives guest inputs
    ch.on(
      "broadcast",
      { event: "INPUT" },
      ({ payload }: { payload: NetInput }) => {
        if (!isHost) return;
        if (payload.from === "guest") {
          lastGuestInputRef.current = payload;
        }
      }
    );

    ch.subscribe();
    return () => {
      ch.unsubscribe();
    };
  }, [code, seed, isHost]);

  /* ====== keyboard ====== */
  useEffect(() => {
    const on = (e: KeyboardEvent, down: boolean) => {
      if (
        ["ArrowLeft", "ArrowRight", " ", "ArrowUp", "w", "a", "d"].includes(e.key)
      )
        e.preventDefault();
      const i = inputRef.current;
      if (e.key === "ArrowLeft" || e.key === "a") i.left = down;
      if (e.key === "ArrowRight" || e.key === "d") i.right = down;
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w") i.jump = down;
      if (down) i.seq++;
    };
    const kd = (e: KeyboardEvent) => on(e, true);
    const ku = (e: KeyboardEvent) => on(e, false);
    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
    };
  }, []);

  /* ====== helpers wrapped to keep deps stable ====== */
  const spawnPlayers = useCallback(() => {
    if (!level) return;
    const { start } = level;
    p1Ref.current = {
      id: "p1",
      x: start.x + 8,
      y: start.y - 20,
      vx: 0,
      vy: 0,
      onGround: false,
      color: "blue",
    };
    p2Ref.current = {
      id: "p2",
      x: start.x + 42,
      y: start.y - 20,
      vx: 0,
      vy: 0,
      onGround: false,
      color: "orange",
    };
  }, [level]);

  const integrate = useCallback(
    (p: Player, inp: InputState) => {
      if (!level) return;

      // horizontal
      if (inp.left) p.vx -= MOVE;
      if (inp.right) p.vx += MOVE;
      p.vx = clamp(p.vx, -MAXVX, MAXVX);

      // jump
      if (inp.jump && p.onGround) {
        p.vy = JUMP;
        p.onGround = false;
      }

      // gravity & integrate
      p.vy += GRAV;
      p.x += p.vx;
      p.y += p.vy;

      // collisions
      const bbox: Tile = { x: p.x - 8, y: p.y - 16, w: 16, h: 20 };
      p.onGround = false;
      for (const t of level.tiles) {
        if (!aabb(bbox, t)) continue;

        // resolve vertical first
        const prevY = p.y - p.vy;
        const prevBox: Tile = { x: p.x - 8, y: prevY - 16, w: 16, h: 20 };
        if (!aabb(prevBox, t)) {
          if (p.vy > 0) {
            p.y = t.y - 1;
            p.vy = 0;
            p.onGround = true;
          } else if (p.vy < 0) {
            p.y = t.y + t.h + 1;
            p.vy = 0;
          }
        } else {
          // horizontal resolve
          const prevX = p.x - p.vx;
          const prevBoxX: Tile = { x: prevX - 8, y: p.y - 16, w: 16, h: 20 };
          if (!aabb(prevBoxX, t)) {
            if (p.vx > 0) p.x = t.x - 9;
            else if (p.vx < 0) p.x = t.x + t.w + 9;
            p.vx = 0;
          }
        }
      }

      // bounds & ground friction
      p.x = clamp(p.x, 0, level.size.pxWidth - 1);
      p.y = clamp(p.y, -200, level.size.pxHeight - 1);
      if (p.onGround) p.vx *= FRICTION;
    },
    [level]
  );

  /* ====== main loop ====== */
  useEffect(() => {
    if (!level) return;

    const c = canvasRef.current!;
    c.width = level.size.pxWidth;
    c.height = level.size.pxHeight;

    spawnPlayers();

    let acc = 0;
    let last = performance.now();
    let netTimer = 0;

    const loop = (now: number) => {
      acc += now - last;
      netTimer += now - last;
      last = now;

      const meIsP1 = meColorRef.current === "blue";
      const me = meIsP1 ? (p1Ref.current as Player) : (p2Ref.current as Player);
      const them = meIsP1 ? (p2Ref.current as Player) : (p1Ref.current as Player);

      // send my input at ~20Hz
      if (netTimer > 50) {
        const payload: NetInput = {
          ...inputRef.current,
          from: isHost ? "host" : "guest",
        };
        chanRef.current?.send({
          type: "broadcast",
          event: "INPUT",
          payload,
        });
        netTimer = 0;
      }

      // host integrates authoritatively at fixed rate
      while (acc >= STEP_MS) {
        integrate(me, inputRef.current);

        const otherInp: InputState = isHost
          ? lastGuestInputRef.current // host integrates guest with last received input
          : { left: false, right: false, jump: false, seq: 0 }; // guest predicts host idle; corrected by SNAP

        integrate(them, otherInp);
        acc -= STEP_MS;
      }

      // host broadcasts state ~20Hz
      if (isHost && now % 50 < 16) {
        const snap: Snapshot = {
          t: Date.now(),
          p1: p1Ref.current as Player,
          p2: p2Ref.current as Player,
        };
        chanRef.current?.send({ type: "broadcast", event: "SNAP", payload: snap });
      }

      // draw
      const ctx = c.getContext("2d")!;
      ctx.clearRect(0, 0, c.width, c.height);

      ctx.fillStyle = "#0c1122";
      ctx.fillRect(0, 0, c.width, c.height);

      ctx.fillStyle = "#1d2440";
      for (const t of level.tiles) ctx.fillRect(t.x, t.y, t.w, t.h);

      ctx.fillStyle = "rgba(73,242,194,.2)";
      ctx.fillRect(level.start.x, level.start.y, level.start.w, level.start.h);
      ctx.fillStyle = "rgba(255,180,60,.2)";
      ctx.fillRect(level.finish.x, level.finish.y, level.finish.w, level.finish.h);

      const drawP = (p: Player) => {
        ctx.fillStyle = p.color === "blue" ? "#7c9cff" : "#ff9e57";
        ctx.fillRect(p.x - 8, p.y - 16, 16, 20);
      };
      drawP(p1Ref.current as Player);
      drawP(p2Ref.current as Player);

      // win condition (both in exit zone)
      const boxP1: Tile = {
        x: (p1Ref.current as Player).x - 8,
        y: (p1Ref.current as Player).y - 16,
        w: 16,
        h: 20,
      };
      const boxP2: Tile = {
        x: (p2Ref.current as Player).x - 8,
        y: (p2Ref.current as Player).y - 16,
        w: 16,
        h: 20,
      };
      const bothAtExit =
        aabb(boxP1, level.finish) && aabb(boxP2, level.finish);
      if (bothAtExit) {
        ctx.fillStyle = "rgba(73,242,194,.35)";
        ctx.fillRect(0, 0, c.width, c.height);
        ctx.fillStyle = "#49f2c2";
        ctx.font = "28px sans-serif";
        ctx.fillText("You both made it! GG 🎉", 20, 40);
      }

      reqRef.current = requestAnimationFrame(loop);
    };

    reqRef.current = requestAnimationFrame(loop);
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    };
  }, [level, isHost, integrate, spawnPlayers]);

  if (!seed || !level)
    return <main className="pt-8">Loading…</main>;

  return (
    <main className="pt-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">Game — Lobby #{code}</h1>
        <button
          className="text-white/60 hover:text-white"
          onClick={() => r.push(`/lobby/${code}`)}
        >
          ← Back to lobby
        </button>
      </div>
      <div className="mt-3 overflow-auto rounded-xl2 border border-[#23283a] bg-[#0b1020]">
        <canvas ref={canvasRef} />
      </div>
      <p className="mt-2 text-white/60 text-sm">
        Controls: ← → to move, SPACE/↑ to jump. Reach the orange exit together.
      </p>
    </main>
  );
}

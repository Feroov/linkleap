"use client";
export const dynamic = "force-dynamic";

import {
  use as useUnwrap,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { supabase } from "@/lib/supabase";
import { useRouter } from "next/navigation";

/* ========= Types ========= */
type Player = {
  id: "p1" | "p2";
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  color: "blue" | "orange";
  lives: number;
  invulnMs: number;
  name?: string;
};
type InputState = { left: boolean; right: boolean; jump: boolean; seq: number };
type NetInput = InputState & { from: "guest" | "host" };
type Tile = { x: number; y: number; w: number; h: number };
type Switch = {
  platform: Tile;
  padTop: Tile;
  color: "blue" | "orange";
  pressed: boolean;
};
type Gate = { rect: Tile; color: "blue" | "orange"; open: boolean };
type Enemy = {
  x: number;
  y: number;
  w: number;
  h: number;
  dir: 1 | -1;
  left: number;
  right: number;
  speed: number;
};
type Particle = { x: number; y: number; vx: number; vy: number; life: number };

type Snapshot = {
  t: number;
  p1: Player;
  p2: Player;
  gates: { open: boolean }[];
  switches: { pressed: boolean }[];
  enemies: Enemy[];
  particles: Particle[];
  gameOver?: boolean;
};

type Pose = {
  t: number;
  p: Pick<Player, "x" | "y" | "vx" | "vy" | "onGround" | "name"> & {
    id: "p1" | "p2";
  };
};

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
function aabb(a: Tile, b: Tile) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}

/* ========= Physics & View constants ========= */
const GRAV = 0.7,
  MOVE = 0.6,
  MAXVX = 3.2,
  JUMP = -10,
  FRICTION = 0.85,
  STEP_MS = 1000 / 60;
const STEP_UP = 6;
const HALF_W = 8,
  HALF_H = 10;

const VIEW_W = 960;
const MARGIN_L = 220,
  MARGIN_R = 260;

/* ========= Procedural level ========= */
function genLevel(seed: string) {
  const rnd = mulberry32(hashSeed(seed));
  const W = 80,
    H = 18,
    tile = 24;

  const tiles: Tile[] = [];
  const lava: Tile[] = [];

  let prevY = 10;
  for (let x = 2; x < W - 2; x += 3) {
    let y = 6 + Math.floor(rnd() * 8);
    const dy = y - prevY;
    if (dy > 3) y = prevY + 3;
    if (dy < -3) y = prevY - 3;
    prevY = y;

    const width = 2 + Math.floor(rnd() * 2);
    tiles.push({ x: x * tile, y: y * tile, w: width * tile, h: tile });
    if (dy > 2)
      tiles.push({
        x: (x - 1) * tile,
        y: (y + 1) * tile,
        w: 1 * tile,
        h: tile,
      });

    if (rnd() < 0.35)
      lava.push({
        x: x * tile,
        y: (H - 2) * tile,
        w: width * tile,
        h: 2 * tile,
      });
  }

  const start = { x: 1 * tile, y: 10 * tile, w: 3 * tile, h: tile };
  const finish = { x: (W - 6) * tile, y: 9 * tile, w: 3 * tile, h: tile };
  tiles.push(start, finish);

  for (let i = 0; i < 3; i++) {
    tiles.push({
      x: (W - 12 + i * 2) * tile,
      y: (11 - i) * tile,
      w: 2 * tile,
      h: tile,
    });
  }

  const pads: Switch[] = [
    {
      platform: { x: (W - 16) * tile, y: 11 * tile, w: 2 * tile, h: tile / 2 },
      padTop: { x: (W - 16) * tile, y: 11 * tile, w: 2 * tile, h: 6 },
      color: "blue",
      pressed: false,
    },
    {
      platform: { x: (W - 13) * tile, y: 11 * tile, w: 2 * tile, h: tile / 2 },
      padTop: { x: (W - 13) * tile, y: 11 * tile, w: 2 * tile, h: 6 },
      color: "orange",
      pressed: false,
    },
    {
      platform: { x: (W - 22) * tile, y: 8 * tile, w: 2 * tile, h: tile / 2 },
      padTop: { x: (W - 22) * tile, y: 8 * tile, w: 2 * tile, h: 6 },
      color: "blue",
      pressed: false,
    },
    {
      platform: { x: (W - 19) * tile, y: 8 * tile, w: 2 * tile, h: tile / 2 },
      padTop: { x: (W - 19) * tile, y: 8 * tile, w: 2 * tile, h: 6 },
      color: "orange",
      pressed: false,
    },
  ];
  for (const p of pads) tiles.push(p.platform);

  const gates: Gate[] = [
    {
      rect: { x: (W - 9) * tile, y: 6 * tile, w: 8, h: 5 * tile },
      color: "blue",
      open: false,
    },
    {
      rect: { x: (W - 8) * tile + 10, y: 6 * tile, w: 8, h: 5 * tile },
      color: "orange",
      open: false,
    },
    {
      rect: { x: (W - 27) * tile, y: 5 * tile, w: 8, h: 6 * tile },
      color: "blue",
      open: false,
    },
    {
      rect: { x: (W - 26) * tile + 10, y: 5 * tile, w: 8, h: 6 * tile },
      color: "orange",
      open: false,
    },
  ];

  const enemies: Enemy[] = [];
  for (let i = 0; i < 6; i++) {
    const baseX = 6 + Math.floor(rnd() * (W - 20));
    const yTile = 9 + Math.floor(rnd() * 6);
    enemies.push({
      x: baseX * tile,
      y: yTile * tile - 10,
      w: 16,
      h: 12,
      dir: rnd() < 0.5 ? 1 : -1,
      left: (baseX - 2) * tile,
      right: (baseX + 4) * tile,
      speed: 0.8 + rnd() * 0.8,
    });
  }

  const size = { pxWidth: W * tile, pxHeight: H * tile };
  return { tiles, start, finish, size, tile, pads, gates, enemies, lava };
}

/* ========= Component ========= */
export default function GamePage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = useUnwrap(params);
  const r = useRouter();

  const [seed, setSeed] = useState<string>("");
  const [isHost, setIsHost] = useState(false);
  const pendingNamesRef = useRef<{ blue?: string; orange?: string }>({});
  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  // world
  const level = useMemo(() => (seed ? genLevel(seed) : null), [seed]);

  const otherPrevRef = useRef<{ t: number; p: Player } | null>(null);
  const otherCurrRef = useRef<{ t: number; p: Player } | null>(null);

  // canvas + sim refs
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const reqRef = useRef<number | null>(null);

  // players
  const meColorRef = useRef<"blue" | "orange">("blue");
  const p1Ref = useRef<Player | null>(null);
  const p2Ref = useRef<Player | null>(null);

  // input
  const inputRef = useRef<InputState>({
    left: false,
    right: false,
    jump: false,
    seq: 0,
  });
  const lastGuestInputRef = useRef<InputState>({
    left: false,
    right: false,
    jump: false,
    seq: 0,
  });

  // camera, fx, smoothing targets
  const camXRef = useRef<number>(0);
  const particlesRef = useRef<Particle[]>([]);
  const targetP1Ref = useRef<Player | null>(null);
  const targetP2Ref = useRef<Player | null>(null);

  // game over
  const gameOverRef = useRef<boolean>(false);

  const lastLivesRef = useRef<{ p1: number; p2: number }>({ p1: 3, p2: 3 });
  const enemyPrevRef = useRef<{ t: number; enemies: Enemy[] } | null>(null);
  const enemyCurrRef = useRef<{ t: number; enemies: Enemy[] } | null>(null);
  const enemyInterpDelayMs = 100; // ~100ms delay for smooth interp on guest
  const sentGameOverRef = useRef<boolean>(false);
  const pingIntervalRef = useRef<number | null>(null);

  const interpDelayMsRef = useRef(60); // adaptive, starts ~60ms
  const rttMsRef = useRef(60);
  const lastSnapAtRef = useRef<number>(performance.now());
  const snapGapMsRef = useRef<number>(50);
  // my name from query (?n=)
  const myNameRef = useRef<string>("");

  /* ====== fetch seed + host flag + my name ====== */
  useEffect(() => {
    fetch(`/api/lobby?code=${code}`)
      .then((res) => (res.ok ? res.json() : null))
      .then((meta) => setSeed(meta?.seed || "fallback"))
      .catch(() => setSeed("fallback"));

    const qs =
      typeof window !== "undefined"
        ? new URLSearchParams(location.search)
        : null;
    setIsHost(qs?.get("host") === "1");
    myNameRef.current =
      qs?.get("n") || (qs?.get("host") === "1" ? "Blue" : "Orange");
  }, [code]);

  /* ====== realtime ====== */
  useEffect(() => {
    if (!seed) return;

    const ch = supabase.channel(`lobby:${code}`, {
      config: { broadcast: { self: false } },
    });
    chanRef.current = ch;

    ch.on(
      "broadcast",
      { event: "PING" },
      ({ payload }: { payload: { t: number } }) => {
        // host echoes back immediately
        if (isHost) {
          ch.send({
            type: "broadcast",
            event: "PONG",
            payload: { t: payload.t },
          });
        }
      }
    );
    ch.on(
      "broadcast",
      { event: "PONG" },
      ({ payload }: { payload: { t: number } }) => {
        if (!isHost) {
          const now = performance.now();
          const rtt = now - payload.t;
          rttMsRef.current = rtt;
          // target ≈ half RTT + recent pose gap, clamped
          const target = Math.max(
            30,
            Math.min(140, rtt * 0.5 + snapGapMsRef.current)
          );
          interpDelayMsRef.current = target;
        }
      }
    );

    // high-rate pose stream -> smooth "other player"
    ch.on("broadcast", { event: "POSE" }, ({ payload }: { payload: Pose }) => {
      if (isHost) return;

      // keep average inter-packet gap for adaptive delay
      const now = performance.now();
      const gap = now - lastSnapAtRef.current;
      snapGapMsRef.current = snapGapMsRef.current * 0.9 + gap * 0.1;
      lastSnapAtRef.current = now;

      const meIsBlue = meColorRef.current === "blue";
      const myOtherId = meIsBlue ? "p2" : "p1";
      if (payload.p.id !== myOtherId) return;

      const poseAsPlayer: Player = {
        ...(myOtherId === "p1"
          ? (p1Ref.current as Player)
          : (p2Ref.current as Player)),
        x: payload.p.x,
        y: payload.p.y,
        vx: payload.p.vx,
        vy: payload.p.vy,
        onGround: payload.p.onGround,
        name: payload.p.name,
      };

      const tNow = performance.now();
      if (otherCurrRef.current) {
        otherPrevRef.current = otherCurrRef.current;
        otherCurrRef.current = { t: tNow, p: poseAsPlayer };
      } else {
        otherPrevRef.current = { t: tNow, p: poseAsPlayer };
        otherCurrRef.current = { t: tNow, p: poseAsPlayer };
      }
    });

    meColorRef.current = isHost ? "blue" : "orange";

    // guest: authoritative snapshots -> targets
    ch.on(
      "broadcast",
      { event: "SNAP" },
      ({ payload }: { payload: Snapshot }) => {
        if (isHost) return;

        // store player targets
        targetP1Ref.current = payload.p1;
        targetP2Ref.current = payload.p2;

        /* === ADD THIS: advance other-player interpolation buffer on guest === */
        if (!isHost) {
          const meIsBlue = meColorRef.current === "blue";
          const otherFromSnap = meIsBlue ? payload.p2 : payload.p1;
          const nowT = performance.now();

          // shift the buffer (prev <- curr; curr <- new)
          if (otherCurrRef.current) {
            otherPrevRef.current = otherCurrRef.current;
            otherCurrRef.current = { t: nowT, p: { ...otherFromSnap } };
          } else {
            // first packet: seed both so we start from a stable state
            otherPrevRef.current = { t: nowT, p: { ...otherFromSnap } };
            otherCurrRef.current = { t: nowT, p: { ...otherFromSnap } };
          }
        }
        /* === END ADD === */

        // --- HARD RECONCILE ON LIFE DROP (snap to host respawn immediately)
        const lp = lastLivesRef.current;
        if (payload.p1.lives < lp.p1 && p1Ref.current) {
          Object.assign(p1Ref.current, payload.p1); // exact host state
        }
        if (payload.p2.lives < lp.p2 && p2Ref.current) {
          Object.assign(p2Ref.current, payload.p2);
        }
        lastLivesRef.current = { p1: payload.p1.lives, p2: payload.p2.lives };

        // gates/pads from host
        if (level) {
          level.gates.forEach((g, i) => (g.open = !!payload.gates[i]?.open));
          level.pads.forEach(
            (s, i) => (s.pressed = !!payload.switches[i]?.pressed)
          );
        }

        // ---- Enemy interpolation: shift buffer
        enemyPrevRef.current = enemyCurrRef.current;
        enemyCurrRef.current = {
          t: performance.now(),
          enemies: payload.enemies.map((e) => ({ ...e })),
        };

        // particles (you can also skip this on guest to reduce noise)
        particlesRef.current = payload.particles.map((p) => ({ ...p }));

        if (payload.gameOver) gameOverRef.current = true;
      }
    );

    // host receives guest inputs
    ch.on(
      "broadcast",
      { event: "INPUT" },
      ({ payload }: { payload: NetInput }) => {
        if (!isHost) return;
        if (payload.from === "guest") lastGuestInputRef.current = payload;
      }
    );

    // share names so tags show
    ch.on(
      "broadcast",
      { event: "MYNAME" },
      ({
        payload,
      }: {
        payload: { color: "blue" | "orange"; name: string };
      }) => {
        const { color, name } = payload;
        const p = color === "blue" ? p1Ref.current : p2Ref.current;
        if (p) {
          p.name = name;
        } else {
          pendingNamesRef.current[color] = name; // apply after spawn
        }
      }
    );

    // instant gameover propagation (not just in SNAP)
    ch.on("broadcast", { event: "GAMEOVER" }, () => {
      gameOverRef.current = true;
    });

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({
          type: "broadcast",
          event: "MYNAME",
          payload: { color: meColorRef.current, name: myNameRef.current },
        });
        if (!isHost) {
          const ping = () =>
            ch.send({
              type: "broadcast",
              event: "PING",
              payload: { t: performance.now() },
            });
          ping();
          const id = window.setInterval(ping, 500); // returns number in the browser
          pingIntervalRef.current = id;
        }
        // fire a couple of quick repeats to beat races
        setTimeout(() => {
          ch.send({
            type: "broadcast",
            event: "MYNAME",
            payload: { color: meColorRef.current, name: myNameRef.current },
          });
        }, 300);
        setTimeout(() => {
          ch.send({
            type: "broadcast",
            event: "MYNAME",
            payload: { color: meColorRef.current, name: myNameRef.current },
          });
        }, 1000);
      }
    });

    return () => {
      ch.unsubscribe();
      const id = pingIntervalRef.current;
      if (id !== null) {
        clearInterval(id);
        pingIntervalRef.current = null;
      }
    };
  }, [code, seed, isHost, level]);

  /* ====== keyboard ====== */
  useEffect(() => {
    const on = (e: KeyboardEvent, down: boolean) => {
      if (
        ["ArrowLeft", "ArrowRight", " ", "ArrowUp", "w", "a", "d"].includes(
          e.key
        )
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

  /* ====== helpers ====== */
  const spawnPlayers = useCallback(() => {
    if (!level) return;
    p1Ref.current = {
      id: "p1",
      x: level.start.x + 18,
      y: level.start.y - HALF_H,
      vx: 0,
      vy: 0,
      onGround: true,
      color: "blue",
      lives: 3,
      invulnMs: 0,
      name: meColorRef.current === "blue" ? myNameRef.current : "Blue",
    };
    p2Ref.current = {
      id: "p2",
      x: level.start.x + 56,
      y: level.start.y - HALF_H,
      vx: 0,
      vy: 0,
      onGround: true,
      color: "orange",
      lives: 3,
      invulnMs: 0,
      name: meColorRef.current === "orange" ? myNameRef.current : "Orange",
    };
    // initialize smoothing targets so guest has something to lerp to immediately
    targetP1Ref.current = { ...(p1Ref.current as Player) };
    targetP2Ref.current = { ...(p2Ref.current as Player) };
    const pn = pendingNamesRef.current;
    if (pn.blue && p1Ref.current) p1Ref.current.name = pn.blue;
    if (pn.orange && p2Ref.current) p2Ref.current.name = pn.orange;
    // seed guest-side interpolation buffers with the "other" player's current pose
    if (!isHost) {
      const otherLocal =
        meColorRef.current === "blue"
          ? (p2Ref.current as Player)
          : (p1Ref.current as Player);
      const t = performance.now();
      otherPrevRef.current = { t, p: { ...otherLocal } };
      otherCurrRef.current = { t, p: { ...otherLocal } };
    }
  }, [level]);

  function damage(p: Player, other: Player) {
    if (p.invulnMs > 0) return;
    p.lives = Math.max(0, p.lives - 1);
    p.invulnMs = 1200;
    if (isHost && (p1Ref.current!.lives <= 0 || p2Ref.current!.lives <= 0))
      gameOverRef.current = true;

    if (level) {
      const targetX = other.x;
      let best: Tile | null = null,
        bestScore = Infinity;
      for (const t of level.tiles) {
        const cx = t.x + t.w / 2,
          dx = Math.abs(cx - targetX),
          dy = Math.abs(t.y - other.y);
        const s = dx + dy * 0.5;
        if (s < bestScore) {
          bestScore = s;
          best = t;
        }
      }
      if (best) {
        p.x = clamp(best.x + best.w / 2, HALF_W, level.size.pxWidth - HALF_W);
        p.y = best.y - HALF_H;
        p.vx = 0;
        p.vy = 0;
        for (let i = 0; i < 18; i++)
          particlesRef.current.push({
            x: p.x,
            y: p.y,
            vx: (Math.random() - 0.5) * 3,
            vy: -1.5 - Math.random() * 1.5,
            life: 700 + Math.random() * 400,
          });
      }
    }
  }

  const integrate = useCallback(
    (
      p: Player,
      inp: InputState,
      opts?: { hazards?: boolean; pads?: boolean }
    ) => {
      const hazards = opts?.hazards ?? true; // host true, guest false
      const pads = opts?.pads ?? true; // host true, guest false
      if (!level) return;
      if (p.invulnMs > 0) p.invulnMs = Math.max(0, p.invulnMs - STEP_MS);

      // movement
      if (inp.left) p.vx -= MOVE;
      if (inp.right) p.vx += MOVE;
      p.vx = clamp(p.vx, -MAXVX, MAXVX);
      if (inp.jump && p.onGround) {
        p.vy = JUMP;
        p.onGround = false;
      }
      p.vy += GRAV;

      let x = p.x + p.vx;
      let y = p.y + p.vy;

      // colliders: tiles + closed gates + pads' platforms
      const colliders: Tile[] = [
        ...level.tiles,
        ...level.pads.map((s) => s.platform),
        ...level.gates.filter((g) => !g.open).map((g) => g.rect),
      ];

      // vertical resolve
      p.onGround = false;
      const vbox: Tile = {
        x: x - HALF_W,
        y: y - HALF_H,
        w: HALF_W * 2,
        h: HALF_H * 2,
      };
      for (const t of colliders) {
        if (!aabb(vbox, t)) continue;
        if (p.vy > 0 && p.y - HALF_H <= t.y) {
          y = t.y - HALF_H;
          p.vy = 0;
          p.onGround = true;
        } else if (p.vy < 0 && p.y + HALF_H >= t.y + t.h) {
          y = t.y + t.h + HALF_H;
          p.vy = 0;
        }
      }

      // horizontal + small step-up
      let hbox: Tile = {
        x: x - HALF_W,
        y: y - HALF_H,
        w: HALF_W * 2,
        h: HALF_H * 2,
      };
      for (const t of colliders) {
        if (!aabb(hbox, t)) continue;
        const movingRight = p.vx > 0;
        const touchingSide = movingRight
          ? p.x - HALF_W <= t.x
          : p.x + HALF_W >= t.x + t.w;
        if (touchingSide) {
          let stepped = false;
          for (let dy = 1; dy <= STEP_UP; dy++) {
            const test: Tile = {
              x: x - HALF_W,
              y: y - HALF_H - dy,
              w: HALF_W * 2,
              h: HALF_H * 2,
            };
            if (!colliders.some((c) => aabb(test, c))) {
              y -= dy;
              x = movingRight ? t.x - HALF_W : t.x + t.w + HALF_W;
              stepped = true;
              break;
            }
          }
          if (!stepped) {
            x = movingRight ? t.x - HALF_W : t.x + t.w + HALF_W;
            p.vx = 0;
          }
          hbox = { x: x - HALF_W, y: y - HALF_H, w: HALF_W * 2, h: HALF_H * 2 };
        }
      }

      // bounds
      p.x = clamp(x, HALF_W, level.size.pxWidth - HALF_W);
      p.y = y;
      if (p.onGround) p.vx *= FRICTION;

      // pads: host-only
      if (pads) {
        for (const sw of level.pads) {
          const feet: Tile = {
            x: p.x - HALF_W,
            y: p.y + HALF_H - 2,
            w: HALF_W * 2,
            h: 4,
          };
          if (aabb(feet, sw.padTop) && p.color === sw.color) sw.pressed = true;
        }
      }

      // hazards: host-only
      if (hazards) {
        // void fall
        if (p.y > level.size.pxHeight + 50) {
          const other =
            p.id === "p1"
              ? (p2Ref.current as Player)
              : (p1Ref.current as Player);
          damage(p, other);
        }
        // lava
        for (const l of level.lava) {
          const box: Tile = {
            x: p.x - HALF_W,
            y: p.y - HALF_H,
            w: HALF_W * 2,
            h: HALF_H * 2,
          };
          if (aabb(box, l)) {
            const other =
              p.id === "p1"
                ? (p2Ref.current as Player)
                : (p1Ref.current as Player);
            damage(p, other);
            break;
          }
        }
      }
    },
    [level]
  );

  /* ====== main loop ====== */
  useEffect(() => {
    if (!level) return;

    const c = canvasRef.current;
    if (!c) return;
    c.width = VIEW_W;
    c.height = level.size.pxHeight;

    // cache 2d ctx once
    const ctx = c.getContext("2d");
    if (!ctx) return;

    // reset world
    spawnPlayers();
    level.gates.forEach((g) => (g.open = false));
    level.pads.forEach((s) => (s.pressed = false));
    camXRef.current = 0;
    particlesRef.current = [];
    gameOverRef.current = false;

    // host: send an initial state so guest has names/state immediately
    // host: send an initial state so guest has names/state immediately
    if (isHost && chanRef.current) {
      const firstSnap: Snapshot = {
        t: Date.now(),
        p1: p1Ref.current as Player,
        p2: p2Ref.current as Player,
        gates: level.gates.map((g) => ({ open: g.open })),
        switches: level.pads.map((s) => ({ pressed: s.pressed })),
        enemies: level.enemies.map((e) => ({ ...e })),
        particles: [],
        gameOver: false,
      };
      chanRef.current.send({
        type: "broadcast",
        event: "SNAP",
        payload: firstSnap,
      });

      // initialize guest-side interpolation / reconciliation baselines
      const nowT = performance.now();
      enemyPrevRef.current = {
        t: nowT,
        enemies: level.enemies.map((e) => ({ ...e })),
      };
      enemyCurrRef.current = {
        t: nowT,
        enemies: level.enemies.map((e) => ({ ...e })),
      };
      lastLivesRef.current = {
        p1: (p1Ref.current as Player).lives,
        p2: (p2Ref.current as Player).lives,
      };
      sentGameOverRef.current = false;
    }

    let acc = 0;
    let last = performance.now();
    let inputTimer = 0; // for INPUT @ ~60Hz (16ms below)
    let snapTimer = 0; // for SNAP  @ ~12–20Hz
    let poseTimer = 0; // for POSE  @ ~60Hz

    const drawFrame = () => {
      if (!canvasRef.current) return;

      const lvl = level!;
      ctx.clearRect(0, 0, c.width, c.height);
      ctx.save();
      ctx.translate(-Math.floor(camXRef.current), 0);

      // bg
      ctx.fillStyle = "#0b1125";
      ctx.fillRect(camXRef.current, 0, c.width, c.height);

      // tiles
      ctx.fillStyle = "#1d2440";
      for (const t of lvl.tiles) ctx.fillRect(t.x, t.y, t.w, t.h);

      // lava
      ctx.fillStyle = "#a6242b";
      for (const l of lvl.lava) ctx.fillRect(l.x, l.y, l.w, l.h);

      // gates
      for (const g of lvl.gates) {
        ctx.fillStyle = g.color === "blue" ? "#6c85ff" : "#ffb23f";
        ctx.globalAlpha = g.open ? 0.18 : 0.9;
        ctx.fillRect(g.rect.x, g.rect.y, g.rect.w, g.rect.h);
        ctx.globalAlpha = 1;
      }

      // pads
      for (const s of lvl.pads) {
        ctx.fillStyle = s.color === "blue" ? "#7c9cff" : "#ff9e57";
        ctx.globalAlpha = s.pressed ? 1 : 0.65;
        ctx.fillRect(s.padTop.x, s.padTop.y, s.padTop.w, s.padTop.h);
        ctx.globalAlpha = 1;
      }

      // finish
      ctx.fillStyle = "rgba(73,242,194,.2)";
      ctx.fillRect(lvl.finish.x, lvl.finish.y, lvl.finish.w, lvl.finish.h);

      // enemies
      // enemies
      ctx.fillStyle = "#ffd84d";
      if (isHost) {
        // host draws current state
        for (const e of level.enemies) ctx.fillRect(e.x, e.y, e.w, e.h);
      } else {
        // guest draws interpolated between the last two snapshots with a tiny delay
        const prev = enemyPrevRef.current;
        const curr = enemyCurrRef.current;
        const now = performance.now();
        if (prev && curr) {
          // render time is slightly behind to avoid extrapolation
          const renderT = now - enemyInterpDelayMs;
          const span = Math.max(1, curr.t - prev.t);
          const t = clamp((renderT - prev.t) / span, 0, 1);

          const a = prev.enemies;
          const b = curr.enemies;
          const n = Math.min(a.length, b.length);
          for (let i = 0; i < n; i++) {
            const ex = a[i].x + (b[i].x - a[i].x) * t;
            const ey = a[i].y + (b[i].y - a[i].y) * t;
            ctx.fillRect(ex, ey, b[i].w, b[i].h);
          }
        } else {
          // fall back to latest if buffer incomplete
          const src = enemyCurrRef.current?.enemies ?? [];
          for (const e of src) ctx.fillRect(e.x, e.y, e.w, e.h);
        }
      }

      // particles
      ctx.fillStyle = "#49f2c2";
      for (const p of particlesRef.current) ctx.fillRect(p.x, p.y, 2, 2);

      // players + name tags
      const drawP = (p: Player) => {
        ctx.fillStyle = p.color === "blue" ? "#7c9cff" : "#ff9e57";
        if (p.invulnMs > 0)
          ctx.globalAlpha = 0.5 + 0.5 * Math.sin((p.invulnMs / 60) * Math.PI);
        ctx.fillRect(p.x - HALF_W, p.y - HALF_H, HALF_W * 2, HALF_H * 2);
        ctx.globalAlpha = 1;

        ctx.font =
          "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
        ctx.textAlign = "center";
        ctx.fillStyle = "white";
        ctx.globalAlpha = 0.9;
        ctx.fillText(
          p.name || (p.color === "blue" ? "Blue" : "Orange"),
          p.x,
          p.y - HALF_H - 6
        );
        ctx.globalAlpha = 1;
      };
      drawP(p1Ref.current as Player);
      drawP(p2Ref.current as Player);

      ctx.restore();

      // HUD hearts
      const heart = (x: number, y: number, n: number, color: string) => {
        ctx.fillStyle = color;
        for (let i = 0; i < n; i++) {
          ctx.beginPath();
          const px = x + i * 18;
          ctx.moveTo(px + 6, y + 12);
          ctx.bezierCurveTo(px - 6, y + 2, px, y - 2, px + 6, y + 4);
          ctx.bezierCurveTo(px + 12, y - 2, px + 18, y + 2, px + 6, y + 12);
          ctx.fill();
        }
      };
      heart(12, 10, (p1Ref.current as Player).lives, "#7c9cff");
      heart(
        VIEW_W - 12 - 18 * (p2Ref.current as Player).lives,
        10,
        (p2Ref.current as Player).lives,
        "#ff9e57"
      );

      // Game Over overlay
      if (gameOverRef.current) {
        ctx.fillStyle = "rgba(0,0,0,0.6)";
        ctx.fillRect(0, 0, VIEW_W, c.height);
        ctx.fillStyle = "#fff";
        ctx.font = "28px ui-sans-serif, system-ui";
        ctx.textAlign = "center";
        ctx.fillText("Game Over", VIEW_W / 2, 120);
        ctx.font = "16px ui-sans-serif, system-ui";
        ctx.fillText("A player has run out of hearts.", VIEW_W / 2, 150);

        const btnW = 200,
          btnH = 40,
          bx = VIEW_W / 2 - btnW / 2,
          by = 190;
        ctx.fillStyle = "#49f2c2";
        ctx.fillRect(bx, by, btnW, btnH);
        ctx.fillStyle = "#0b1020";
        ctx.font = "16px ui-sans-serif, system-ui";
        ctx.fillText("Back to Main", VIEW_W / 2, by + 26);

        const canvas = canvasRef.current;
        if (canvas) {
          canvas.onclick = (ev) => {
            const rect = canvas.getBoundingClientRect();
            const x = ev.clientX - rect.left,
              y = ev.clientY - rect.top;
            if (x >= bx && x <= bx + btnW && y >= by && y <= by + btnH)
              r.push("/");
          };
        }
      }
    };

    const loop = (now: number) => {
      if (!canvasRef.current) return; // unmounted

      if (gameOverRef.current) {
        drawFrame();
        reqRef.current = requestAnimationFrame(loop);
        return;
      }

      const dt = now - last;
      acc += dt;
      inputTimer += dt;
      snapTimer += dt;
      poseTimer += dt;

      last = now;

      // host recomputes pads each step
      if (isHost) level.pads.forEach((s) => (s.pressed = false));

      // send input ~30Hz
      if (inputTimer >= 16) {
        const payload: NetInput = {
          ...inputRef.current,
          from: isHost ? "host" : "guest",
        };
        chanRef.current?.send({ type: "broadcast", event: "INPUT", payload });
        inputTimer = 0;
      }

      if (isHost) {
        // ===== HOST: full simulation =====
        while (acc >= STEP_MS) {
          // integrate using correct inputs for each player
          const p1In =
            meColorRef.current === "blue"
              ? inputRef.current
              : lastGuestInputRef.current;
          const p2In =
            meColorRef.current === "orange"
              ? inputRef.current
              : lastGuestInputRef.current;
          integrate(p1Ref.current as Player, p1In);
          integrate(p2Ref.current as Player, p2In);

          // enemies
          for (const e of level.enemies) {
            e.x += e.dir * e.speed;
            if (e.x < e.left) {
              e.x = e.left;
              e.dir = 1;
            } else if (e.x + e.w > e.right) {
              e.x = e.right - e.w;
              e.dir = -1;
            }
            const hitBox: Tile = { x: e.x, y: e.y, w: e.w, h: e.h };
            for (const p of [
              p1Ref.current as Player,
              p2Ref.current as Player,
            ]) {
              const pb: Tile = {
                x: p.x - HALF_W,
                y: p.y - HALF_H,
                w: HALF_W * 2,
                h: HALF_H * 2,
              };
              if (aabb(hitBox, pb)) {
                const other =
                  p.id === "p1"
                    ? (p2Ref.current as Player)
                    : (p1Ref.current as Player);
                damage(p, other);
              }
            }
          }
          // gates
          for (const g of level.gates) {
            const match = level.pads.find((p) => p.color === g.color);
            g.open = !!match?.pressed;
          }

          if (p1Ref.current!.lives <= 0 || p2Ref.current!.lives <= 0) {
            gameOverRef.current = true;
            if (!sentGameOverRef.current) {
              sentGameOverRef.current = true;
              chanRef.current?.send({
                type: "broadcast",
                event: "GAMEOVER",
                payload: {},
              });
            }
          }

          // particles
          particlesRef.current = particlesRef.current
            .map((pt) => ({
              ...pt,
              x: pt.x + pt.vx,
              y: pt.y + pt.vy,
              vy: pt.vy + 0.04,
              life: pt.life - STEP_MS,
            }))
            .filter((pt) => pt.life > 0);

          acc -= STEP_MS;
        }

        // broadcast ~20Hz
        if (snapTimer >= 80) {
          const snap: Snapshot = {
            t: Date.now(),
            p1: p1Ref.current as Player,
            p2: p2Ref.current as Player,
            gates: level.gates.map((g) => ({ open: g.open })),
            switches: level.pads.map((s) => ({ pressed: s.pressed })),
            enemies: level.enemies.map((e) => ({ ...e })),
            particles: particlesRef.current.map((p) => ({ ...p })),
            gameOver: gameOverRef.current,
          };
          chanRef.current?.send({
            type: "broadcast",
            event: "SNAP",
            payload: snap,
          });

          // optional: redundant GAMEOVER to cover packet loss
          if (gameOverRef.current) {
            chanRef.current?.send({
              type: "broadcast",
              event: "GAMEOVER",
              payload: {},
            });
          }

          snapTimer = 0;
        }
      } else {
        while (acc >= STEP_MS) {
          const meIsP1 = meColorRef.current === "blue";
          const me = meIsP1
            ? (p1Ref.current as Player)
            : (p2Ref.current as Player);
          const them = meIsP1
            ? (p2Ref.current as Player)
            : (p1Ref.current as Player);

          // 1) Predict myself locally (no hazards/pads on guest)
          integrate(me, inputRef.current, { hazards: false, pads: false });

          // 1.5) Reconcile myself toward host target to kill divergence
          const myTgt = meIsP1 ? targetP1Ref.current : targetP2Ref.current;
          if (myTgt) {
            const dx = myTgt.x - me.x;
            const dy = myTgt.y - me.y;
            const dist2 = dx * dx + dy * dy;

            // if way off (e.g., host resolved a collision I didn't): snap
            if (dist2 > 24 * 24) {
              Object.assign(me, {
                x: myTgt.x,
                y: myTgt.y,
                vx: myTgt.vx,
                vy: myTgt.vy,
                onGround: myTgt.onGround,
                lives: myTgt.lives,
                invulnMs: myTgt.invulnMs,
                name: myTgt.name,
              });
            } else {
              // otherwise gently steer (keeps it responsive but convergent)
              const kSelf = 0.12;
              me.x += dx * kSelf;
              me.y += dy * kSelf;
              me.vx = myTgt.vx;
              me.vy = myTgt.vy;
              me.onGround = myTgt.onGround;
              me.lives = myTgt.lives;
              me.invulnMs = myTgt.invulnMs;
              me.name = myTgt.name;
            }
          }

          // 2) Smooth other player using buffered interpolation (no spring jitter)
          const op = otherPrevRef.current;
          const oc = otherCurrRef.current;
          if (op && oc) {
            const renderT = performance.now() - interpDelayMsRef.current;
            const span = Math.max(1, oc.t - op.t);
            const t = clamp((renderT - op.t) / span, 0, 1);

            // interpolate position; take latest non-pos fields from current
            const a = op.p,
              b = oc.p;
            let ix = a.x + (b.x - a.x) * t;
            let iy = a.y + (b.y - a.y) * t;
            // tiny dead-reckoning to counter residual trail (≈1 frame at 60Hz)
            const EXTRAP_MS = 16;
            const k = EXTRAP_MS / STEP_MS; // STEP_MS is 1000/60
            ix += b.vx * k;
            iy += b.vy * k;
            them.x = ix;
            them.y = iy;

            // optional: lightly blend velocity to match host feel
            them.vx = b.vx;
            them.vy = b.vy;
            them.onGround = b.onGround;
            them.lives = b.lives;
            them.invulnMs = b.invulnMs;
            them.name = b.name;
          } else {
            // fallback to latest known target if buffer not ready
            const fallback = meIsP1 ? targetP2Ref.current : targetP1Ref.current;
            if (fallback) {
              them.x = fallback.x;
              them.y = fallback.y;
              them.vx = fallback.vx;
              them.vy = fallback.vy;
              them.onGround = fallback.onGround;
              them.lives = fallback.lives;
              them.invulnMs = fallback.invulnMs;
              them.name = fallback.name;
            }
          }

          acc -= STEP_MS;
        }
      }
      // stream minimal poses at ~60Hz (keeps guest "other player" 1:1 smooth)
      // host streams minimal poses at ~60Hz (keeps guest "other player" smooth)
      if (isHost && poseTimer >= 16 && chanRef.current) {
        const p1 = p1Ref.current as Player;
        const p2 = p2Ref.current as Player;

        const pose1: Pose = {
          t: Date.now(),
          p: {
            id: "p1",
            x: p1.x,
            y: p1.y,
            vx: p1.vx,
            vy: p1.vy,
            onGround: p1.onGround,
            name: p1.name,
          },
        };
        const pose2: Pose = {
          t: Date.now(),
          p: {
            id: "p2",
            x: p2.x,
            y: p2.y,
            vx: p2.vx,
            vy: p2.vy,
            onGround: p2.onGround,
            name: p2.name,
          },
        };

        chanRef.current.send({
          type: "broadcast",
          event: "POSE",
          payload: pose1,
        });
        chanRef.current.send({
          type: "broadcast",
          event: "POSE",
          payload: pose2,
        });

        poseTimer = 0;
      }

      // camera keeps both visible
      const p1 = p1Ref.current as Player,
        p2 = p2Ref.current as Player;
      const minX = Math.min(p1.x, p2.x),
        maxX = Math.max(p1.x, p2.x);
      let cam = camXRef.current;
      const leftBound = cam + MARGIN_L,
        rightBound = cam + VIEW_W - MARGIN_R;
      if (minX < leftBound) cam -= leftBound - minX;
      if (maxX > rightBound) cam += maxX - rightBound;
      cam = clamp(cam, 0, level.size.pxWidth - VIEW_W);
      camXRef.current += (cam - camXRef.current) * 0.18;

      drawFrame();
      reqRef.current = requestAnimationFrame(loop);
    };

    reqRef.current = requestAnimationFrame(loop);
    return () => {
      if (reqRef.current) cancelAnimationFrame(reqRef.current);
    };
  }, [level, isHost, integrate, spawnPlayers, r]);

  if (!seed || !level) return <main className="pt-8">Loading…</main>;

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
        Reach the exit together. Stand on your color pads to open matching
        gates. Avoid <span style={{ color: "#a6242b" }}>lava</span> and
        <span style={{ color: "#ffd84d" }}> bots</span>. Falling costs a heart;
        you’ll respawn near your partner.
      </p>
    </main>
  );
}
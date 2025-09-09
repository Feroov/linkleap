"use client";
export const dynamic = "force-dynamic";

import { use as useUnwrap, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

type Role = "host" | "guest";
type Color = "blue" | "orange";
type Input = { left: boolean; right: boolean; jump: boolean };
type Tile = { x: number; y: number; w: number; h: number };
type Level = {
  platforms: Tile[];
  spawn: Tile;
  goal: Tile;
  size: { w: number; h: number };
};

type Player = {
  id: "p1" | "p2";
  color: Color;
  name: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  onGround: boolean;
  hp: number;
  invulnMs: number;
};

type StatePacket = {
  t: number;
  p1: Player;
  p2: Player;
  win: boolean;
};

type InputPacket = {
  from: Role;
  color: Color;
  input: Input;
  seq: number;
};

type ChatPacket = {
  t: number;
  from: { name: string; color: Color };
  text: string;
};

type PongPacket = {
  pingClientAt: number;
  pongHostAt: number;
};

type TypingPacket = {
  t: number;
  from: { name: string; color: Color };
};

const VIEW_W = 960;
const VIEW_H = 540;
const HALF_W = 12;
const HALF_H = 16;

const MOVE = 0.45;
const MAX_VX = 2.6;
const JUMP_VY = -7.5;
const GRAV = 0.6;
const FRICTION = 0.82;
const STEP_MS = 1000 / 60;

const START_HP = 5;
const INVULN_AFTER_DEATH_MS = 1000;
const VOID_FALL_BUFFER = 60;

const SPAWN_COLOR = "#60a5fa";
const GOAL_COLOR = "#22c55e";
const PLATFORM_COLOR = "#1f2937";

const GUEST_KEEPALIVE_MS = 100;
const HOST_INPUT_STALE_MS = 400;

const EXTRAPOLATE_CAP_MS = 50;
const PING_INTERVAL_MS = 800;

const CAM_MARGIN_L = 260;
const CAM_MARGIN_R = 320;

function clamp(v: number, a: number, b: number) {
  return Math.max(a, Math.min(b, v));
}
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
function aabb(a: Tile, b: Tile) {
  return (
    a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y
  );
}
function feetBox(p: Player): Tile {
  return { x: p.x - HALF_W, y: p.y + HALF_H - 2, w: HALF_W * 2, h: 6 };
}
function hashSeed(s: string) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
function mulberry32(seed: number) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r ^= r + Math.imul(r ^ (r >>> 7), 61 | r);
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}
function genLevel(seedStr: string): Level {
  const rnd = mulberry32(hashSeed(seedStr || "fallback"));
  const WORLD_W = 3600;
  const groundY = 400;
  const spawn: Tile = { x: 80, y: groundY - 12, w: 120, h: 12 };
  const platforms: Tile[] = [
    { x: 0, y: groundY, w: WORLD_W, h: VIEW_H - groundY },
  ];
  let x = 220;
  while (x < WORLD_W - 480) {
    const span = 160 + Math.floor(rnd() * 180);
    const pw = 120 + Math.floor(rnd() * 160);
    const py = 230 + Math.floor(rnd() * 120);
    platforms.push({ x, y: py, w: pw, h: 12 });
    if (rnd() < 0.55) {
      const dy = -40 - Math.floor(rnd() * 50);
      const py2 = clamp(py + dy, 180, groundY - 40);
      platforms.push({
        x: x + 80,
        y: py2,
        w: 100 + Math.floor(rnd() * 120),
        h: 12,
      });
    }
    x += span;
  }
  const goalX = WORLD_W - 220;
  const goal: Tile = { x: goalX, y: groundY - 12, w: 160, h: 12 };
  return { platforms, spawn, goal, size: { w: WORLD_W, h: VIEW_H } };
}

export default function Page({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = useUnwrap(params);
  const r = useRouter();

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const ctxRef = useRef<CanvasRenderingContext2D | null>(null);

  const chanRef = useRef<ReturnType<typeof supabase.channel> | null>(null);

  const roleRef = useRef<Role>("guest");
  const myColorRef = useRef<Color>("orange");
  const myNameRef = useRef<string>("Player");

  const inputRef = useRef<Input>({ left: false, right: false, jump: false });
  const inputSeqRef = useRef<number>(0);
  const keepAliveTimerRef = useRef<number | null>(null);

  const p1Ref = useRef<Player | null>(null);
  const p2Ref = useRef<Player | null>(null);

  const stPrevRef = useRef<(StatePacket & { hostT: number }) | null>(null);
  const stCurrRef = useRef<(StatePacket & { hostT: number }) | null>(null);
  const latestStateRef = useRef<StatePacket | null>(null);

  const lastGuestInputAtRef = useRef<number>(performance.now());

  const hostOffsetRef = useRef<number>(0);
  const ewmaGapRef = useRef<number>(16);
  const ewmaJitterRef = useRef<number>(2);
  const renderDelayRef = useRef<number>(36);
  const pingIntervalIdRef = useRef<number | null>(null);

  const levelRef = useRef<Level | null>(null);
  const winRef = useRef<boolean>(false);

  const camXRef = useRef<number>(0);
  const [chat, setChat] = useState<ChatPacket[]>([]);
  const chatInputRef = useRef<HTMLInputElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  const startedRef = useRef<boolean>(false);
  const lastKnownNamesRef = useRef<{ blue?: string; orange?: string }>({});

  const [typing, setTyping] = useState<Record<string, number>>({});
  const typingDebounceRef = useRef<number | null>(null);

  const [ctxReady, setCtxReady] = useState(false);
  const [levelReady, setLevelReady] = useState(false);

  useEffect(() => {
    const qs =
      typeof window !== "undefined"
        ? new URLSearchParams(window.location.search)
        : null;
    const isHost = qs?.get("host") === "1";
    roleRef.current = isHost ? "host" : "guest";
    myNameRef.current =
      qs?.get("n") || (isHost ? "Blue Player" : "Orange Player");
    myColorRef.current = isHost ? "blue" : "orange";
  }, []);

  useEffect(() => {
    levelRef.current = genLevel(code);
    setLevelReady(true); // ✅ signal ready
  }, [code]);

  useEffect(() => {
    const box = chatScrollRef.current;
    if (box) box.scrollTop = box.scrollHeight;
  }, [chat]);

  useEffect(() => {
    const c = canvasRef.current;
    if (!c) return;
    c.width = VIEW_W;
    c.height = VIEW_H;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctxRef.current = ctx;
    setCtxReady(true);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      setTyping((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const [k, until] of Object.entries(prev)) {
          if (until <= now) {
            delete next[k];
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    }, 500);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    const ch = supabase.channel(`plane:${code}`, {
      config: { broadcast: { self: false } },
    });
    chanRef.current = ch;

    ch.on(
      "broadcast",
      { event: "STATE" },
      ({ payload }: { payload: StatePacket }) => {
        if (roleRef.current !== "guest") return;
        const hostT = payload.t;
        const pkt = { ...payload, hostT };
        const prev = stCurrRef.current;
        if (prev) {
          const gap = Math.max(1, pkt.hostT - prev.hostT);
          ewmaGapRef.current = ewmaGapRef.current * 0.9 + gap * 0.1;
          const diff = gap - ewmaGapRef.current;
          ewmaJitterRef.current =
            ewmaJitterRef.current * 0.9 + Math.abs(diff) * 0.1;
          const targetDelay = clamp(
            ewmaGapRef.current * 0.5 + ewmaJitterRef.current * 1.5,
            24,
            80
          );
          renderDelayRef.current =
            renderDelayRef.current * 0.85 + targetDelay * 0.15;
        }
        if (stCurrRef.current) stPrevRef.current = stCurrRef.current;
        stCurrRef.current = pkt;
        latestStateRef.current = payload;
      }
    );

    ch.on(
      "broadcast",
      { event: "NAME_SYNC" },
      ({
        payload,
      }: {
        payload: { t: number; blue: string; orange: string };
      }) => {
        // Update caches + live objects if they exist
        lastKnownNamesRef.current.blue = payload.blue;
        lastKnownNamesRef.current.orange = payload.orange;

        if (p1Ref.current) p1Ref.current.name = payload.blue;
        if (p2Ref.current) p2Ref.current.name = payload.orange;
      }
    );

    ch.on(
      "broadcast",
      { event: "INPUT" },
      ({ payload }: { payload: InputPacket }) => {
        if (roleRef.current !== "host") return;
        if (payload.color === "orange" && p2Ref.current) {
          inputGuestRef.current = payload.input;
          lastGuestInputAtRef.current = performance.now();
        }
      }
    );

    ch.on(
      "broadcast",
      { event: "HELLO" },
      ({
        payload,
      }: {
        payload: { color: Color; name: string; role: Role };
      }) => {
        if (roleRef.current !== "host") return;

        if (payload.color === "blue") {
          if (p1Ref.current) p1Ref.current.name = payload.name;
          lastKnownNamesRef.current.blue = payload.name;
        }
        if (payload.color === "orange") {
          if (p2Ref.current) p2Ref.current.name = payload.name;
          lastKnownNamesRef.current.orange = payload.name;
        }

        // Tell everyone the authoritative names (covers late joins / re-syncs)
        chanRef.current?.send({
          type: "broadcast",
          event: "NAME_SYNC",
          payload: {
            t: Date.now(),
            blue:
              p1Ref.current?.name ??
              lastKnownNamesRef.current.blue ??
              "Blue Player",
            orange:
              p2Ref.current?.name ??
              lastKnownNamesRef.current.orange ??
              "Guest",
          },
        });
      }
    );

    ch.on(
      "broadcast",
      { event: "PING" },
      ({ payload }: { payload: { pingClientAt: number } }) => {
        if (roleRef.current !== "host") return;
        ch.send({
          type: "broadcast",
          event: "PONG",
          payload: {
            pingClientAt: payload.pingClientAt,
            pongHostAt: Date.now(),
          } as PongPacket,
        });
      }
    );

    ch.on(
      "broadcast",
      { event: "PONG" },
      ({ payload }: { payload: PongPacket }) => {
        if (roleRef.current !== "guest") return;
        const now = Date.now();
        const rtt = now - payload.pingClientAt;
        const oneWay = rtt * 0.5;
        const offset = payload.pongHostAt + oneWay - now;
        hostOffsetRef.current = hostOffsetRef.current * 0.9 + offset * 0.1;
      }
    );

    ch.on(
      "broadcast",
      { event: "CHAT" },
      ({ payload }: { payload: ChatPacket }) => {
        setChat((prev) => [...prev.slice(-49), payload]);
        queueMicrotask(() => {
          const box = chatScrollRef.current;
          if (box) box.scrollTop = box.scrollHeight;
        });
      }
    );

    ch.on(
      "broadcast",
      { event: "TYPING" },
      ({ payload }: { payload: TypingPacket }) => {
        setTyping((prev) => ({
          ...prev,
          [payload.from.name]: Date.now() + 2000,
        }));
      }
    );

    ch.subscribe((status) => {
      if (status === "SUBSCRIBED") {
        ch.send({
          type: "broadcast",
          event: "HELLO",
          payload: {
            color: myColorRef.current,
            name: myNameRef.current,
            role: roleRef.current,
          },
        });
        if (roleRef.current === "guest") {
          const id = window.setInterval(() => {
            ch.send({
              type: "broadcast",
              event: "PING",
              payload: { pingClientAt: Date.now() },
            });
          }, PING_INTERVAL_MS);
          pingIntervalIdRef.current = id;
        }
      }
    });

    return () => {
      const id = pingIntervalIdRef.current;
      if (id !== null) {
        clearInterval(id);
        pingIntervalIdRef.current = null;
      }
      ch.unsubscribe();
    };
  }, [code]);

  const inputGuestRef = useRef<Input>({
    left: false,
    right: false,
    jump: false,
  });

  useEffect(() => {
    const sendGuestInput = () => {
      if (roleRef.current !== "guest") return;
      inputSeqRef.current++;
      chanRef.current?.send({
        type: "broadcast",
        event: "INPUT",
        payload: {
          from: "guest",
          color: "orange",
          input: { ...inputRef.current },
          seq: inputSeqRef.current,
        } as InputPacket,
      });
    };

    const setKey = (e: KeyboardEvent, down: boolean) => {
      if (document.activeElement === chatInputRef.current) return;
      if (e.repeat) return;
      const i = inputRef.current;
      let changed = false;
      if (
        ["ArrowLeft", "ArrowRight", " ", "ArrowUp", "w", "a", "d"].includes(
          e.key
        )
      )
        e.preventDefault();
      if (e.key === "ArrowLeft" || e.key === "a") {
        if (i.left !== down) {
          i.left = down;
          changed = true;
        }
      }
      if (e.key === "ArrowRight" || e.key === "d") {
        if (i.right !== down) {
          i.right = down;
          changed = true;
        }
      }
      if (e.key === " " || e.key === "ArrowUp" || e.key === "w") {
        if (i.jump !== down) {
          i.jump = down;
          changed = true;
        }
      }
      if (changed && roleRef.current === "guest") sendGuestInput();
    };

    const kd = (e: KeyboardEvent) => setKey(e, true);
    const ku = (e: KeyboardEvent) => setKey(e, false);

    const clearInputsAndNotify = () => {
      const i = inputRef.current;
      const wasNonZero = i.left || i.right || i.jump;
      i.left = i.right = i.jump = false;
      if (roleRef.current === "guest" && wasNonZero) {
        inputSeqRef.current++;
        chanRef.current?.send({
          type: "broadcast",
          event: "INPUT",
          payload: {
            from: "guest",
            color: "orange",
            input: { ...i },
            seq: inputSeqRef.current,
          } as InputPacket,
        });
      }
    };
    const onBlur = () => clearInputsAndNotify();
    const onVisibility = () => {
      if (document.visibilityState !== "visible") clearInputsAndNotify();
    };

    window.addEventListener("keydown", kd);
    window.addEventListener("keyup", ku);
    window.addEventListener("blur", onBlur);
    document.addEventListener("visibilitychange", onVisibility);

    if (roleRef.current === "guest") {
      const id = window.setInterval(() => {
        if (document.visibilityState === "visible") {
          inputSeqRef.current++;
          chanRef.current?.send({
            type: "broadcast",
            event: "INPUT",
            payload: {
              from: "guest",
              color: "orange",
              input: { ...inputRef.current },
              seq: inputSeqRef.current,
            } as InputPacket,
          });
        }
      }, GUEST_KEEPALIVE_MS);
      keepAliveTimerRef.current = id;
    }

    return () => {
      window.removeEventListener("keydown", kd);
      window.removeEventListener("keyup", ku);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVisibility);
      if (keepAliveTimerRef.current !== null) {
        clearInterval(keepAliveTimerRef.current);
        keepAliveTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (startedRef.current) return;
    if (!ctxReady || !levelReady) return;

    const isHost = roleRef.current === "host";

    // restore last known names if we had them (helps if something ever re-inits)
    const blueName =
      lastKnownNamesRef.current.blue ??
      (roleRef.current === "host" ? myNameRef.current : "Blue Player");
    const orangeName = lastKnownNamesRef.current.orange ?? "Guest";

    if (isHost) {
      const lvl = levelRef.current!;
      const cx = lvl.spawn.x + lvl.spawn.w * 0.5;

      p1Ref.current = {
        id: "p1",
        color: "blue",
        name: blueName,
        x: cx - 18,
        y: lvl.spawn.y - HALF_H,
        vx: 0,
        vy: 0,
        onGround: true,
        hp: START_HP,
        invulnMs: 0,
      };
      p2Ref.current = {
        id: "p2",
        color: "orange",
        name: orangeName,
        x: cx + 18,
        y: lvl.spawn.y - HALF_H,
        vx: 0,
        vy: 0,
        onGround: true,
        hp: START_HP,
        invulnMs: 0,
      };
      camXRef.current = 0;
      startHostLoop();
    } else {
      camXRef.current = 0;
      startGuestLoop();
    }

    startedRef.current = true;

    return () => {
      // don’t reset startedRef to avoid accidental re-inits
      stopLoop();
    };
  }, [ctxReady, levelReady]);

  function stopLoop() {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  }

  function startHostLoop() {
    let acc = 0;
    let last = performance.now();

    const step = () => {
      const now = performance.now();
      const dt = now - last;
      last = now;
      acc += dt;

      while (acc >= STEP_MS) {
        if (now - lastGuestInputAtRef.current > HOST_INPUT_STALE_MS) {
          inputGuestRef.current = { left: false, right: false, jump: false };
        }
        hostIntegrate();
        acc -= STEP_MS;
      }

      drawHost();
      broadcastState();
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function startGuestLoop() {
    const step = () => {
      drawGuest();
      rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
  }

  function applyInput(p: Player, i: Input) {
    if (i.left) p.vx -= MOVE;
    if (i.right) p.vx += MOVE;
    if (i.jump && p.onGround) {
      p.vy = JUMP_VY;
      p.onGround = false;
    }
  }

  function resolveCollisions(p: Player) {
    const lvl = levelRef.current!;
    const x = p.x;
    const y = p.y;
    let vx = p.vx;
    let vy = p.vy;
    let nextY = y + vy;
    const boxV: Tile = {
      x: x - HALF_W,
      y: nextY - HALF_H,
      w: HALF_W * 2,
      h: HALF_H * 2,
    };
    p.onGround = false;
    for (const t of lvl.platforms) {
      if (!aabb(boxV, t)) continue;
      if (vy > 0 && y - HALF_H <= t.y) {
        nextY = t.y - HALF_H;
        vy = 0;
        p.onGround = true;
      } else if (vy < 0 && y + HALF_H >= t.y + t.h) {
        nextY = t.y + t.h + HALF_H;
        vy = 0;
      }
      boxV.y = nextY - HALF_H;
    }
    let nextX = x + vx;
    const boxH: Tile = {
      x: nextX - HALF_W,
      y: nextY - HALF_H,
      w: HALF_W * 2,
      h: HALF_H * 2,
    };
    for (const t of lvl.platforms) {
      if (!aabb(boxH, t)) continue;
      const movingRight = vx > 0;
      nextX = movingRight ? t.x - HALF_W : t.x + t.w + HALF_W;
      vx = 0;
      boxH.x = nextX - HALF_W;
    }
    p.x = clamp(nextX, HALF_W, lvl.size.w - HALF_W);
    p.y = nextY;
    p.vx = vx;
    p.vy = vy;
  }

  function sendChat(text: string) {
    const trimmed = text.trim().slice(0, 240);
    if (!trimmed) return;
    const pkt: ChatPacket = {
      t: Date.now(),
      from: { name: myNameRef.current, color: myColorRef.current },
      text: trimmed,
    };
    setChat((prev) => [...prev.slice(-49), pkt]);
    chanRef.current?.send({ type: "broadcast", event: "CHAT", payload: pkt });
  }

  function respawn(p: Player) {
    const lvl = levelRef.current!;
    const cx = lvl.spawn.x + lvl.spawn.w * 0.5;
    p.x = cx + (p.id === "p1" ? -18 : 18);
    p.y = lvl.spawn.y - HALF_H;
    p.vx = 0;
    p.vy = 0;
    p.invulnMs = INVULN_AFTER_DEATH_MS;
  }

  function takeVoidDamage(p: Player) {
    if (p.invulnMs > 0) return;
    p.hp = Math.max(0, p.hp - 1);
    respawn(p);
  }

  function tickInvuln(p: Player) {
    if (p.invulnMs > 0) p.invulnMs = Math.max(0, p.invulnMs - STEP_MS);
  }

  function onGoal(p: Player) {
    const lvl = levelRef.current!;
    const zone: Tile = {
      x: lvl.goal.x,
      y: lvl.goal.y - 6,
      w: lvl.goal.w,
      h: 10,
    };
    return aabb(feetBox(p), zone);
  }

  function hostIntegrate() {
    const p1 = p1Ref.current!;
    const p2 = p2Ref.current!;

    applyInput(p1, inputRef.current);
    applyInput(p2, inputGuestRef.current);

    p1.vy += GRAV;
    p2.vy += GRAV;

    p1.vx = clamp(p1.vx, -MAX_VX, MAX_VX);
    p2.vx = clamp(p2.vx, -MAX_VX, MAX_VX);

    p1.x += p1.vx;
    p1.y += p1.vy;
    p2.x += p2.vx;
    p2.y += p2.vy;

    resolveCollisions(p1);
    resolveCollisions(p2);

    if (p1.onGround) p1.vx *= FRICTION;
    if (p2.onGround) p2.vx *= FRICTION;

    tickInvuln(p1);
    tickInvuln(p2);

    const lvl = levelRef.current!;
    if (p1.y - HALF_H > lvl.size.h + VOID_FALL_BUFFER) takeVoidDamage(p1);
    if (p2.y - HALF_H > lvl.size.h + VOID_FALL_BUFFER) takeVoidDamage(p2);

    if (!winRef.current && onGoal(p1) && onGoal(p2)) winRef.current = true;

    updateCamera(p1.x, p2.x);
  }

  function broadcastState() {
    const ch = chanRef.current;
    if (!ch || roleRef.current !== "host") return;
    const p1 = p1Ref.current!;
    const p2 = p2Ref.current!;
    const payload: StatePacket = { t: Date.now(), p1, p2, win: winRef.current };
    ch.send({ type: "broadcast", event: "STATE", payload });
  }

  function updateCamera(px1: number, px2: number) {
    const lvl = levelRef.current!;
    const minX = Math.min(px1, px2);
    const maxX = Math.max(px1, px2);
    let cam = camXRef.current;
    const leftBound = cam + CAM_MARGIN_L;
    const rightBound = cam + VIEW_W - CAM_MARGIN_R;
    if (minX < leftBound) cam -= leftBound - minX;
    if (maxX > rightBound) cam += maxX - rightBound;
    cam = clamp(cam, 0, Math.max(0, lvl.size.w - VIEW_W));
    camXRef.current += (cam - camXRef.current) * 0.18;
  }

  function drawLevel(ctx: CanvasRenderingContext2D) {
    const lvl = levelRef.current!;
    ctx.clearRect(0, 0, VIEW_W, VIEW_H);
    ctx.save();
    ctx.translate(-Math.floor(camXRef.current), 0);
    ctx.fillStyle = "#0b1020";
    ctx.fillRect(camXRef.current, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = PLATFORM_COLOR;
    for (const t of lvl.platforms) ctx.fillRect(t.x, t.y, t.w, t.h);
    ctx.fillStyle = SPAWN_COLOR;
    ctx.globalAlpha = 0.9;
    ctx.fillRect(lvl.spawn.x, lvl.spawn.y, lvl.spawn.w, lvl.spawn.h);
    const beam = (performance.now() / 300) % 1;
    ctx.globalAlpha = 0.25 + 0.25 * Math.sin(beam * Math.PI * 2);
    ctx.fillRect(lvl.spawn.x, lvl.spawn.y - 8, lvl.spawn.w, 6);
    ctx.globalAlpha = 1;
    ctx.fillStyle = GOAL_COLOR;
    ctx.fillRect(lvl.goal.x, lvl.goal.y, lvl.goal.w, lvl.goal.h);
    ctx.restore();
  }

  function drawHearts(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    n: number,
    color: string
  ) {
    ctx.fillStyle = color;
    for (let i = 0; i < n; i++) {
      ctx.beginPath();
      const px = x + i * 18;
      ctx.moveTo(px + 6, y + 12);
      ctx.bezierCurveTo(px - 6, y + 2, px, y - 2, px + 6, y + 4);
      ctx.bezierCurveTo(px + 12, y - 2, px + 18, y + 2, px + 6, y + 12);
      ctx.fill();
    }
  }

  function drawPlayer(ctx: CanvasRenderingContext2D, p: Player) {
    ctx.save();
    ctx.translate(-Math.floor(camXRef.current), 0);
    ctx.fillStyle = p.color === "blue" ? "#7c9cff" : "#ff9e57";
    if (p.invulnMs > 0)
      ctx.globalAlpha = 0.5 + 0.5 * Math.sin((p.invulnMs / 60) * Math.PI);
    ctx.fillRect(p.x - HALF_W, p.y - HALF_H, HALF_W * 2, HALF_H * 2);
    ctx.globalAlpha = 1;
    ctx.font = "12px ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto";
    ctx.textAlign = "center";
    ctx.fillStyle = "white";
    ctx.globalAlpha = 0.9;
    ctx.fillText(p.name, p.x, p.y - HALF_H - 8);
    ctx.globalAlpha = 1;
    ctx.restore();
  }

  function drawWinOverlay(ctx: CanvasRenderingContext2D) {
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillRect(0, 0, VIEW_W, VIEW_H);
    ctx.fillStyle = "#fff";
    ctx.font = "28px ui-sans-serif, system-ui";
    ctx.textAlign = "center";
    ctx.fillText("You both reached the goal!", VIEW_W / 2, 140);
    const btnW = 220;
    const btnH = 44;
    const bx = VIEW_W / 2 - btnW / 2;
    const by = 180;
    ctx.fillStyle = "#22c55e";
    ctx.fillRect(bx, by, btnW, btnH);
    ctx.fillStyle = "#0b1020";
    ctx.font = "16px ui-sans-serif, system-ui";
    ctx.fillText("Back to Main", VIEW_W / 2, by + 28);
    const c = canvasRef.current;
    if (c) {
      c.onclick = (ev) => {
        const rect = c.getBoundingClientRect();
        const x = ev.clientX - rect.left;
        const y = ev.clientY - rect.top;
        if (x >= bx && x <= bx + btnW && y >= by && y <= by + btnH) {
          c.onclick = null!;
          r.push(`/`);
        }
      };
    }
  }

  function drawHost() {
    const ctx = ctxRef.current!;
    drawLevel(ctx);
    drawPlayer(ctx, p1Ref.current!);
    drawPlayer(ctx, p2Ref.current!);
    drawHearts(ctx, 12, 10, Math.max(0, p1Ref.current!.hp), "#7c9cff");
    drawHearts(
      ctx,
      VIEW_W - 12 - 18 * Math.max(0, p2Ref.current!.hp),
      10,
      Math.max(0, p2Ref.current!.hp),
      "#ff9e57"
    );
    if (winRef.current) drawWinOverlay(ctx);
  }

  function drawGuest() {
    const ctx = ctxRef.current!;
    const prev = stPrevRef.current;
    const curr = stCurrRef.current;
    const guestNowHostClock = Date.now() + hostOffsetRef.current;
    const renderT = guestNowHostClock - renderDelayRef.current;

    let drawP1: Player | null = null;
    let drawP2: Player | null = null;
    let winNow = false;

    if (prev && curr) {
      const span = Math.max(1, curr.hostT - prev.hostT);
      let t = (renderT - prev.hostT) / span;
      if (t < 0) t = 0;
      if (t <= 1) {
        drawP1 = {
          ...curr.p1,
          x: lerp(prev.p1.x, curr.p1.x, t),
          y: lerp(prev.p1.y, curr.p1.y, t),
          vx: lerp(prev.p1.vx, curr.p1.vx, t),
          vy: lerp(prev.p1.vy, curr.p1.vy, t),
          onGround: t < 0.5 ? prev.p1.onGround : curr.p1.onGround,
        };
        drawP2 = {
          ...curr.p2,
          x: lerp(prev.p2.x, curr.p2.x, t),
          y: lerp(prev.p2.y, curr.p2.y, t),
          vx: lerp(prev.p2.vx, curr.p2.vx, t),
          vy: lerp(prev.p2.vy, curr.p2.vy, t),
          onGround: t < 0.5 ? prev.p2.onGround : curr.p2.onGround,
        };
        winNow = curr.win;
      } else {
        const aheadMs = Math.min(EXTRAPOLATE_CAP_MS, renderT - curr.hostT);
        const k = aheadMs / STEP_MS;
        drawP1 = {
          ...curr.p1,
          x: curr.p1.x + curr.p1.vx * k,
          y: curr.p1.y + curr.p1.vy * k,
        };
        drawP2 = {
          ...curr.p2,
          x: curr.p2.x + curr.p2.vx * k,
          y: curr.p2.y + curr.p2.vy * k,
        };
        winNow = curr.win;
      }
    } else {
      const st = latestStateRef.current;
      if (st) {
        drawP1 = st.p1;
        drawP2 = st.p2;
        winNow = st.win;
      }
    }

    if (!drawP1 || !drawP2) {
      ctx.clearRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = "#0b1020";
      ctx.fillRect(0, 0, VIEW_W, VIEW_H);
      ctx.fillStyle = "white";
      ctx.globalAlpha = 0.8;
      ctx.font = "16px ui-sans-serif, system-ui";
      ctx.textAlign = "center";
      ctx.fillText("Waiting for host…", VIEW_W / 2, VIEW_H / 2 - 20);
      ctx.globalAlpha = 1;
      return;
    }

    updateCamera(drawP1.x, drawP2.x);

    drawLevel(ctx);
    drawPlayer(ctx, drawP1);
    drawPlayer(ctx, drawP2);
    drawHearts(ctx, 12, 10, Math.max(0, drawP1.hp), "#7c9cff");
    drawHearts(
      ctx,
      VIEW_W - 12 - 18 * Math.max(0, drawP2.hp),
      10,
      Math.max(0, drawP2.hp),
      "#ff9e57"
    );
    if (winNow) drawWinOverlay(ctx);
  }

  const [title, setTitle] = useState("Plane — Guest (Orange)");
  useEffect(() => {
    setTitle(
      roleRef.current === "host"
        ? "Plane — Host (Blue)"
        : "Plane — Guest (Orange)"
    );
  }, []);

  return (
    <main className="pt-4">
      <div className="flex items-baseline justify-between">
        <h1 className="text-xl font-semibold">
          {title} — Lobby #{code}
        </h1>
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
      <div className="mt-2 grid grid-cols-1 gap-2 md:grid-cols-3">
        <div className="md:col-span-2" />
        <div className="rounded-lg border border-[#23283a]">
          <div
            ref={chatScrollRef}
            className="h-40 overflow-y-auto bg-[#0b1020]/80 p-2"
          >
            {chat.map((m) => (
              <div key={`${m.t}-${m.from.name}`} className="mb-1 text-sm">
                <span
                  className="font-semibold"
                  style={{
                    color: m.from.color === "blue" ? "#7c9cff" : "#ff9e57",
                  }}
                >
                  {m.from.name}
                </span>
                <span className="text-white/70">: {m.text}</span>
              </div>
            ))}
          </div>
          {/* typing indicator */}
          {Object.keys(typing).length > 0 && (
            <div className="border-t border-[#23283a] px-2 py-1 text-xs text-white/70">
              {Object.keys(typing)
                .slice(0, 3)
                .map((n, i, arr) => (
                  <span key={n}>
                    {n}
                    {i < arr.length - 1 ? ", " : ""}
                  </span>
                ))}
              {Object.keys(typing).length > 3 ? " and others " : " "}
              is typing…
            </div>
          )}

          <form
            className="flex gap-2 border-t border-[#23283a] p-2"
            onSubmit={(e) => {
              e.preventDefault();
              const v = chatInputRef.current?.value || "";
              sendChat(v);
              if (chatInputRef.current) chatInputRef.current.value = "";
              // ensure scroll after local send
              requestAnimationFrame(() => {
                const box = chatScrollRef.current;
                if (box) box.scrollTop = box.scrollHeight;
              });
            }}
          >
            <input
              ref={chatInputRef}
              type="text"
              placeholder="Type message…"
              className="w-full rounded-md bg-[#0b1020] px-2 py-1 text-sm outline-none placeholder:text-white/40"
              onChange={() => {
                if (typingDebounceRef.current) return;
                typingDebounceRef.current = window.setTimeout(() => {
                  typingDebounceRef.current = null;
                }, 500);

                const pkt: TypingPacket = {
                  t: Date.now(),
                  from: { name: myNameRef.current, color: myColorRef.current },
                };
                chanRef.current?.send({
                  type: "broadcast",
                  event: "TYPING",
                  payload: pkt,
                });

                // also reflect locally (so you see your own indicator instantly)
                setTyping((prev) => ({
                  ...prev,
                  [pkt.from.name]: Date.now() + 2000,
                }));
              }}
              onKeyDown={() => {
                // same behavior as onChange to handle cases where value didn't change yet
                if (typingDebounceRef.current) return;
                typingDebounceRef.current = window.setTimeout(() => {
                  typingDebounceRef.current = null;
                }, 500);
                const pkt: TypingPacket = {
                  t: Date.now(),
                  from: { name: myNameRef.current, color: myColorRef.current },
                };
                chanRef.current?.send({
                  type: "broadcast",
                  event: "TYPING",
                  payload: pkt,
                });
                setTyping((prev) => ({
                  ...prev,
                  [pkt.from.name]: Date.now() + 2000,
                }));
              }}
            />

            <button
              type="submit"
              className="rounded-md bg-[#22c55e] px-3 py-1 text-sm text-black"
            >
              Send
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}

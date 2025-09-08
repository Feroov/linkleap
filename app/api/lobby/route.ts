// app/api/lobby/route.ts
import { NextRequest } from "next/server";
import kv from "@/lib/kv";
import { makeLobbyCode } from "@/lib/ids";
import type { LobbyMeta } from "@/lib/types";

export const runtime = "nodejs";

// POST /api/lobby  -> create lobby
export async function POST(_req: NextRequest) {
  // create unique code (retry a few times to avoid rare collisions)
  let code = "";
  for (let i = 0; i < 5; i++) {
    code = makeLobbyCode(5);
    const exists = await kv.get(`lobby:${code}`);
    if (!exists) break;
  }
  if (!code) return new Response("Failed to allocate code", { status: 500 });

  const meta: LobbyMeta = {
    code,
    seed: Math.random().toString(36).slice(2, 10),
    status: "waiting",
    createdAt: Date.now(),
    maxPlayers: 2,
  };

  // store the lobby with TTL (2m) and update the directory list
  await kv.set(`lobby:${code}`, meta, { ex: 120 });
  const list = ((await kv.get<LobbyMeta[]>("lobbies")) ?? []).filter(
    // keep only recent waiting lobbies; avoid unbounded growth
    (l) => l.status === "waiting" && Date.now() - l.createdAt < 60 * 60 * 1000
  );
  list.unshift(meta);
  await kv.set("lobbies", list.slice(0, 200), { ex: 120 });

  return Response.json(meta);
}

// GET /api/lobby?code=ABCDE  (keep your existing GET & diag)
export async function GET(req: NextRequest) { /* … your existing code … */ }

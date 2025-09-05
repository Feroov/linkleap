import { NextRequest } from "next/server";
import kv from "@/lib/kv";
import { makeLobbyCode } from "@/lib/ids";
import type { LobbyMeta } from "@/lib/types";
import { z } from "zod";

export const runtime = "nodejs";

// POST /api/lobby  -> create a new lobby
export async function POST(req: NextRequest) {
  const Body = z.object({ seed: z.string().trim().optional() }).strict();

  const json = await req.json().catch(() => ({}));
  const parsed = Body.safeParse(json);
  const requestedSeed =
    parsed.success && parsed.data.seed ? parsed.data.seed : null;

  // generate a unique code (few tries just in case)
  let code = "";
  for (let i = 0; i < 5; i++) {
    const c = makeLobbyCode();
    const exists = await kv.get(`lobby:${c}`);
    if (!exists) {
      code = c;
      break;
    }
  }
  if (!code)
    return new Response("Could not generate lobby code", { status: 500 });

  const seed =
    requestedSeed ?? Math.floor(Math.random() * 2 ** 31).toString(36);
  const meta: LobbyMeta = {
    code,
    seed,
    status: "waiting",
    createdAt: Date.now(),
    maxPlayers: 2,
  };

  await kv.set(`lobby:${code}`, meta, { ex: 120 });
  const list = ((await kv.get("lobbies")) as LobbyMeta[] | null) ?? [];
  list.push(meta);
  while (list.length > 200) list.shift(); // keep list small
  await kv.set("lobbies", list, { ex: 120 });

  return Response.json(meta);
}

// GET /api/lobby?code=ABCDE  -> fetch lobby meta (handy for testing)
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const code = searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });
  const meta = (await kv.get(`lobby:${code}`)) as LobbyMeta | null;
  if (!meta) return new Response("Not found", { status: 404 });
  return Response.json(meta);
}

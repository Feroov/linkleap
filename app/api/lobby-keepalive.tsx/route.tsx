import kv from "@/lib/kv";
import type { LobbyMeta } from "@/lib/types";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const { code } = await req.json().catch(() => ({}));
  if (!code) return new Response("Missing code", { status: 400 });

  const meta = (await kv.get(`lobby:${code}`)) as LobbyMeta | null;
  if (!meta) return new Response("Not found", { status: 404 });

  // extend TTL to 2 minutes again
  await kv.set(`lobby:${code}`, meta, { ex: 120 });

  // also extend the directory list
  const list = ((await kv.get("lobbies")) as LobbyMeta[] | null) ?? [];
  await kv.set("lobbies", list, { ex: 120 });

  return new Response("ok");
}

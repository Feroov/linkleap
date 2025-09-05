import { NextRequest } from "next/server";
import kv from "@/lib/kv";
import type { LobbyMeta } from "@/lib/types";

// keep whatever runtime you already set
export const runtime = "nodejs";

// GET /api/lobby?code=ABCDE
export async function GET(req: NextRequest) {
  const url = new URL(req.url);

  // --- DIAGNOSTIC BRANCH ---
  // Call: /api/lobby?diag=1   (no auth, temporary)
  if (url.searchParams.get("diag") === "1") {
    try {
      await kv.set("diag:ping", "ok", { ex: 20 });
      const v = await kv.get<string>("diag:ping");
      return Response.json({ kvWorks: v === "ok", value: v });
    } catch (e) {
      return Response.json(
        { kvWorks: false, error: String(e) },
        { status: 500 }
      );
    }
  }
  // --- END DIAGNOSTIC ---

  const code = url.searchParams.get("code");
  if (!code) return new Response("Missing code", { status: 400 });

  const meta = (await kv.get<LobbyMeta>(`lobby:${code}`)) as LobbyMeta | null;
  if (!meta) return new Response("Not found", { status: 404 });
  return Response.json(meta);
}

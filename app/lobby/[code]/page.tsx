import kv from "@/lib/kv";
import type { LobbyMeta } from "@/lib/types";
import WaitingRoom from "./waiting-room";

export default async function LobbyPage({ params, searchParams }:
  { params: { code: string }, searchParams: Record<string, string | string[] | undefined> }) {
  const code = params.code;
  const meta = await kv.get<LobbyMeta>(`lobby:${code}`);
  if (!meta) return <main style={{ paddingTop: 24 }}><h1>Lobby not found</h1></main>;
  const isHost = searchParams?.host === "1";
  return <WaitingRoom code={code} seed={meta.seed} isHost={!!isHost} />;
}

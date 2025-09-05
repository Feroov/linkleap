export type LobbyMeta = {
  code: string;
  seed: string; // used later for deterministic level gen
  status: "waiting" | "playing";
  createdAt: number;
  maxPlayers: number; // 2 (MVP)
};

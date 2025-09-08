"use client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { motion } from "framer-motion";
import { useRouter } from "next/navigation";
import { useState } from "react";
import Image from "next/image";

export default function Home() {
  const r = useRouter();
  const [busy, setBusy] = useState(false);

  async function hostLobby() {
    setBusy(true);
    try {
      const res = await fetch("/api/lobby", {
        method: "POST",
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error(await res.text());
      const meta = await res.json();
      r.push(`/lobby/${meta.code}?host=1`);
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="pt-10">
      <motion.h1
        className="text-5xl font-bold tracking-tight"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        Link<span className="text-accent">Leap</span>
      </motion.h1>
      <motion.p
        className="mt-2 text-white/70"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.1 }}
      >
        Two minds. One leap. Procedural co-op platforming.
      </motion.p>

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <Card className="p-5">
          <h3 className="text-lg font-semibold">Host a lobby</h3>
          <p className="mt-1 text-sm text-white/60">
            Create a room and share a link or code.
          </p>
          <Button
            onClick={hostLobby}
            look="accent"
            size="lg"
            className="mt-4 w-full"
          >
            {busy ? "Creating…" : "Host lobby"}
          </Button>
        </Card>
        <Card className="p-5">
          <h3 className="text-lg font-semibold">Join a lobby</h3>
          <p className="mt-1 text-sm text-white/60">
            Browse open rooms and jump in.
          </p>
          <Button
            onClick={() => r.push("/lobbies")}
            size="lg"
            className="mt-4 w-full"
          >
            Join lobby
          </Button>
        </Card>
      </div>

      <motion.div
        className="mt-10 overflow-hidden rounded-xl2 border border-[#23283a] shadow-glow"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.15 }}
      >
        <Image
          src="/banner.png"
          alt="LinkLeap Hero"
          width={660}
          height={142}
          className="w-[1000px] h-[442px] object-fill"
          priority
        />
      </motion.div>
    </main>
  );
}

"use client";

import { useBackground } from "./BackgroundContext";

export function ContentGate({ children }: { children: React.ReactNode }) {
  const { canvasReady } = useBackground();
  return (
    <div
      className="min-h-screen transition-opacity duration-300"
      style={{ opacity: canvasReady ? 1 : 0 }}
    >
      {children}
    </div>
  );
}

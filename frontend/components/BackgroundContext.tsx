"use client";

import { createContext, useContext, useState } from "react";

type BackgroundContextValue = {
  heroHover: boolean;
  setHeroHover: (v: boolean) => void;
  canvasReady: boolean;
  setCanvasReady: (v: boolean) => void;
};

const BackgroundContext = createContext<BackgroundContextValue | null>(null);

export function BackgroundEffectProvider({ children }: { children: React.ReactNode }) {
  const [heroHover, setHeroHover] = useState(false);
  const [canvasReady, setCanvasReady] = useState(false);
  return (
    <BackgroundContext.Provider value={{ heroHover, setHeroHover, canvasReady, setCanvasReady }}>
      {children}
    </BackgroundContext.Provider>
  );
}

export function useBackground() {
  const ctx = useContext(BackgroundContext);
  return ctx ?? { heroHover: false, setHeroHover: () => {}, canvasReady: false, setCanvasReady: () => {} };
}

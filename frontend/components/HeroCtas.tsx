"use client";

import Link from "next/link";
import { useBackground } from "./BackgroundContext";

export function HeroCtas() {
  const { setHeroHover } = useBackground();

  return (
    <div className="w-full max-w-[960px] mx-auto flex justify-center">
      <Link
        href="/explorer"
        className="glass-btn-hero w-[60%] inline-flex items-center justify-center rounded-2xl text-white py-4 text-base font-semibold hover:bg-white/10 hover:border-white/20 transition-all"
        onMouseEnter={() => setHeroHover(true)}
        onMouseLeave={() => setHeroHover(false)}
      >
        Explore
      </Link>
    </div>
  );
}

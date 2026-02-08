"use client";

import Link from "next/link";
import Image from "next/image";
import { useState } from "react";
import { MobileMenu } from "./MobileMenu";

const MenuIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256">
    <path d="M224,128a8,8,0,0,1-8,8H40a8,8,0,0,1,0-16H216A8,8,0,0,1,224,128ZM40,72H216a8,8,0,0,0,0-16H40a8,8,0,0,0,0,16ZM216,184H40a8,8,0,0,0,0,16H216a8,8,0,0,0,0-16Z" />
  </svg>
);

const CloseIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="currentColor" viewBox="0 0 256 256">
    <path d="M205.66,194.34a8,8,0,0,1-11.32,11.32L128,139.31,61.66,205.66a8,8,0,0,1-11.32-11.32L116.69,128,50.34,61.66A8,8,0,0,1,61.66,50.34L128,116.69l66.34-66.35a8,8,0,0,1,11.32,11.32L139.31,128Z" />
  </svg>
);

const GitHubIcon = () => (
  <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" fill="currentColor" viewBox="0 0 24 24" aria-hidden>
    <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
  </svg>
);

const navLinks = [
  { href: "/explorer", label: "Explorer", title: "Transaction explorer" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="glass flex items-center sticky top-0 z-50 justify-between whitespace-nowrap px-4 md:px-6 lg:px-10 py-4 gap-4">
        <div className="flex items-center gap-4 lg:gap-8 min-w-0 shrink-0">
          <Link href="/" className="flex items-center gap-1.5 md:gap-2 text-white shrink-0" title="Aegis – Home">
            <Image
              src="/logo_defi.svg"
              alt="Aegis"
              width={18}
              height={28}
              className="h-[22px] w-auto object-contain brightness-0 invert"
              unoptimized
            />
            <h2 className="text-white text-base md:text-lg font-bold leading-tight tracking-[-0.015em]">
              Aegis
            </h2>
          </Link>
          <nav className="hidden lg:flex items-center gap-6 xl:gap-9">
            {navLinks.map(({ href, label, title }) => (
              <Link
                key={label}
                href={href}
                title={title}
                className="text-white text-sm font-medium leading-normal hover:text-brand transition-colors"
              >
                {label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="flex items-center gap-2 md:gap-4 lg:gap-6 shrink-0">
          <a
            href="https://github.com/10234567Z/Aegis"
            target="_blank"
            rel="noopener noreferrer"
            className="glass-btn hidden lg:inline-flex items-center justify-center rounded-2xl text-white w-11 h-11 hover:bg-white/12 hover:border-white/20 transition-all"
            aria-label="GitHub"
          >
            <GitHubIcon />
          </a>
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="lg:hidden flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-11 w-11 bg-white/10 text-white hover:bg-white/15 border border-white/10 transition-colors"
            aria-label="Menu"
          >
            {menuOpen ? <CloseIcon /> : <MenuIcon />}
          </button>
        </div>
      </header>
      <MobileMenu open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}

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

const navLinks = [
  { href: "/explorer", label: "TX Explorer", title: "Transaction explorer" },
];

export function Header() {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <>
      <header className="flex items-center sticky top-0 z-50 justify-between whitespace-nowrap border-b border-solid border-border bg-surface px-4 md:px-6 lg:px-10 py-3 gap-4">
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
          <button
            onClick={() => setMenuOpen((o) => !o)}
            className="lg:hidden flex cursor-pointer items-center justify-center overflow-hidden rounded-full h-10 w-10 bg-input text-white hover:bg-inputHover transition-colors"
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

"use client";

import Link from "next/link";

const navLinks = [
  { href: "/explorer", label: "Explorer", title: "Transaction explorer" },
];

type MobileMenuProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  if (!open) return null;

  return (
    <div className="glass lg:hidden border-b border-white/5">
      <nav className="flex flex-col px-4 py-3 gap-1">
        {navLinks.map(({ href, label, title }) => (
          <Link
            key={label}
            href={href}
            onClick={onClose}
            title={title}
            className="text-white text-base font-medium leading-normal py-3 px-4 hover:bg-white/10 rounded-lg transition-colors"
          >
            {label}
          </Link>
        ))}
        <a
          href="https://github.com/10234567Z/Aegis"
          target="_blank"
          rel="noopener noreferrer"
          onClick={onClose}
          className="text-white text-base font-medium leading-normal py-3 px-4 hover:bg-white/10 rounded-lg transition-colors"
        >
          GitHub
        </a>
      </nav>
    </div>
  );
}

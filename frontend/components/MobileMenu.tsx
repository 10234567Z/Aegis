"use client";

import Link from "next/link";

const navLinks = [
  { href: "/explorer", label: "TX Explorer", title: "Transaction explorer" },
];

type MobileMenuProps = {
  open: boolean;
  onClose: () => void;
};

export function MobileMenu({ open, onClose }: MobileMenuProps) {
  if (!open) return null;

  return (
    <div className="lg:hidden bg-surfaceAlt border-b border-border">
      <nav className="flex flex-col px-4 py-3 gap-1">
        {navLinks.map(({ href, label, title }) => (
          <Link
            key={label}
            href={href}
            onClick={onClose}
            title={title}
            className="text-white text-base font-medium leading-normal py-3 px-4 hover:bg-input rounded-lg transition-colors"
          >
            {label}
          </Link>
        ))}
      </nav>
    </div>
  );
}

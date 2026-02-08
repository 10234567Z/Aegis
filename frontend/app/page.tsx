import Link from "next/link";
import { Header } from "@/components/Header";

export default function MainPage() {
  return (
    <div className="relative flex size-full min-h-screen flex-col overflow-x-hidden bg-surface">
      <div className="layout-container flex h-full grow flex-col">
        <Header />
        <main className="px-4 md:px-10 lg:px-40 flex flex-1 justify-center items-center py-16 md:py-20">
          <div className="layout-content-container flex flex-col max-w-[800px] flex-1 w-full text-center">
            <span className="inline-block text-brand text-xs font-semibold uppercase tracking-[0.2em] mb-6">
              Web3 transaction security
            </span>
            <h1 className="text-white text-4xl md:text-6xl lg:text-7xl font-bold leading-[1.1] tracking-[-0.03em] mb-6">
              Security that moves
              <br />
              <span className="text-brand">at the speed of chain.</span>
            </h1>
            <p className="text-muted text-lg md:text-xl max-w-[560px] mx-auto leading-relaxed mb-10">
              AI-powered protection for every contract interaction. We detect risk, trigger
              VDF and FROST verification when it matters, and give you a single dashboard
              to stay in control.
            </p>
            <div className="flex flex-wrap justify-center gap-4">
              <Link
                href="/explorer"
                className="inline-flex items-center justify-center rounded-xl bg-brand text-surface px-7 py-3.5 text-base font-semibold hover:opacity-90 transition-opacity"
              >
                TX Explorer
              </Link>
              <a
                href="https://github.com/harsh-aegis/DeFiGuardian"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center rounded-xl border border-border text-white px-7 py-3.5 text-base font-medium hover:bg-input transition-colors"
              >
                GitHub
              </a>
            </div>
          </div>
        </main>
      </div>
    </div>
  );
}

import { Header } from "@/components/Header";
import { HeroCtas } from "@/components/HeroCtas";

export default function MainPage() {
  return (
    <div className="relative flex size-full min-h-screen flex-col overflow-x-hidden bg-transparent">
      <div className="layout-container flex h-full grow flex-col">
        <Header />
        <main className="px-4 md:px-8 lg:px-32 flex flex-1 justify-center items-center py-16 md:py-20 lg:py-24">
          <div className="layout-content-container flex flex-col max-w-[960px] flex-1 w-full text-center">
            <span className="inline-block text-brand text-xs font-semibold uppercase tracking-[0.2em] mb-6">
              AI Guardian for Web3
            </span>
            <h1 className="text-white text-4xl md:text-5xl lg:text-6xl font-bold leading-[1.08] tracking-[-0.03em] mb-6">
              Web3 Security which
              <br />
              <span className="text-brand">detects and prevents</span>
            </h1>
            <p className="text-muted text-base md:text-lg max-w-[560px] mx-auto leading-relaxed mb-10">
              AI-powered protection for every contract interaction
              <br />
              We detect risk, trigger VDF and FROST verification when it matters, and give you a single dashboard to stay in control.
            </p>
            <HeroCtas />
          </div>
        </main>
        <footer className="px-4 py-8 text-center">
          <p className="text-white text-sm">The best hack is the one that never happens.</p>
        </footer>
      </div>
    </div>
  );
}

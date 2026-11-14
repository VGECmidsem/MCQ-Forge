"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  Database,
  FileUp,
  History,
  LayoutDashboard,
  Menu,
  Moon,
  ScanText,
  Sun,
  Timer,
  X,
} from "lucide-react";

const LINKS = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/upload", label: "Upload PDFs", icon: FileUp },
  { href: "/bank", label: "Question Bank", icon: Database },
  { href: "/test/new", label: "New Test", icon: Timer },
  { href: "/tests", label: "My Tests", icon: History },
];

export function Nav() {
  const pathname = usePathname();
  const [dark, setDark] = useState(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  const toggleTheme = () => {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("mcq-theme", next ? "dark" : "light");
    } catch {
      /* ignore */
    }
  };

  const isActive = (href: string) =>
    href === "/" ? pathname === "/" : pathname.startsWith(href);

  return (
    <header className="sticky top-0 z-40 border-b border-[var(--border)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur-xl">
      <div className="mx-auto flex h-14 w-full max-w-7xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/30">
            <ScanText size={17} strokeWidth={2.2} />
          </span>
          <span className="font-display text-[1.05rem] tracking-tight">
            MCQ<span className="bg-gradient-to-r from-indigo-500 to-violet-500 bg-clip-text text-transparent">Forge</span>
          </span>
        </Link>
        <nav className="ml-4 hidden items-center gap-1 md:flex">
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`nav-link ${isActive(l.href) ? "active" : ""}`}>
              <l.icon size={15} />
              {l.label}
            </Link>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-1">
          <button
            onClick={toggleTheme}
            className="btn-ghost btn !px-2.5"
            aria-label="Toggle dark mode"
            title="Toggle theme"
          >
            {dark ? <Sun size={17} /> : <Moon size={17} />}
          </button>
          <button
            className="btn-ghost btn !px-2.5 md:hidden"
            onClick={() => setOpen((o) => !o)}
            aria-label="Menu"
          >
            {open ? <X size={18} /> : <Menu size={18} />}
          </button>
        </div>
      </div>
      {open && (
        <nav className="border-t border-[var(--border)] bg-[var(--surface)] px-4 py-2 md:hidden">
          {LINKS.map((l) => (
            <Link
              key={l.href}
              href={l.href}
              onClick={() => setOpen(false)}
              className={`nav-link my-0.5 flex w-full ${isActive(l.href) ? "active" : ""}`}
            >
              <l.icon size={15} />
              {l.label}
            </Link>
          ))}
        </nav>
      )}
    </header>
  );
}

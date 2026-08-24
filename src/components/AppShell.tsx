"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import type { SessionDto } from "@/lib/types";
import { api } from "@/lib/client";
import { ToastProvider } from "@/components/ui";

const adminNav = [
  { href: "/", label: "Dashboard" },
  { href: "/shops", label: "Shops" },
  { href: "/routes", label: "Routes" },
  { href: "/drivers", label: "Drivers" },
];

function LogoMark() {
  return (
    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-ink text-white">
      <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
        <path d="M6 20a2 2 0 100-4 2 2 0 000 4zm12-12a2 2 0 100-4 2 2 0 000 4zM8 18h7a4 4 0 000-8H9a4 4 0 010-4" />
      </svg>
    </span>
  );
}

function Wordmark() {
  return (
    <span className="text-[19px] font-bold tracking-tight text-ink">
      ROUTE<span className="text-brand">PILOT</span>
    </span>
  );
}

function PillNav({ items, pathname }: { items: typeof adminNav; pathname: string }) {
  return (
    <nav className="no-scrollbar flex items-center gap-0.5 overflow-x-auto rounded-full border border-black/[0.05] bg-white p-1.5 shadow-[0_4px_22px_rgba(0,0,0,0.10)]">
      {items.map((item) => {
        const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`whitespace-nowrap rounded-full px-4 py-2 text-[15px] font-medium transition-colors ${
              active ? "bg-ink text-white" : "text-gray-700 hover:text-black"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

function UserMenu({ user, dark = true }: { user: SessionDto; dark?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", onClick);
    return () => window.removeEventListener("mousedown", onClick);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Account"
        className={`flex h-10 w-10 items-center justify-center rounded-full transition-colors ${
          dark ? "text-gray-300 hover:bg-white/10 hover:text-white" : "text-gray-500 hover:bg-black/5"
        }`}
      >
        <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M16 8a4 4 0 11-8 0 4 4 0 018 0zM5 20.5c.9-3.2 3.7-5 7-5s6.1 1.8 7 5" />
        </svg>
      </button>
      {open && (
        <div className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-black/[0.06] bg-white shadow-[0_16px_50px_rgba(0,0,0,0.18)]">
          <div className="border-b border-black/[0.05] px-4 py-3">
            <p className="truncate text-sm font-semibold text-ink">{user.name}</p>
            <p className="truncate text-xs text-muted">{user.email}</p>
            <p className="mt-0.5 text-[11px] font-medium uppercase tracking-wide text-faint">
              {user.role === "ADMIN" ? "Administrator" : "Driver"}
            </p>
          </div>
          <button
            onClick={async () => {
              try {
                await api("/api/auth/logout", { method: "POST" });
              } finally {
                router.push("/login");
                router.refresh();
              }
            }}
            className="flex w-full items-center gap-2.5 px-4 py-3 text-left text-sm text-ink hover:bg-black/[0.03]"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
              <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
            </svg>
            Sign out
          </button>
        </div>
      )}
    </div>
  );
}

export function AdminShell({ user, children }: { user: SessionDto; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas">
        <header className="sticky top-0 z-40 bg-canvas/75 backdrop-blur-xl">
          <div className="mx-auto flex max-w-[1400px] items-center justify-between gap-4 px-4 py-4 md:px-8">
            <Link href="/" className="flex items-center gap-3">
              <LogoMark />
              <Wordmark />
            </Link>

            <div className="hidden md:block">
              <PillNav items={adminNav} pathname={pathname} />
            </div>

            <div className="flex items-center gap-2.5">
              <UserMenu user={user} dark={false} />
              <Link
                href="/routes/new"
                className="hidden items-center gap-2 rounded-full bg-brand px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-strong sm:inline-flex"
              >
                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <path d="M12 5v14M5 12h14" />
                </svg>
                New Route
              </Link>
            </div>
          </div>

          {/* Mobile: pill nav gets its own row */}
          <div className="px-4 pb-3.5 md:hidden">
            <PillNav items={adminNav} pathname={pathname} />
          </div>
        </header>

        <main className="mx-auto max-w-[1400px] px-4 py-7 md:px-8 md:py-9">{children}</main>
      </div>
    </ToastProvider>
  );
}

export function DriverShell({ user, children }: { user: SessionDto; children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-canvas">
        <header className="sticky top-0 z-40 bg-canvas/75 backdrop-blur-xl">
          <div className="mx-auto flex max-w-3xl items-center justify-between gap-3 px-4 py-3.5">
            <Link href="/driver" className="flex items-center gap-2.5">
              <LogoMark />
              <span className="text-[17px] font-bold tracking-tight text-ink">
                My <span className="text-brand">Routes</span>
              </span>
            </Link>
            <div className="flex items-center gap-1.5">
              <span className="hidden text-xs text-muted sm:block">{user.name}</span>
              <UserMenu user={user} dark={false} />
            </div>
          </div>
        </header>
        <main className="mx-auto max-w-3xl px-4 py-6">{children}</main>
      </div>
    </ToastProvider>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-[26px] font-semibold tracking-tight text-ink md:text-[30px]">
          {title}
        </h1>
        {description && <p className="mt-1 text-[15px] text-muted">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

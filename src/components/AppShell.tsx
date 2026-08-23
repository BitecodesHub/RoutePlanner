"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { ReactNode } from "react";
import type { SessionDto } from "@/lib/types";
import { api } from "@/lib/client";
import { ToastProvider } from "@/components/ui";

const adminNav = [
  { href: "/", label: "Dashboard", icon: "M3 12l9-9 9 9M5 10v10h5v-6h4v6h5V10" },
  { href: "/shops", label: "Shops", icon: "M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6" },
  { href: "/routes", label: "Routes", icon: "M6 20a2 2 0 100-4 2 2 0 000 4zm12-12a2 2 0 100-4 2 2 0 000 4zM8 18h7a4 4 0 000-8H9a4 4 0 010-4" },
  { href: "/drivers", label: "Drivers", icon: "M16 7a4 4 0 11-8 0 4 4 0 018 0zM4 21v-1a6 6 0 016-6h4a6 6 0 016 6v1" },
];

function NavIcon({ d }: { d: string }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d={d} />
    </svg>
  );
}

function LogoutButton({ className = "" }: { className?: string }) {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        try {
          await api("/api/auth/logout", { method: "POST" });
        } finally {
          router.push("/login");
          router.refresh();
        }
      }}
      className={`flex items-center gap-2 rounded-lg px-3 py-2 text-sm text-gray-300 hover:bg-white/10 hover:text-white ${className}`}
    >
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
        <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4M16 17l5-5-5-5M21 12H9" />
      </svg>
      Sign out
    </button>
  );
}

export function AdminShell({ user, children }: { user: SessionDto; children: ReactNode }) {
  const pathname = usePathname();
  return (
    <ToastProvider>
      <div className="flex min-h-screen bg-gray-50">
        <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 flex-col bg-slate-900 md:flex">
          <div className="flex items-center gap-2.5 px-5 py-5">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-blue-600 font-bold text-white">R</div>
            <div>
              <p className="text-sm font-semibold text-white">RoutePilot</p>
              <p className="text-[11px] text-gray-400">Route optimisation</p>
            </div>
          </div>
          <nav className="mt-2 flex-1 space-y-1 px-3">
            {adminNav.map((item) => {
              const active =
                item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors ${
                    active ? "bg-blue-600 text-white" : "text-gray-300 hover:bg-white/10 hover:text-white"
                  }`}
                >
                  <NavIcon d={item.icon} />
                  {item.label}
                </Link>
              );
            })}
          </nav>
          <div className="border-t border-white/10 p-3">
            <p className="truncate px-3 pb-1 text-xs text-gray-400">{user.email}</p>
            <LogoutButton className="w-full" />
          </div>
        </aside>

        {/* Mobile top bar */}
        <div className="fixed inset-x-0 top-0 z-40 flex items-center justify-between bg-slate-900 px-4 py-3 md:hidden">
          <span className="text-sm font-semibold text-white">RoutePilot</span>
          <div className="flex items-center gap-1">
            {adminNav.map((i) => (
              <Link key={i.href} href={i.href} className="rounded px-2 py-1 text-xs text-gray-300 hover:text-white">
                {i.label}
              </Link>
            ))}
            <LogoutButton />
          </div>
        </div>

        <main className="flex-1 px-4 pb-10 pt-16 md:ml-60 md:px-8 md:pt-8">{children}</main>
      </div>
    </ToastProvider>
  );
}

export function DriverShell({ user, children }: { user: SessionDto; children: ReactNode }) {
  return (
    <ToastProvider>
      <div className="min-h-screen bg-gray-50">
        <header className="sticky top-0 z-40 flex items-center justify-between bg-slate-900 px-4 py-3 md:px-8">
          <Link href="/driver" className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-600 text-sm font-bold text-white">R</div>
            <span className="text-sm font-semibold text-white">My Routes</span>
          </Link>
          <div className="flex items-center gap-2">
            <span className="hidden text-xs text-gray-400 sm:block">{user.name}</span>
            <LogoutButton />
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
    <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold text-gray-900">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-gray-500">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getCurrentUser } from "@/lib/auth";
import { DriverShell } from "@/components/AppShell";
import type { SessionDto } from "@/lib/types";

export default async function DriverLayout({ children }: { children: ReactNode }) {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  // Admins may open driver views too — no role gate here.
  const sessionDto: SessionDto = {
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    mustChangePassword: user.mustChangePassword,
  };

  return <DriverShell user={sessionDto}>{children}</DriverShell>;
}

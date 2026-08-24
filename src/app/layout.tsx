import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: { default: "RoutePilot", template: "%s · RoutePilot" },
  description: "Shop route optimisation and driver management",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full">{children}</body>
    </html>
  );
}

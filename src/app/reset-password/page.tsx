"use client";

import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Button, Card, Field, Input, LoadingBlock } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client";

function ProductMark() {
  return (
    <div className="flex items-center justify-center gap-3">
      <div className="flex h-11 w-11 items-center justify-center rounded-full bg-ink text-white">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
          <path d="M6 20a2 2 0 100-4 2 2 0 000 4zm12-12a2 2 0 100-4 2 2 0 000 4zM8 18h7a4 4 0 000-8H9a4 4 0 010-4" />
        </svg>
      </div>
      <span className="text-[22px] font-bold tracking-tight text-ink">
        ROUTE<span className="text-brand">PILOT</span>
      </span>
    </div>
  );
}

function ResetPasswordInner() {
  const searchParams = useSearchParams();
  const token = searchParams.get("token");

  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (newPassword.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setError("Passwords do not match.");
      return;
    }
    if (!token) {
      setError("This reset link is missing its token. Request a new one from the sign in page.");
      return;
    }
    setLoading(true);
    try {
      await api("/api/auth/reset-password", {
        method: "POST",
        body: JSON.stringify({ token, newPassword }),
      });
      setDone(true);
    } catch (err) {
      setError(
        err instanceof ClientApiError
          ? err.message
          : "Unable to reset the password. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <ProductMark />
      <Card padded>
        {done ? (
          <div className="flex flex-col items-center gap-3 py-2 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
              <svg
                width="24"
                height="24"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2.2"
              >
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-900">Password updated</h2>
              <p className="mt-1 text-sm text-gray-500">
                Your password has been reset. You can now sign in with the new password.
              </p>
            </div>
            <Link href="/login" className="w-full">
              <Button type="button" className="w-full">
                Go to sign in
              </Button>
            </Link>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Reset your password</h2>
              <p className="mt-1 text-sm text-gray-500">
                Choose a new password for your account.
              </p>
            </div>
            {!token && (
              <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
                This reset link is invalid or incomplete. Request a new one from the{" "}
                <Link href="/login" className="font-medium text-brand hover:text-brand-strong">
                  sign in page
                </Link>
                .
              </div>
            )}
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}{" "}
                <Link href="/login" className="font-medium text-brand hover:text-brand-strong">
                  Back to sign in
                </Link>
              </div>
            )}
            <Field label="New password" required>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
                autoFocus
              />
            </Field>
            <Field label="Confirm new password" required>
              <Input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
              />
            </Field>
            <Button type="submit" loading={loading} disabled={!token} className="w-full">
              Reset password
            </Button>
            <p className="text-center text-sm">
              <Link href="/login" className="font-medium text-brand hover:text-brand-strong">
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </Card>
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <Suspense fallback={<LoadingBlock label="Loading…" />}>
        <ResetPasswordInner />
      </Suspense>
    </main>
  );
}

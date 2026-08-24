"use client";

import { Suspense, useState, type FormEvent } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, Card, Field, Input, LoadingBlock } from "@/components/ui";
import { api, ClientApiError } from "@/lib/client";
import type { SessionDto } from "@/lib/types";

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

function safeNext(next: string | null): string | null {
  if (!next) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;
  return next;
}

function LoginInner() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Post-login forced password change
  const [session, setSession] = useState<SessionDto | null>(null);
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [changeLoading, setChangeLoading] = useState(false);
  const [changeError, setChangeError] = useState<string | null>(null);

  // Forgot password
  const [showForgot, setShowForgot] = useState(false);
  const [forgotEmail, setForgotEmail] = useState("");
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);

  function redirectFor(user: SessionDto) {
    router.push(user.role === "ADMIN" ? (next ?? "/") : "/driver");
    router.refresh();
  }

  async function handleLogin(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const user = await api<SessionDto>("/api/auth/login", {
        method: "POST",
        body: JSON.stringify({ email, password }),
      });
      if (user.mustChangePassword) {
        setSession(user);
      } else {
        redirectFor(user);
        return;
      }
    } catch (err) {
      setError(
        err instanceof ClientApiError ? err.message : "Unable to sign in. Please try again.",
      );
    } finally {
      setLoading(false);
    }
  }

  async function handleChangePassword(e: FormEvent) {
    e.preventDefault();
    if (!session) return;
    setChangeError(null);
    if (newPassword.length < 8) {
      setChangeError("New password must be at least 8 characters.");
      return;
    }
    if (newPassword !== confirmPassword) {
      setChangeError("Passwords do not match.");
      return;
    }
    setChangeLoading(true);
    try {
      await api("/api/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: password, newPassword }),
      });
      redirectFor(session);
      return;
    } catch (err) {
      setChangeError(
        err instanceof ClientApiError
          ? err.message
          : "Unable to update the password. Please try again.",
      );
    } finally {
      setChangeLoading(false);
    }
  }

  async function handleForgot() {
    setForgotLoading(true);
    try {
      await api("/api/auth/forgot-password", {
        method: "POST",
        body: JSON.stringify({ email: forgotEmail }),
      });
    } catch {
      /* Response is intentionally identical whether or not the account exists. */
    } finally {
      setForgotLoading(false);
      setForgotSent(true);
    }
  }

  return (
    <div className="w-full max-w-sm space-y-6">
      <ProductMark />
      <Card padded>
        {session ? (
          <form onSubmit={handleChangePassword} className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Set a new password</h2>
              <p className="mt-1 text-sm text-gray-500">
                You must choose a new password before continuing.
              </p>
            </div>
            {changeError && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {changeError}
              </div>
            )}
            <Field label="Current password" required>
              <Input type="password" value={password} readOnly autoComplete="current-password" />
            </Field>
            <Field label="New password" required>
              <Input
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                minLength={8}
                required
                autoComplete="new-password"
                placeholder="At least 8 characters"
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
            <Button type="submit" loading={changeLoading} className="w-full">
              Update password and continue
            </Button>
          </form>
        ) : (
          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">Sign in</h2>
              <p className="mt-1 text-sm text-gray-500">Welcome back. Enter your details below.</p>
            </div>
            {error && (
              <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </div>
            )}
            <Field label="Email" required>
              <Input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
                autoComplete="email"
                placeholder="you@company.com"
                autoFocus
              />
            </Field>
            <Field label="Password" required>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                placeholder="Your password"
              />
            </Field>
            <Button type="submit" loading={loading} className="w-full">
              Sign in
            </Button>
            <div className="text-center">
              <button
                type="button"
                className="text-sm font-medium text-brand hover:text-brand-strong"
                onClick={() => {
                  setShowForgot((v) => !v);
                  setForgotSent(false);
                  setForgotEmail(email);
                }}
              >
                Forgot password?
              </button>
            </div>
            {showForgot && (
              <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
                {forgotSent ? (
                  <p className="text-sm text-gray-600">
                    If that account exists, a reset link has been sent.
                  </p>
                ) : (
                  <div className="space-y-3">
                    <Field label="Account email">
                      <Input
                        type="email"
                        value={forgotEmail}
                        onChange={(e) => setForgotEmail(e.target.value)}
                        placeholder="you@company.com"
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="secondary"
                      loading={forgotLoading}
                      disabled={!forgotEmail}
                      onClick={handleForgot}
                      className="w-full"
                    >
                      Send reset link
                    </Button>
                  </div>
                )}
              </div>
            )}
          </form>
        )}
      </Card>
      <p className="text-center text-xs text-gray-500">
        Sign in with your administrator or driver account
      </p>
    </div>
  );
}

export default function LoginPage() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-gray-100 p-4">
      <Suspense fallback={<LoadingBlock label="Loading…" />}>
        <LoginInner />
      </Suspense>
    </main>
  );
}

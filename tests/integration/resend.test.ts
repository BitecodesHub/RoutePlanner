import { describe, expect, it } from "vitest";
import { sendMail, driverWelcomeEmail } from "@/lib/mailer";

/**
 * Live Resend delivery test. Runs only when RESEND_API_KEY is present so CI
 * without the secret stays green. Uses Resend's official sandbox recipient
 * (delivered@resend.dev) and sender (onboarding@resend.dev) so it delivers
 * without a verified domain and sends real mail to no one.
 */
const hasKey = !!process.env.RESEND_API_KEY;

describe.runIf(hasKey)("Resend live delivery", () => {
  it("accepts a well-formed message via the HTTP API", async () => {
    const ok = await sendMail({
      to: "delivered@resend.dev",
      subject: "RoutePilot automated test",
      html: "<p>Automated integration test.</p>",
      text: "Automated integration test.",
    });
    expect(ok).toBe(true);
  });

  it("sends a real driver-welcome template", async () => {
    const msg = driverWelcomeEmail({
      to: "delivered@resend.dev",
      name: "Sandbox Driver",
      email: "delivered@resend.dev",
      tempPassword: "Test-Pass-123",
      loginUrl: "https://routepilot.bitecodes.com/login",
    });
    const ok = await sendMail(msg);
    expect(ok).toBe(true);
  });

  it("reports failure (not throw) for a rejected recipient", async () => {
    // example.com is a reserved domain Resend rejects — must fail gracefully.
    const ok = await sendMail({
      to: "nobody@example.com",
      subject: "should be rejected",
      html: "<p>x</p>",
      text: "x",
    });
    expect(ok).toBe(false);
  });
});

import { after } from "next/server";
import { sendMail, type MailMessage } from "@/lib/mailer";

/**
 * Send an email without blocking the response, but guaranteed to run to
 * completion. Plain `void sendMail(...)` is unsafe on serverless (Vercel):
 * the function is frozen once the HTTP response is sent, so a still-pending
 * fetch to the email provider is killed and the message never goes out.
 * `after()` registers the work with the runtime, which keeps the invocation
 * alive until it finishes. sendMail never throws, so failures are logged.
 *
 * Kept in its own module so `next/server` is imported only by request
 * handlers — never by the seed script or tests that call sendMail directly.
 */
export function queueMail(msg: MailMessage): void {
  after(async () => {
    await sendMail(msg);
  });
}

import nodemailer, { type Transporter } from "nodemailer";
import { env } from "@/lib/env";

/**
 * Email service. SMTP is configured entirely from environment variables;
 * when unset, messages are logged so development and tests never require
 * real credentials. Sending is fire-and-forget from callers' perspective —
 * a mail failure must never fail the business operation.
 */

let transporter: Transporter | null | undefined;

function getTransporter(): Transporter | null {
  if (transporter !== undefined) return transporter;
  const smtp = env.smtp;
  if (!smtp) {
    transporter = null;
    return transporter;
  }
  transporter = nodemailer.createTransport({
    host: smtp.host,
    port: smtp.port,
    secure: smtp.secure,
    auth: smtp.user ? { user: smtp.user, pass: smtp.pass } : undefined,
  });
  return transporter;
}

export interface MailMessage {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendMail(msg: MailMessage): Promise<boolean> {
  const t = getTransporter();
  if (!t) {
    console.info(`[mail:log-only] to=${msg.to} subject="${msg.subject}"`);
    return false;
  }
  try {
    await t.sendMail({ from: env.mailFrom, ...msg });
    return true;
  } catch (err) {
    console.error("[mail] send failed:", (err as Error).message);
    return false;
  }
}

/* ------------------------------ Templates ------------------------------ */

function layout(title: string, bodyHtml: string): string {
  return `<!doctype html><html><body style="font-family:Arial,Helvetica,sans-serif;background:#f4f5f7;margin:0;padding:24px">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:8px;overflow:hidden;border:1px solid #e2e4e8">
    <div style="background:#1d4ed8;color:#ffffff;padding:16px 24px;font-size:18px;font-weight:bold">Shop Route System</div>
    <div style="padding:24px">
      <h2 style="margin-top:0;font-size:16px;color:#111827">${title}</h2>
      ${bodyHtml}
    </div>
    <div style="padding:12px 24px;color:#6b7280;font-size:12px;border-top:1px solid #e2e4e8">This is an automated message. Please do not reply.</div>
  </div></body></html>`;
}

export function driverWelcomeEmail(opts: {
  to: string;
  name: string;
  email: string;
  tempPassword: string;
}): MailMessage {
  const loginUrl = `${env.appBaseUrl}/login`;
  return {
    to: opts.to,
    subject: "Your driver account is ready",
    text: `Hello ${opts.name},\n\nYour driver account has been created.\nLogin: ${loginUrl}\nEmail: ${opts.email}\nTemporary password: ${opts.tempPassword}\n\nYou will be asked to set a new password on first login.`,
    html: layout(
      `Welcome, ${opts.name}`,
      `<p>Your driver account has been created.</p>
       <p><strong>Login:</strong> <a href="${loginUrl}">${loginUrl}</a><br/>
       <strong>Email:</strong> ${opts.email}<br/>
       <strong>Temporary password:</strong> <code>${opts.tempPassword}</code></p>
       <p>You will be asked to set a new password on first login.</p>`,
    ),
  };
}

export function routeAssignedEmail(opts: {
  to: string;
  driverName: string;
  routeName: string;
  stopCount: number;
  distanceText: string;
  durationText: string;
  shareUrl: string;
  scheduledFor?: string;
}): MailMessage {
  return {
    to: opts.to,
    subject: `New route assigned: ${opts.routeName}`,
    text: `Hello ${opts.driverName},\n\nYou have been assigned the route "${opts.routeName}" (${opts.stopCount} stops, ${opts.distanceText}, approx. ${opts.durationText}).${opts.scheduledFor ? `\nScheduled for: ${opts.scheduledFor}` : ""}\nOpen your route: ${opts.shareUrl}`,
    html: layout(
      "New route assigned",
      `<p>Hello ${opts.driverName},</p>
       <p>You have been assigned the route <strong>${opts.routeName}</strong>.</p>
       <ul><li>${opts.stopCount} stops</li><li>${opts.distanceText}</li><li>Approx. ${opts.durationText}</li>${opts.scheduledFor ? `<li>Scheduled for ${opts.scheduledFor}</li>` : ""}</ul>
       <p><a href="${opts.shareUrl}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Open route</a></p>`,
    ),
  };
}

export function routeStatusEmail(opts: {
  to: string;
  routeName: string;
  status: string;
  detail?: string;
}): MailMessage {
  return {
    to: opts.to,
    subject: `Route ${opts.status.toLowerCase()}: ${opts.routeName}`,
    text: `Route "${opts.routeName}" is now ${opts.status}.${opts.detail ? `\n${opts.detail}` : ""}`,
    html: layout(
      `Route ${opts.status.toLowerCase()}`,
      `<p>Route <strong>${opts.routeName}</strong> is now <strong>${opts.status}</strong>.</p>${opts.detail ? `<p>${opts.detail}</p>` : ""}`,
    ),
  };
}

export function passwordResetEmail(opts: { to: string; name: string; resetUrl: string }): MailMessage {
  return {
    to: opts.to,
    subject: "Password reset request",
    text: `Hello ${opts.name},\n\nA password reset was requested for your account. Open the link below within 1 hour to set a new password:\n${opts.resetUrl}\n\nIf you did not request this, you can ignore this email.`,
    html: layout(
      "Password reset",
      `<p>Hello ${opts.name},</p>
       <p>A password reset was requested for your account. The link below is valid for 1 hour.</p>
       <p><a href="${opts.resetUrl}" style="background:#1d4ed8;color:#fff;padding:10px 18px;border-radius:6px;text-decoration:none;display:inline-block">Set a new password</a></p>
       <p>If you did not request this, you can ignore this email.</p>`,
    ),
  };
}

function required(name: string, fallback?: string): string {
  const v = process.env[name] ?? fallback;
  if (v === undefined || v === "") {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return v;
}

export const env = {
  get authSecret() {
    return required("AUTH_SECRET");
  },
  get appBaseUrl() {
    return process.env.APP_BASE_URL || "http://localhost:3000";
  },
  get osrmBaseUrl() {
    return process.env.OSRM_BASE_URL || "https://router.project-osrm.org";
  },
  get nominatimBaseUrl() {
    return process.env.NOMINATIM_BASE_URL || "https://nominatim.openstreetmap.org";
  },
  get smtp() {
    const host = process.env.SMTP_HOST;
    if (!host) return null;
    return {
      host,
      port: Number(process.env.SMTP_PORT || 587),
      secure: process.env.SMTP_SECURE === "true",
      user: process.env.SMTP_USER || "",
      pass: process.env.SMTP_PASS || "",
    };
  },
  get mailFrom() {
    return process.env.MAIL_FROM || "Route System <no-reply@localhost>";
  },
};

import nodemailer from "nodemailer";
import { resolveMailConfig, type MailConfig } from "./channel-settings";

type PasswordResetEmailInput = {
  to: string;
  code: string;
  expiresInMinutes: number;
  appName?: string;
};

type MailTransporter = {
  sendMail(options: {
    from?: string;
    to?: string;
    subject?: string;
    text?: string;
    html?: string;
  }): Promise<unknown>;
};

const appBaseUrl = process.env.APP_BASE_URL?.trim() || process.env.PUBLIC_APP_URL?.trim() || "";

/**
 * Cached against the exact settings it was built from. The credentials can now
 * be edited from the admin screen, so a transporter built from the old ones has
 * to be dropped the moment they change rather than living for the process.
 */
let cached: { signature: string; transporter: MailTransporter } | null = null;

function buildTransporter(config: MailConfig): MailTransporter {
  const signature = JSON.stringify([config.host, config.port, config.secure, config.requireAuth, config.user, config.pass, config.from]);
  if (cached?.signature === signature) return cached.transporter;

  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.requireAuth ? { user: config.user, pass: config.pass } : undefined,
  }) as MailTransporter;

  cached = { signature, transporter };
  return transporter;
}

async function getTransporter() {
  const config = await resolveMailConfig();
  if (!config) {
    throw new Error("لم تُضبط إعدادات البريد (SMTP) — اضبطها من صفحة الإدارة");
  }
  return { transporter: buildTransporter(config), config };
}

export async function canSendMail() {
  return Boolean(await resolveMailConfig());
}

/** Delivers with whatever credentials are configured right now, so the admin
 *  screen can prove a saved SMTP setup works before relying on it. */
export async function sendTestEmail(to: string) {
  const { transporter, config } = await getTransporter();
  await transporter.sendMail({
    from: config.from,
    to,
    subject: "اختبار بريد التزام",
    text: "وصلتك هذه الرسالة، فإعدادات البريد تعمل.",
  });
}

/** A plain notification email. Kept separate from the reset flow so reminders
 *  do not inherit that message's security wording. */
export async function sendPlainEmail(input: { to: string; subject: string; text: string }) {
  const { transporter, config } = await getTransporter();
  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.8; color: #0f172a; max-width: 640px; margin: 0 auto;">
      <h2 style="margin-bottom: 12px;">التزام</h2>
      <p style="white-space: pre-line;">${input.text.replace(/</g, "&lt;")}</p>
      ${appBaseUrl ? `<p><a href="${appBaseUrl.replace(/\/$/, "")}/commitments" style="color:#2563eb;">افتح التطبيق</a></p>` : ""}
    </div>
  `;

  await transporter.sendMail({
    from: config.from,
    to: input.to,
    subject: input.subject,
    text: input.text,
    html,
  });
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
  const { transporter, config } = await getTransporter();
  const appName = input.appName || "التزام";
  const subject = `رمز إعادة تعيين كلمة المرور - ${appName}`;
  const resetUrl = appBaseUrl ? `${appBaseUrl.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(input.code)}` : "";
  const resetPageHint = resetUrl || "صفحة إعادة تعيين كلمة المرور";

  const text = [
    `مرحباً،`,
    ``,
    `رمز إعادة تعيين كلمة المرور الخاص بك هو: ${input.code}`,
    `مدة صلاحية الرمز: ${input.expiresInMinutes} دقيقة.`,
    ``,
    `إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة.`,
    resetUrl ? `رابط إعادة التعيين: ${resetUrl}` : `أكمل الاستعادة من: ${resetPageHint}`,
  ].join("\n");

  const html = `
    <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.8; color: #0f172a; max-width: 640px; margin: 0 auto;">
      <h2 style="margin-bottom: 16px;">${appName}</h2>
      <p>مرحباً،</p>
      <p>رمز إعادة تعيين كلمة المرور الخاص بك هو:</p>
      <div style="font-size: 32px; font-weight: 700; letter-spacing: 6px; padding: 16px 20px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px; display: inline-block; margin: 8px 0 16px;">${input.code}</div>
      <p>مدة صلاحية الرمز: <strong>${input.expiresInMinutes} دقيقة</strong>.</p>
      <p>إذا لم تطلب إعادة تعيين كلمة المرور، يمكنك تجاهل هذه الرسالة.</p>
      ${resetUrl ? `<p><a href="${resetUrl}" style="display:inline-block;padding:12px 18px;background:#2563eb;color:#fff;text-decoration:none;border-radius:10px;font-weight:700;">فتح صفحة إعادة التعيين</a></p><p style="word-break:break-all;color:#475569;">${resetUrl}</p>` : `<p>أكمل الاستعادة من: <strong>${resetPageHint}</strong></p>`}
    </div>
  `;

  await transporter.sendMail({
    from: config.from,
    to: input.to,
    subject,
    text,
    html,
  });
}

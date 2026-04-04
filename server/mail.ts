import nodemailer from "nodemailer";

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

const smtpHost = process.env.SMTP_HOST?.trim() || "";
const smtpPort = Number(process.env.SMTP_PORT || 587);
const smtpSecure = process.env.SMTP_SECURE === "true";
const smtpUser = process.env.SMTP_USER?.trim() || "";
const smtpPass = process.env.SMTP_PASS?.trim() || "";
const smtpFrom = process.env.SMTP_FROM?.trim() || smtpUser;
const smtpRequireAuth = process.env.SMTP_REQUIRE_AUTH !== "false";
const appBaseUrl = process.env.APP_BASE_URL?.trim() || "";

let transporterPromise: Promise<MailTransporter> | null = null;

function isMailConfigured() {
  return Boolean(smtpHost && smtpPort && smtpFrom && (!smtpRequireAuth || (smtpUser && smtpPass)));
}

async function getTransporter() {
  if (!isMailConfigured()) {
    throw new Error("SMTP is not configured");
  }

  if (!transporterPromise) {
    transporterPromise = Promise.resolve(nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpSecure,
      auth: smtpRequireAuth ? { user: smtpUser, pass: smtpPass } : undefined,
    }));
  }

  return transporterPromise;
}

export function canSendMail() {
  return isMailConfigured();
}

export async function sendPasswordResetEmail(input: PasswordResetEmailInput) {
  const transporter = await getTransporter();
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
    from: smtpFrom,
    to: input.to,
    subject,
    text,
    html,
  });
}

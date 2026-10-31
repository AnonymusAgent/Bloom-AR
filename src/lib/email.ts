import nodemailer from 'nodemailer';

// Configure transporter - uses env vars, falls back to ethereal for dev
let transporter: nodemailer.Transporter | null = null;

async function getTransporter() {
  if (transporter) return transporter;

  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587');
  const smtpUser = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;

  if (host && smtpUser && pass) {
    transporter = nodemailer.createTransport({ host, port, secure: port === 465, auth: { user: smtpUser, pass } });
  } else {
    // Dev/demo mode - log emails instead of sending
    transporter = nodemailer.createTransport({ jsonTransport: true });
  }

  return transporter;
}

export interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text?: string;
}

export function isEmailConfigured(): boolean {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

export async function sendEmail(
  options: EmailOptions
): Promise<{ success: boolean; configured: boolean; messageId?: string; preview?: unknown }> {
  if (!isEmailConfigured()) {
    console.log('[Email Not Configured] Skipping SMTP send:', { to: options.to, subject: options.subject });
    return { success: false, configured: false };
  }
  try {
    const t = await getTransporter();
    const from = process.env.SMTP_FROM || 'BloomAR Manager <noreply@bloomar.com>';

    const result = await t.sendMail({
      from,
      to: options.to,
      subject: options.subject,
      html: options.html,
      text: options.text,
    });

    return {
      success: true,
      configured: true,
      messageId: result.messageId,
      preview: result.message ? JSON.parse(result.message) : undefined,
    };
  } catch (error) {
    console.error('Email send error:', error);
    return { success: false, configured: true };
  }
}

export function buildDigestHtml(data: {
  userName: string;
  pendingClaims: number;
  pendingAuths: number;
  pendingTasks: number;
  deniedClaims: number;
  pendingReviews: number;
  overdueTasks: number;
  recentNotifications: Array<{ title: string; message: string; createdAt: string }>;
}): string {
  return `
<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#f1f5f9;margin:0;padding:20px;">
<div style="max-width:600px;margin:0 auto;background:white;border-radius:12px;overflow:hidden;box-shadow:0 1px 3px rgba(0,0,0,.1);">
  <div style="background:linear-gradient(135deg,#2563eb,#1d4ed8);color:white;padding:24px 32px;">
    <h1 style="margin:0;font-size:22px;">BloomAR Manager Daily Digest</h1>
    <p style="margin:8px 0 0;opacity:.85;">Hello, ${data.userName}</p>
  </div>
  <div style="padding:24px 32px;">
    <h2 style="color:#1e293b;font-size:16px;margin:0 0 16px;">📊 Your Dashboard Summary</h2>
    <table style="width:100%;border-collapse:collapse;">
      <tr>
        <td style="padding:12px;background:#eff6ff;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:28px;font-weight:700;color:#2563eb;">${data.pendingClaims}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Pending Claims</div>
        </td>
        <td style="padding:12px;background:#fef3c7;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:28px;font-weight:700;color:#d97706;">${data.pendingAuths}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Pending Auths</div>
        </td>
        <td style="padding:12px;background:#fef2f2;border-radius:8px;text-align:center;width:33%;">
          <div style="font-size:28px;font-weight:700;color:#dc2626;">${data.deniedClaims}</div>
          <div style="font-size:12px;color:#64748b;margin-top:4px;">Denied Claims</div>
        </td>
      </tr>
    </table>
    ${data.pendingReviews > 0 ? `<div style="margin-top:16px;padding:12px 16px;background:#fef3c7;border-left:4px solid #f59e0b;border-radius:4px;"><strong>⚠️ ${data.pendingReviews} claim(s)</strong> pending your review</div>` : ''}
    ${data.overdueTasks > 0 ? `<div style="margin-top:8px;padding:12px 16px;background:#fef2f2;border-left:4px solid #ef4444;border-radius:4px;"><strong>🔴 ${data.overdueTasks} task(s)</strong> overdue</div>` : ''}
    ${data.recentNotifications.length > 0 ? `
    <h3 style="color:#1e293b;font-size:14px;margin:20px 0 12px;">Recent Activity</h3>
    ${data.recentNotifications.slice(0, 5).map(n => `<div style="padding:8px 0;border-bottom:1px solid #f1f5f9;"><strong style="font-size:13px;">${n.title}</strong><br><span style="font-size:12px;color:#64748b;">${n.message}</span></div>`).join('')}` : ''}
  </div>
  <div style="padding:16px 32px;background:#f8fafc;text-align:center;font-size:12px;color:#94a3b8;">
    Made with ❤️ by WebLoom | © ${new Date().getFullYear()} Web Loom LLC
  </div>
</div>
</body></html>`;
}

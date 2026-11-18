import nodemailer from 'nodemailer';
import { pool } from '../config/database';
import { databaseScope } from '../config/database-scope';
import { generateBookingIcs } from './ics';

export interface SmtpRuntimeConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  from_email: string;
  from_name: string;
  source: 'database' | 'env' | 'unconfigured';
}

let cachedDbSmtp: SmtpRuntimeConfig | null = null;
let lastLoadedAt = 0;

function normalizeSmtpPassword(host: string, rawPass: string): string {
  const trimmed = String(rawPass || '').trim();
  return host.toLowerCase().includes('gmail.com') ? trimmed.replace(/\s+/g, '') : trimmed;
}

export async function refreshSmtpSettingsCache(): Promise<SmtpRuntimeConfig> {
  try {
    const res = await databaseScope.run({ service: true }, () =>
      pool.query(`SELECT * FROM platform_smtp_settings WHERE id = 1`)
    );
    const row = res.rows[0];
    if (row && row.enabled && row.host && row.username && row.password) {
      cachedDbSmtp = {
        enabled: true,
        host: String(row.host).trim(),
        port: Number(row.port || 587),
        secure: Boolean(row.secure),
        username: String(row.username).trim(),
        password: normalizeSmtpPassword(String(row.host), String(row.password)),
        from_email: row.from_email || row.username,
        from_name: row.from_name || 'Hệ Thống Đặt Sân Thể Thao',
        source: 'database',
      };
      lastLoadedAt = Date.now();
      return cachedDbSmtp;
    }
  } catch {
    // Fallback to environment variables if table not yet queried
  }

  if (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS) {
    const port = parseInt(process.env.SMTP_PORT || '587', 10);
    cachedDbSmtp = {
      enabled: true,
      host: process.env.SMTP_HOST.trim(),
      port,
      secure: process.env.SMTP_SECURE !== undefined ? process.env.SMTP_SECURE === 'true' : port === 465,
      username: process.env.SMTP_USER.trim(),
      password: normalizeSmtpPassword(process.env.SMTP_HOST, process.env.SMTP_PASS),
      from_email: process.env.SMTP_FROM || process.env.SMTP_USER.trim(),
      from_name: process.env.SMTP_FROM_NAME || 'Hệ Thống Đặt Sân Thể Thao',
      source: 'env',
    };
  } else {
    cachedDbSmtp = {
      enabled: false,
      host: '',
      port: 587,
      secure: false,
      username: '',
      password: '',
      from_email: process.env.SMTP_FROM || 'noreply@sportscourt.vn',
      from_name: 'Sports Court Booking',
      source: 'unconfigured',
    };
  }
  lastLoadedAt = Date.now();
  return cachedDbSmtp;
}

export function isSmtpConfigured(): boolean {
  if (cachedDbSmtp && Date.now() - lastLoadedAt < 60_000) {
    return cachedDbSmtp.enabled;
  }
  return Boolean(
    (cachedDbSmtp && cachedDbSmtp.enabled) ||
      (process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS)
  );
}

export async function getActiveSmtpConfig(): Promise<SmtpRuntimeConfig> {
  if (!cachedDbSmtp || Date.now() - lastLoadedAt > 30_000) {
    return refreshSmtpSettingsCache();
  }
  return cachedDbSmtp;
}

export function buildTransporterFromConfig(cfg: SmtpRuntimeConfig) {
  return nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.username,
      pass: cfg.password,
    },
    tls: {
      rejectUnauthorized: process.env.SMTP_REJECT_UNAUTHORIZED !== 'false',
    },
  });
}

export async function sendDirectSmtpTestEmail(recipient: string, lang: 'vi' | 'en' = 'vi') {
  const cfg = await refreshSmtpSettingsCache();
  if (!cfg.enabled) {
    throw new Error('SMTP_NOT_CONFIGURED');
  }
  const transporter = buildTransporterFromConfig(cfg);
  await transporter.verify();
  const fromHeader = cfg.from_email.includes('<')
    ? cfg.from_email
    : `"${cfg.from_name.replace(/"/g, '')}" <${cfg.from_email}>`;

  const info = await transporter.sendMail({
    from: fromHeader,
    to: recipient,
    subject:
      lang === 'en'
        ? '[SMTP Verified] Sports Court Booking Live Mail Delivery'
        : '[Xác nhận SMTP] Kết nối gửi Email thật thành công',
    text:
      lang === 'en'
        ? 'Your SMTP server is verified and actively delivering transactional emails.'
        : 'Máy chủ SMTP của hệ thống đã được xác minh và sẵn sàng gửi email giao dịch thật.',
    html: `<div style="font-family:Arial,sans-serif;max-width:560px;margin:0 auto;background:#1B1B1F;color:#E4E4E7;padding:24px;border-radius:14px;border:1px solid #2E2E35">
      <h2 style="color:#00C070;margin-top:0">${lang === 'en' ? 'SMTP Connection Verified' : 'Kết Nối SMTP Thành Công'}</h2>
      <p>${lang === 'en' ? 'Your Sports Court Booking Platform can now deliver live OTPs, booking confirmations, and calendar (.ics) attachments.' : 'Hệ thống Đặt Sân Thể Thao đã kết nối máy chủ SMTP thành công và sẵn sàng gửi mã OTP, xác nhận đặt sân kèm file lịch (.ics).'}</p>
    </div>`,
  });
  return { messageId: info.messageId, source: cfg.source, host: cfg.host };
}

function escapeHtml(raw: unknown): string {
  return String(raw ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatCurrencyVnd(amount: number, lang: 'vi' | 'en' = 'vi'): string {
  const safe = Math.round(Number(amount) || 0);
  if (lang === 'vi') {
    return new Intl.NumberFormat('vi-VN').format(safe) + ' ₫';
  }
  return new Intl.NumberFormat('en-US').format(safe) + ' VND';
}

/**
 * Render HTML & Plain text email based on template type (Section 17.2 & 26.7, F-10)
 * Escapes all user-supplied variables and never logs OTP secrets.
 */
export function renderEmailTemplate(
  templateType: string,
  lang: 'vi' | 'en',
  data: Record<string, any>
): { subject: string; text: string; html: string; icsAttachment?: string } {
  const isEn = lang === 'en';
  const safeUser = escapeHtml(data.username || data.customer_name || (isEn ? 'Customer' : 'Quý khách'));
  const safeOtp = escapeHtml(data.otp || '');
  const safeCode = escapeHtml(data.booking_code || '');
  const safeVenue = escapeHtml(data.venue_name || '');
  const safeAddress = escapeHtml(data.venue_address || '');
  const safeCourt = escapeHtml(data.court_name || '');
  const safeTime = escapeHtml(data.time_str || '');

  switch (templateType) {
    case 'REGISTER_OTP': {
      const subject = isEn
        ? `[Verification Code] Account verification code`
        : `[Mã xác thực] Mã xác thực tài khoản`;
      const text = isEn
        ? `Hello ${data.username || ''},\nYour 6-digit verification code is: ${data.otp}\nValid for 10 minutes. Never share this code with anyone.`
        : `Xin chào ${data.username || ''},\nMã xác thực OTP 6 chữ số của bạn là: ${data.otp}\nMã có hiệu lực trong 10 phút. Tuyệt đối không chia sẻ mã này.`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1B1B1F; color: #E4E4E7; border: 1px solid #2E2E35; border-radius: 14px; padding: 28px;">
          <div style="background-color: #00A862; color: #04210F; padding: 12px 20px; border-radius: 10px; font-size: 18px; font-weight: bold;">
            ${isEn ? 'Sports Court Booking Platform' : 'Hệ Thống Đặt Sân Thể Thao'}
          </div>
          <p style="font-size: 16px; margin-top: 20px;">${isEn ? `Hello <b>${safeUser}</b>,` : `Xin chào <b>${safeUser}</b>,`}</p>
          <p>${isEn ? 'Your 6-digit verification code is:' : 'Mã xác thực 6 chữ số của bạn là:'}</p>
          <div style="background-color: #25252A; border: 2px dashed #00A862; color: #00C070; font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; border-radius: 10px; margin: 20px 0;">
            ${safeOtp}
          </div>
          <p style="color: #A1A1AA; font-size: 13px;">${isEn ? 'Valid for 10 minutes. Never share this code with anyone.' : 'Mã có hiệu lực trong 10 phút. Tuyệt đối không chia sẻ mã này cho bất kỳ ai.'}</p>
        </div>
      `;
      return { subject, text, html };
    }

    case 'RESET_PASSWORD_OTP': {
      const subject = isEn
        ? `[Security] Password recovery verification code`
        : `[Bảo mật] Mã xác thực khôi phục mật khẩu`;
      const text = isEn
        ? `Your password reset verification code is: ${data.otp}\nValid for 10 minutes.`
        : `Mã đặt lại mật khẩu của bạn là: ${data.otp}\nCó hiệu lực trong 10 phút.`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1B1B1F; color: #E4E4E7; border: 1px solid #2E2E35; border-radius: 14px; padding: 28px;">
          <h2 style="color: #F87171; margin-top: 0;">${isEn ? 'Password Reset Request' : 'Yêu Cầu Đặt Lại Mật Khẩu'}</h2>
          <p>${isEn ? 'Your verification code is:' : 'Mã xác thực của bạn là:'}</p>
          <div style="background-color: #25252A; border: 2px dashed #F87171; color: #FCA5A5; font-size: 32px; font-weight: bold; letter-spacing: 8px; text-align: center; padding: 16px; border-radius: 10px; margin: 20px 0;">
            ${safeOtp}
          </div>
          <p style="color: #A1A1AA; font-size: 13px;">${isEn ? 'If you did not request this, ignore this email.' : 'Nếu bạn không yêu cầu thao tác này, vui lòng bỏ qua email.'}</p>
        </div>
      `;
      return { subject, text, html };
    }

    case 'BOOKING_CONFIRMED': {
      const totalStr = formatCurrencyVnd(data.total_amount || 0, lang);
      const depositStr = formatCurrencyVnd(data.paid_amount ?? data.deposit_amount ?? 0, lang);
      const dueStr = formatCurrencyVnd(data.due_at_venue || 0, lang);

      const subject = isEn
        ? `[Confirmed] ${data.court_name || 'Court'} · ${data.booking_code}`
        : `[Đã xác nhận] ${data.court_name || 'Sân thể thao'} · Mã ${data.booking_code}`;

      const text = isEn
        ? `Hello ${data.customer_name || ''},\nYour booking ${data.booking_code} is confirmed.\nVenue: ${data.venue_name || ''}\nCourt: ${data.court_name || ''}\nTime: ${data.time_str || ''}\nTotal: ${totalStr}\nPaid: ${depositStr}\nDue at venue: ${dueStr}`
        : `Xin chào ${data.customer_name || ''},\nLịch đặt sân ${data.booking_code} đã được xác nhận.\nCơ sở: ${data.venue_name || ''}\nSân: ${data.court_name || ''}\nThời gian: ${data.time_str || ''}\nTổng cộng: ${totalStr}\nĐã thanh toán: ${depositStr}\nCòn thu tại sân: ${dueStr}`;

      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1B1B1F; color: #E4E4E7; border: 1px solid #2E2E35; border-radius: 14px; padding: 28px;">
          <div style="background-color: #00A862; color: #04210F; padding: 16px; border-radius: 10px; text-align: center;">
            <h2 style="margin: 0;">${isEn ? 'Booking Confirmed' : 'Đặt Sân Thành Công'}</h2>
            <p style="margin: 6px 0 0 0; font-size: 18px; font-weight: bold; letter-spacing: 2px;">${safeCode}</p>
          </div>
          <div style="margin-top: 20px; line-height: 1.7;">
            <p><strong>${isEn ? 'Venue' : 'Cơ sở'}:</strong> ${safeVenue}</p>
            <p><strong>${isEn ? 'Address' : 'Địa chỉ'}:</strong> ${safeAddress}</p>
            <p><strong>${isEn ? 'Court' : 'Sân'}:</strong> ${safeCourt}</p>
            <p><strong>${isEn ? 'Time' : 'Thời gian'}:</strong> ${safeTime} (GMT+7)</p>
          </div>
          <hr style="border: 0; border-top: 1px solid #2E2E35; margin: 20px 0;">
          <table style="width: 100%; border-collapse: collapse;">
            <tr><td>${isEn ? 'Total Cost' : 'Tổng chi phí'}:</td><td style="text-align: right; font-weight: bold;">${totalStr}</td></tr>
            <tr><td>${isEn ? 'Paid' : 'Đã thanh toán'}:</td><td style="text-align: right; color: #00C070; font-weight: bold;">${depositStr}</td></tr>
            <tr><td>${isEn ? 'Due at venue' : 'Còn trả tại sân'}:</td><td style="text-align: right; color: #F59E0B; font-weight: bold;">${dueStr}</td></tr>
          </table>
        </div>
      `;

      let icsAttachment: string | undefined;
      if (data.start_at && data.end_at) {
        icsAttachment = generateBookingIcs({
          bookingCode: String(data.booking_code || ''),
          venueName: String(data.venue_name || 'Sports Venue'),
          venueAddress: String(data.venue_address || ''),
          courtName: String(data.court_name || 'Court'),
          startAt: new Date(data.start_at),
          endAt: new Date(data.end_at),
          customerName: String(data.customer_name || 'Customer'),
          language: lang,
        });
      }

      return { subject, text, html, icsAttachment };
    }

    case 'BOOKING_CANCELLED': {
      const refundStr = formatCurrencyVnd(data.refund_amount || 0, lang);
      const subject = isEn
        ? `[Cancelled] Booking ${data.booking_code}`
        : `[Đã hủy lịch] Mã đặt sân ${data.booking_code}`;
      const text = isEn
        ? `Booking ${data.booking_code} (${data.court_name || ''}) has been cancelled. Eligible refund: ${refundStr} (${data.refund_percent ?? 0}%).`
        : `Lịch đặt sân ${data.booking_code} (${data.court_name || ''}) đã được hủy. Số tiền hoàn cọc theo chính sách: ${refundStr} (${data.refund_percent ?? 0}%).`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1B1B1F; color: #E4E4E7; border: 1px solid #2E2E35; border-radius: 14px; padding: 28px;">
          <h2 style="color: #F87171; margin-top: 0;">${isEn ? 'Booking Cancelled' : 'Xác Nhận Hủy Đặt Sân'} — ${safeCode}</h2>
          <p><strong>${isEn ? 'Court' : 'Sân'}:</strong> ${safeCourt} (${safeVenue})</p>
          <p><strong>${isEn ? 'Refund Amount' : 'Tiền hoàn theo chính sách'}:</strong> <span style="color: #00C070; font-weight: bold;">${refundStr}</span> (${Number(data.refund_percent ?? 0)}%)</p>
        </div>
      `;
      return { subject, text, html };
    }

    case 'BOOKING_RESCHEDULED': {
      const subject = isEn
        ? `[Rescheduled] New Code ${data.booking_code}`
        : `[Đã dời lịch] Mã mới ${data.booking_code}`;
      const text = isEn
        ? `Your booking has been rescheduled from ${data.old_booking_code} to ${data.booking_code} (${data.court_name}, ${data.time_str}).`
        : `Lịch của bạn đã được dời từ mã ${data.old_booking_code} sang mã mới ${data.booking_code} (${data.court_name}, ${data.time_str}).`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1B1B1F; color: #E4E4E7; border: 1px solid #2E2E35; border-radius: 14px; padding: 28px;">
          <h2 style="color: #00C070; margin-top: 0;">${isEn ? 'Booking Rescheduled' : 'Dời Lịch Đặt Sân Thành Công'}</h2>
          <p>${isEn ? 'New Booking Code' : 'Mã đặt sân mới'}: <strong>${safeCode}</strong></p>
          <p>${isEn ? 'Court' : 'Sân'}: <strong>${safeCourt}</strong> — ${safeTime}</p>
        </div>
      `;
      return { subject, text, html };
    }

    case 'WEATHER_CLOSURE': {
      const reason = escapeHtml(data.reason || '');
      const resolution = escapeHtml(data.resolution_label || '');
      const subject = isEn
        ? `[Weather Notice] Outdoor court closure — ${data.booking_code}`
        : `[Thông báo thời tiết] Tạm đóng sân ngoài trời — ${data.booking_code}`;
      const text = isEn
        ? `Booking ${data.booking_code} at ${data.venue_name} is affected by weather closure (${data.reason || ''}). Resolution: ${data.resolution_label || ''}.`
        : `Lịch đặt ${data.booking_code} tại ${data.venue_name} bị ảnh hưởng do thời tiết (${data.reason || ''}). Phương án hỗ trợ: ${data.resolution_label || ''}.`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1B1B1F; color: #E4E4E7; border: 1px solid #2E2E35; border-radius: 14px; padding: 28px;">
          <h2 style="color: #F59E0B; margin-top: 0;">${isEn ? 'Weather Closure Notice' : 'Thông Báo Đóng Sân Do Thời Tiết'}</h2>
          <p><strong>${isEn ? 'Booking' : 'Mã đặt sân'}:</strong> ${safeCode} (${safeCourt})</p>
          <p><strong>${isEn ? 'Reason' : 'Lý do'}:</strong> ${reason}</p>
          <p><strong>${isEn ? 'Support Resolution' : 'Phương án xử lý'}:</strong> <span style="color:#00C070;font-weight:bold">${resolution}</span></p>
        </div>
      `;
      return { subject, text, html };
    }

    case 'MARKETING_CAMPAIGN': {
      const subject = String(isEn ? data.subject_en || data.subject_vi : data.subject_vi || data.subject_en || 'Ưu đãi sân thể thao');
      const bodyContent = escapeHtml(isEn ? data.body_en || data.body_vi : data.body_vi || data.body_en || '');
      const unsubUrl = escapeHtml(data.unsubscribe_url || '#');
      const text = `${isEn ? data.body_en || data.body_vi : data.body_vi || data.body_en}\n\n---\n${isEn ? 'Unsubscribe immediately:' : 'Hủy nhận tin quảng cáo ngay:'} ${data.unsubscribe_url || ''}`;
      const html = `
        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; background: #1B1B1F; color: #E4E4E7; border: 1px solid #2E2E35; border-radius: 14px; padding: 28px;">
          <h2 style="color: #00C070; margin-top: 0;">${escapeHtml(subject)}</h2>
          <p style="line-height: 1.7; white-space: pre-line;">${bodyContent}</p>
          <hr style="border: 0; border-top: 1px solid #2E2E35; margin: 24px 0;">
          <p style="font-size: 12px; color: #A1A1AA;">
            ${isEn ? 'You received this because you opted in to venue offers.' : 'Bạn nhận được tin này vì đã đăng ký nhận ưu đãi từ cơ sở.'}
            <a href="${unsubUrl}" style="color: #00C070; margin-left: 6px;">${isEn ? 'Unsubscribe immediately' : 'Hủy nhận tin ngay'}</a>
          </p>
        </div>
      `;
      return { subject, text, html };
    }

    default:
      return {
        subject: isEn ? `[Notification] Sports Court Booking` : `[Thông báo] Hệ Thống Đặt Sân Thể Thao`,
        text: isEn ? 'You have a new notification from Sports Court Booking.' : 'Bạn có thông báo mới từ Hệ Thống Đặt Sân Thể Thao.',
        html: `<p>${isEn ? 'You have a new notification.' : 'Bạn có thông báo mới.'}</p>`,
      };
  }
}

/**
 * Dispatch an email from email_outbox safely without logging sensitive subjects/codes (F-10)
 */
export async function dispatchQueuedEmail(outboxId: string): Promise<boolean> {
  const res = await pool.query(`SELECT * FROM email_outbox WHERE id = $1`, [outboxId]);
  if (res.rows.length === 0) return false;

  const item = res.rows[0];
  if (item.status === 'SENT') return true;

  const rendered = renderEmailTemplate(item.template_type, item.language || 'vi', item.template_data || {});
  const cfg = await getActiveSmtpConfig();

  try {
    const attachments: any[] = [];
    if (rendered.icsAttachment) {
      attachments.push({
        filename: `booking-${item.template_data?.booking_code || 'calendar'}.ics`,
        content: rendered.icsAttachment,
        contentType: 'text/calendar; charset=utf-8; method=REQUEST',
      });
    }

    if (cfg.enabled) {
      const activeTransporter = buildTransporterFromConfig(cfg);
      const fromHeader = cfg.from_email.includes('<')
        ? cfg.from_email
        : `"${cfg.from_name.replace(/"/g, '')}" <${cfg.from_email}>`;
      const info = await activeTransporter.sendMail({
        from: fromHeader,
        to: item.recipient,
        subject: rendered.subject,
        text: rendered.text,
        html: rendered.html,
        attachments,
      });

      await pool.query(
        `UPDATE email_outbox
         SET status = 'SENT', provider_message_id = $1, sent_at = NOW(), claimed_at = NULL, last_error = NULL
         WHERE id = $2`,
        [info.messageId, outboxId]
      );
      console.log(`[Email] Dispatched template=${item.template_type} msgId=${info.messageId}`);
      return true;
    } else {
      await pool.query(
        `UPDATE email_outbox
         SET status = 'FAILED', attempt_count = attempt_count + 1, retry_count = retry_count + 1,
             claimed_at = NULL, last_error = 'SMTP_NOT_CONFIGURED'
         WHERE id = $1`,
        [outboxId]
      );
      return false;
    }
  } catch (err: any) {
    const safeError = String(err.code || err.message || 'SEND_ERROR').slice(0, 200);
    console.error(`[Email:Failed] outbox=${outboxId} template=${item.template_type}:`, safeError);
    await pool.query(
      `UPDATE email_outbox
       SET status = CASE WHEN attempt_count + 1 >= 5 THEN 'FAILED'::email_status ELSE 'QUEUED'::email_status END,
           attempt_count = attempt_count + 1,
           retry_count = retry_count + 1,
           claimed_at = NULL,
           last_error = $2,
           next_attempt_at = NOW() + (POWER(2, LEAST(attempt_count + 1, 5)) * INTERVAL '1 minute')
       WHERE id = $1`,
      [outboxId, safeError]
    );
    return false;
  }
}

import { Request } from 'express';

/** Test OTPs must never leave an explicitly enabled loopback development session. */
export function canPreviewLocalOtp(req: Request): boolean {
  if (process.env.NODE_ENV === 'production' || process.env.AUTH_EMAIL_MODE !== 'local') return false;
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress || '')) return false;
  if (!req.get('origin')) return true;
  try {
    const origin = new URL(req.get('origin')!);
    return ['http:', 'https:'].includes(origin.protocol) &&
      ['localhost', '127.0.0.1', '[::1]'].includes(origin.hostname);
  } catch { return false; }
}

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import bcrypt from 'bcryptjs';
import dotenv from 'dotenv';
import path from 'path';

for (const candidate of [
  path.resolve(process.cwd(), '.env'),
  path.resolve(process.cwd(), '../.env'),
  path.resolve(__dirname, '../../../.env'),
  path.resolve(__dirname, '../../../../.env'),
]) {
  dotenv.config({ path: candidate });
}

if (!process.env.JWT_SECRET || !process.env.OTP_SECRET) {
  throw new Error('JWT_SECRET and OTP_SECRET environment variables are required.');
}

const JWT_SECRET: string = process.env.JWT_SECRET;
const OTP_HMAC_SECRET: string = process.env.OTP_SECRET;

export type PortalType = 'customer' | 'staff' | 'admin' | 'platform';

export interface TokenPayload {
  userId: string;
  sessionVersion?: number;
  portal: PortalType;
  tenantId?: string;
  role?: string;
  preferredLanguage?: 'vi' | 'en';
}

/**
 * Sign an access token bound strictly to a portal
 */
export function signAccessToken(payload: TokenPayload): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: '15m',
    audience: payload.portal,
    issuer: 'court-booking-auth',
  });
}

/**
 * Verify token and check portal audience
 */
export function verifyToken(token: string, requiredPortal?: PortalType): TokenPayload {
  const decoded = jwt.verify(token, JWT_SECRET, {
    issuer: 'court-booking-auth',
  }) as TokenPayload;

  if (requiredPortal && decoded.portal !== requiredPortal) {
    throw new Error('FORBIDDEN_PORTAL');
  }

  return decoded;
}

/**
 * Hash password securely
 */
export async function hashPassword(password: string): Promise<string> {
  return bcrypt.hash(password, 12);
}

/**
 * Compare password
 */
export async function comparePassword(password: string, hash: string): Promise<boolean> {
  return bcrypt.compare(password, hash);
}

/**
 * Generate 6-digit numeric OTP using CSPRNG (Section 16.4 & D-03)
 */
export function generateNumericOtp(): string {
  const number = crypto.randomInt(100000, 999999);
  return number.toString();
}

/**
 * Compute HMAC hash of OTP code for secure storage
 */
export function hashOtp(otp: string): string {
  return crypto.createHmac('sha256', OTP_HMAC_SECRET).update(otp).digest('hex');
}

/**
 * Generate unique booking code e.g. "DS-7K3M9Q" (Section 17.2)
 */
export function generateBookingCode(): string {
  const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // 31-char alphabet without ambiguous 0, O, 1, I
  let randomPart = '';
  for (let i = 0; i < 6; i++) {
    const idx = crypto.randomInt(0, chars.length);
    randomPart += chars[idx];
  }
  return `DS-${randomPart}`;
}

/**
 * Normalize Gmail address by stripping dots and aliases (+...) (Section 16.1 & REG-05)
 */
export function normalizeEmail(email: string): string {
  const trimmed = email.trim().toLowerCase();
  const [localPart, domain] = trimmed.split('@');
  if (!domain) return trimmed;

  if (domain === 'gmail.com' || domain === 'googlemail.com') {
    const cleanedLocal = localPart.replace(/\./g, '').split('+')[0];
    return `${cleanedLocal}@gmail.com`;
  }
  return trimmed;
}

/**
 * Normalize Vietnamese phone number to E.164 format (+84...) (Section 16.1 & REG-07)
 */
export function normalizePhoneNumber(phone: string): string {
  let cleaned = phone.replace(/[^\d+]/g, '');
  if (cleaned.startsWith('0')) {
    cleaned = '+84' + cleaned.substring(1);
  } else if (cleaned.startsWith('84') && !cleaned.startsWith('+84')) {
    cleaned = '+' + cleaned;
  }
  return cleaned;
}

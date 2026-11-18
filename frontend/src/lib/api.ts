export const API_BASE = (process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000').replace(/\/$/, '');
export const customerApi = `${API_BASE}/api/customer/v1`;
export const staffApi = `${API_BASE}/api/staff/v1`;
export const adminApi = `${API_BASE}/api/admin/v1`;
export const platformApi = `${API_BASE}/api/platform/v1`;

export function createIdempotencyKey(prefix = 'req'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}-${crypto.randomUUID()}`;
  }
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Clean VND formatter that avoids cramped '₫160,000' glyph collisions in English locale:
 * - vi: '160.000 ₫'
 * - en: '160,000 VND'
 */
export function formatVndCurrency(amount: number | string, language: string = 'vi'): string {
  const num = Math.round(Number(amount || 0));
  if (language === 'en') {
    return `${new Intl.NumberFormat('en-US', { maximumFractionDigits: 0 }).format(num)} VND`;
  }
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 }).format(num)} ₫`;
}

import rateLimit, { ipKeyGenerator } from 'express-rate-limit';
import helmet from 'helmet';
import { Request, Response } from 'express';

// 1. HELMET SECURITY HEADERS
export const securityHeaders = helmet({
  contentSecurityPolicy: false, // Allows Swagger UI and local development
  crossOriginResourcePolicy: { policy: 'cross-origin' }, // Allows cross-origin image embedding
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' }, // Anti-clickjacking
  hidePoweredBy: true,
  hsts: { maxAge: 31536000, includeSubDomains: true }, // Enforce HTTPS for 1 year
  ieNoOpen: true,
  noSniff: true, // X-Content-Type-Options: nosniff
  xssFilter: true,
});

// Custom 429 Overload Responder
function createRateLimitHandler(customMsg?: string) {
  return (req: Request, res: Response) => {
    res.status(429).json({
      error_code: 'TOO_MANY_REQUESTS',
      message: customMsg || 'Hệ thống đang quá tải hoặc bạn đã gửi quá nhiều yêu cầu liên tiếp. Vui lòng thử lại sau ít phút.',
      retry_after_minutes: 15,
    });
  };
}

// 2. RATE LIMITERS (Section 18.2 REG-22 & DDoS mitigation)

// General limiter: 300 requests / 15 minutes
export const globalApiLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler(),
});

// Sensitive Auth limiter: 15 attempts / 15 minutes per IP + auth endpoint
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 15,
  keyGenerator: (req: Request) => `${ipKeyGenerator(req.ip || '127.0.0.1')}:${req.baseUrl}${req.path}`,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler('Bạn đã thử đăng nhập/đăng ký quá nhiều lần. Để bảo mật, vui lòng chờ 15 phút.'),
});

// Upload limiter: 20 uploads / 15 minutes (Overload guard for CPU/disk)
export const uploadRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  handler: createRateLimitHandler('Bạn đã tải lên quá nhiều ảnh trong thời gian ngắn. Vui lòng thử lại sau.'),
});

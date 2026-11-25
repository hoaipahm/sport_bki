import { pool } from '../config/database';
import { databaseScope } from '../config/database-scope';
import { Request, Response, NextFunction } from 'express';
import { verifyToken, PortalType, TokenPayload } from './jwt';
import { t, Language, DEFAULT_LANGUAGE } from '../../../shared/i18n';

export interface AuthenticatedRequest extends Request {
  user?: TokenPayload;
  lang: Language;
}

export function languageMiddleware(req: Request, res: Response, next: NextFunction) {
  const authReq = req as AuthenticatedRequest;
  const headerLang = req.headers['accept-language']?.toLowerCase();

  if (headerLang && (headerLang.startsWith('en') || headerLang.includes('en'))) {
    authReq.lang = 'en';
  } else {
    authReq.lang = 'vi';
  }
  next();
}

/**
 * Middleware to enforce portal-specific authorization AND live account/tenant state (F-09)
 */
export function requirePortal(portal: PortalType) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const authReq = req as AuthenticatedRequest;
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error_code: 'UNAUTHORIZED',
        message: t('errors.INVALID_CREDENTIALS', authReq.lang || DEFAULT_LANGUAGE),
      });
    }

    const token = authHeader.split(' ')[1];
    try {
      const decoded = verifyToken(token, portal);

      if (portal === 'customer') {
        const account = (
          await pool.query('SELECT status, auth_version FROM customer_accounts WHERE id = $1', [decoded.userId])
        ).rows[0];
        if (!account || account.status !== 'ACTIVE' || account.auth_version !== (decoded.sessionVersion ?? 0)) {
          throw new Error('INVALID_TOKEN');
        }
      } else if (portal === 'staff' || portal === 'admin') {
        const staffRow = (
          await pool.query(
            `SELECT s.status, s.role, s.auth_version, t.status as tenant_status
             FROM tenant_staff s
             JOIN tenants t ON t.id = s.tenant_id
             WHERE s.id = $1 AND s.tenant_id = $2`,
            [decoded.userId, decoded.tenantId]
          )
        ).rows[0];
        const allowedStatuses = portal === 'staff' ? ['ACTIVE', 'INVITED'] : ['ACTIVE'];
        if (
          !staffRow ||
          staffRow.auth_version !== (decoded.sessionVersion ?? 0) ||
          staffRow.tenant_status !== 'ACTIVE' ||
          !allowedStatuses.includes(staffRow.status) ||
          (portal === 'admin' && !['OWNER', 'MANAGER'].includes(staffRow.role))
        ) {
          throw new Error('INVALID_TOKEN');
        }
        decoded.role = staffRow.role;
      } else if (portal === 'platform') {
        const pAdmin = (
          await databaseScope.run({ service: true }, () =>
            pool.query('SELECT is_active, auth_version FROM platform_admins WHERE id = $1', [decoded.userId])
          )
        ).rows[0];
        if (!pAdmin?.is_active || pAdmin.auth_version !== (decoded.sessionVersion ?? 0)) throw new Error('INVALID_TOKEN');
      }

      authReq.user = decoded;
      if (decoded.preferredLanguage && !req.headers['accept-language']) {
        authReq.lang = decoded.preferredLanguage;
      }
      next();
    } catch (err: any) {
      if (err.message === 'FORBIDDEN_PORTAL') {
        return res.status(403).json({
          error_code: 'FORBIDDEN_PORTAL',
          message: t('errors.FORBIDDEN_PORTAL', authReq.lang || DEFAULT_LANGUAGE),
        });
      }
      return res.status(401).json({
        error_code: 'INVALID_TOKEN',
        message: t('errors.INVALID_CREDENTIALS', authReq.lang || DEFAULT_LANGUAGE),
      });
    }
  };
}

export function sendTranslatedError(
  req: AuthenticatedRequest,
  res: Response,
  statusCode: number,
  errorCode: string,
  extraParams?: Record<string, any>
) {
  const lang = req.lang || DEFAULT_LANGUAGE;
  const translatedMsg = t(`errors.${errorCode}`, lang, extraParams);
  return res.status(statusCode).json({
    error_code: errorCode,
    message: translatedMsg,
    ...extraParams,
  });
}

import { Router, Response } from 'express';
import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { PoolClient } from 'pg';
import { pool, withTransaction } from '../../config/database';
import { AuthenticatedRequest } from '../../common/auth.guard';
import { normalizeEmail, normalizePhoneNumber, hashPassword, comparePassword, generateNumericOtp, hashOtp, signAccessToken } from '../../common/jwt';
import { authRateLimiter } from '../../common/security';
import { isSmtpConfigured, dispatchQueuedEmail } from '../../common/email.service';
import { t } from '../../../../shared/i18n';
import { canPreviewLocalOtp } from '../../common/local-preview';

export const customerAuthRouter = Router();
type Purpose = 'REGISTER' | 'RESET_PASSWORD';
class AuthFailure extends Error { constructor(public code: string, public status = 400) { super(code); } }
const digest = (value: string) => createHash('sha256').update(value).digest('hex');

function deliveryMode(req: AuthenticatedRequest): 'test_mode' | 'smtp' {
  if (isSmtpConfigured() && process.env.AUTH_EMAIL_MODE !== 'local') {
    return 'smtp';
  }
  if (!canPreviewLocalOtp(req)) {
    throw new AuthFailure('EMAIL_UNAVAILABLE', 503);
  }
  return 'test_mode';
}

function passwordValid(value: unknown): value is string { return typeof value === 'string' && value.length >= 8 && value.length <= 128; }
function safeUser(user: any) {
  return {
    id: user.id,
    username: user.username,
    full_name: user.full_name || null,
    email: user.email,
    phone_e164: user.phone_e164 || null,
    avatar_url: user.avatar_url || null,
    preferred_language: user.preferred_language,
    created_at: user.created_at,
  };
}

async function issueCode(client: PoolClient, user: any, purpose: Purpose, mode: 'test_mode' | 'smtp') {
  const recent = await client.query(`SELECT count(*) FILTER (WHERE created_at > NOW() - INTERVAL '1 hour')::int AS hourly, count(*)::int AS daily, max(created_at) AS latest FROM otp_codes WHERE user_id=$1 AND purpose=$2 AND created_at > NOW() - INTERVAL '1 day'`, [user.id, purpose]);
  const quota = recent.rows[0];
  if (quota.latest && Date.now() - new Date(quota.latest).getTime() < 60000) throw new AuthFailure('OTP_WAIT_RESEND', 429);
  if (quota.hourly >= 10 || quota.daily >= 20) throw new AuthFailure('OTP_QUOTA', 429);
  await client.query('UPDATE otp_codes SET used_at=NOW() WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL', [user.id, purpose]);
  const code = generateNumericOtp();
  const expires = new Date(Date.now() + 600000);
  await client.query('INSERT INTO otp_codes(target_identifier,user_id,purpose,code_hash,expires_at) VALUES($1,$2,$3,$4,$5)', [user.email_normalized, user.id, purpose, hashOtp(code), expires]);
  
  if (mode === 'smtp') {
    const outboxRes = await client.query(
      `INSERT INTO email_outbox(recipient,template_type,language,reference_id,template_data,dedup_key) VALUES($1,$2,$3,$4,$5,$6) RETURNING id`,
      [user.email, purpose === 'REGISTER' ? 'REGISTER_OTP' : 'RESET_PASSWORD_OTP', user.preferred_language || 'vi', user.id, JSON.stringify({otp:code,username:user.username}), randomBytes(16).toString('hex')]
    );
    const outboxId = outboxRes.rows[0]?.id;
    if (outboxId) {
      setImmediate(() => {
        dispatchQueuedEmail(outboxId).catch(err => console.error('[EmailDispatch:AsyncError]', err.message));
      });
    }
  }

  return {
    delivery_mode: mode,
    is_test_mode: mode === 'test_mode',
    email: user.email,
    expires_at: expires.toISOString(),
    retry_after_seconds: 60,
    ...(mode === 'test_mode' ? { local_code: code, test_otp: code } : {})
  };
}
async function consumeCode(client: PoolClient, user: any, purpose: Purpose, code: unknown) {
  const found = await client.query('SELECT * FROM otp_codes WHERE user_id=$1 AND purpose=$2 AND used_at IS NULL ORDER BY created_at DESC LIMIT 1 FOR UPDATE', [user.id, purpose]);
  const otp = found.rows[0];
  if (!otp || new Date(otp.expires_at).getTime() <= Date.now()) return 'OTP_INVALID';
  if (otp.attempts >= 5) return 'OTP_MAX_ATTEMPTS';
  const actual = Buffer.from(hashOtp(typeof code === 'string' ? code.trim() : ''));
  const expected = Buffer.from(otp.code_hash);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    await client.query('UPDATE otp_codes SET attempts=attempts+1 WHERE id=$1', [otp.id]);
    return otp.attempts + 1 >= 5 ? 'OTP_MAX_ATTEMPTS' : 'OTP_INVALID';
  }
  await client.query('UPDATE otp_codes SET used_at=NOW() WHERE id=$1', [otp.id]);
  return null;
}
function endpoint(path: string, work: (req: AuthenticatedRequest) => Promise<any>) {
  customerAuthRouter.post(path, authRateLimiter, async (req: AuthenticatedRequest, res: Response) => {
    res.setHeader('Cache-Control', 'no-store');
    try { const result = await work(req); if (result?.error) throw new AuthFailure(result.error, result.error === 'OTP_MAX_ATTEMPTS' ? 429 : 400); return res.status(path === '/auth/register' ? 201 : 200).json(result); }
    catch (error) { const failure = error instanceof AuthFailure ? error : new AuthFailure((error as any).code === '23505' ? 'ACCOUNT_EXISTS' : 'AUTH_UNAVAILABLE', (error as any).code === '23505' ? 409 : 500); return res.status(failure.status).json({error_code:failure.code,message:t(`errors.${failure.code}`,req.lang || 'vi')}); }
  });
}
endpoint('/auth/register', async req => {
  const {username,full_name,email,phone,password,confirm_password,accept_terms,preferred_language='vi'} = req.body;
  const mode = deliveryMode(req);
  if (typeof username !== 'string' || !/^[a-z0-9][a-z0-9._]{2,18}[a-z0-9]$/i.test(username) || ['admin','root','support','owner','system'].includes(username.toLowerCase())) throw new AuthFailure('INVALID_REGISTRATION');
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || typeof phone !== 'string' || !/^(?:0|\+?84)[35789]\d{8}$/.test(phone) || !['vi','en'].includes(preferred_language)) throw new AuthFailure('INVALID_REGISTRATION');
  if (!passwordValid(password) || password !== confirm_password) throw new AuthFailure('PASSWORD_INVALID');
  if (accept_terms !== true) throw new AuthFailure('TERMS_REQUIRED');
  const cleanFullName = typeof full_name === 'string' && full_name.trim().length >= 2 ? full_name.trim().slice(0, 120) : null;
  const passwordHash = await hashPassword(password);
  return withTransaction(null, async client => {
    const result = await client.query(`INSERT INTO customer_accounts(username,full_name,email,email_normalized,phone_e164,password_hash,status,preferred_language,terms_accepted_at) VALUES($1,$2,$3,$4,$5,$6,'PENDING_VERIFICATION',$7,NOW()) RETURNING *`, [username.toLowerCase(),cleanFullName,email.trim(),normalizeEmail(email),normalizePhoneNumber(phone),passwordHash,preferred_language]);
    return { email:result.rows[0].email, ...await issueCode(client,result.rows[0],'REGISTER',mode) };
  });
});
endpoint('/auth/resend-otp', async req => {
  const mode = deliveryMode(req); const {email,purpose='REGISTER'} = req.body;
  if (typeof email !== 'string' || !['REGISTER','RESET_PASSWORD'].includes(purpose)) throw new AuthFailure('INVALID_REGISTRATION');
  return withTransaction(null, async client => {
    const result = await client.query("SELECT * FROM customer_accounts WHERE email_normalized=$1 AND status IN ('ACTIVE','PENDING_VERIFICATION') FOR UPDATE", [normalizeEmail(email)]);
    const user = result.rows[0];
    if (!user || (purpose === 'REGISTER' && user.status !== 'PENDING_VERIFICATION')) {
      return { delivery_mode: mode, is_test_mode: mode === 'test_mode' };
    }
    return issueCode(client,user,purpose,mode);
  });
});
endpoint('/auth/verify-email', async req => {
  if (typeof req.body.email !== 'string') throw new AuthFailure('OTP_INVALID');
  return withTransaction(null, async client => {
    const result = await client.query("SELECT * FROM customer_accounts WHERE email_normalized=$1 AND status='PENDING_VERIFICATION' FOR UPDATE", [normalizeEmail(req.body.email)]);
    const user = result.rows[0]; if (!user) return {error:'OTP_INVALID'};
    const error = await consumeCode(client,user,'REGISTER',req.body.otp); if (error) return {error};
    await client.query("UPDATE customer_accounts SET status='ACTIVE',email_verified_at=NOW() WHERE id=$1", [user.id]);
    const rawRefresh = randomBytes(40).toString('hex');
    const refreshHash = digest(rawRefresh);
    const deviceInfo = String(req.headers['user-agent'] || 'Web Browser').slice(0, 240);
    await client.query(
      "INSERT INTO refresh_tokens(portal,user_id,token_hash,device_info,ip_address,expires_at) VALUES('customer',$1,$2,$3,$4,NOW()+INTERVAL '30 days')",
      [user.id, refreshHash, deviceInfo, String(req.ip || '').slice(0, 48)]
    );
    return {
      access_token: signAccessToken({ userId: user.id, portal: 'customer', preferredLanguage: user.preferred_language, sessionVersion: user.auth_version }),
      refresh_token: rawRefresh,
      user: safeUser(user),
    };
  });
});
endpoint('/auth/forgot-password', async req => {
  const mode = deliveryMode(req); const identifier = req.body.identifier;
  if (typeof identifier !== 'string' || !identifier.trim()) throw new AuthFailure('INVALID_REGISTRATION');
  return withTransaction(null, async client => {
    const result = await client.query("SELECT * FROM customer_accounts WHERE (email_normalized=$1 OR lower(username)=$2) AND status='ACTIVE' FOR UPDATE", [normalizeEmail(identifier),identifier.trim().toLowerCase()]);
    if (!result.rows[0]) return { delivery_mode: mode, is_test_mode: mode === 'test_mode' };
    return issueCode(client,result.rows[0],'RESET_PASSWORD',mode);
  });
});
endpoint('/auth/verify-reset-otp', async req => {
  if (typeof req.body.identifier !== 'string') throw new AuthFailure('OTP_INVALID');
  return withTransaction(null, async client => {
    const result = await client.query("SELECT * FROM customer_accounts WHERE (email_normalized=$1 OR lower(username)=$2) AND status='ACTIVE' FOR UPDATE", [normalizeEmail(req.body.identifier),req.body.identifier.trim().toLowerCase()]);
    const user = result.rows[0]; if (!user) return {error:'OTP_INVALID'};
    const error = await consumeCode(client,user,'RESET_PASSWORD',req.body.otp); if (error) return {error};
    const token = randomBytes(32).toString('hex');
    await client.query("UPDATE password_resets SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
    await client.query("INSERT INTO password_resets(user_id,token_hash,expires_at) VALUES($1,$2,NOW()+INTERVAL '15 minutes')", [user.id,digest(token)]);
    return {reset_token:token};
  });
});
endpoint('/auth/reset-password', async req => {
  if (typeof req.body.reset_token !== 'string' || !passwordValid(req.body.new_password) || req.body.new_password !== req.body.confirm_password) throw new AuthFailure('PASSWORD_INVALID');
  const newHash = await hashPassword(req.body.new_password);
  return withTransaction(null, async client => {
    const result = await client.query("SELECT * FROM password_resets WHERE token_hash=$1 AND used_at IS NULL AND expires_at>NOW() FOR UPDATE", [digest(req.body.reset_token)]);
    const reset = result.rows[0]; if (!reset) return {error:'OTP_INVALID'};
    const user = (await client.query("SELECT * FROM customer_accounts WHERE id=$1 AND status='ACTIVE' FOR UPDATE",[reset.user_id])).rows[0];
    if (!user) return {error:'OTP_INVALID'};
    if (await comparePassword(req.body.new_password,user.password_hash)) return {error:'PASSWORD_REUSED'};
    await client.query('UPDATE password_resets SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[user.id]);
    await client.query('UPDATE customer_accounts SET password_hash=$1,auth_version=auth_version+1,failed_login_count=0,locked_until=NULL,updated_at=NOW() WHERE id=$2',[newHash,user.id]);
    await client.query("UPDATE refresh_tokens SET revoked_at=NOW() WHERE user_id=$1 AND portal='customer'",[user.id]);
    await client.query('UPDATE otp_codes SET used_at=NOW() WHERE user_id=$1 AND used_at IS NULL',[user.id]);
    return {status:'PASSWORD_CHANGED'};
  });
});

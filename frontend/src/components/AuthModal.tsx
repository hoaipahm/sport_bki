'use client';

import React, { useRef, useState, useEffect } from 'react';
import {
  X,
  Mail,
  Lock,
  User,
  Phone,
  CheckCircle,
  AlertCircle,
  ArrowRight,
  Eye,
  EyeOff,
  BadgeCheck,
  ShieldCheck,
} from 'lucide-react';
import { customerApi } from '../lib/api';
import { DEFAULT_AUTH_SLIDES } from '../lib/media';
import { LoopingPhotoCarousel } from './LoopingPhotoCarousel';
import { useLanguage } from '../context/LanguageContext';
import { useAuth } from '../context/AuthContext';
import { Button } from './ui/Button';
import { useDialog } from '../hooks/useDialog';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'LOGIN' | 'REGISTER';
  sessionExpiredNotice?: boolean;
  slides?: string[];
}

export function AuthModal({
  isOpen,
  onClose,
  initialTab = 'LOGIN',
  sessionExpiredNotice = false,
  slides = DEFAULT_AUTH_SLIDES,
}: AuthModalProps) {
  const { language, t } = useLanguage();
  const dialog = useRef<HTMLDivElement>(null);
  useDialog(isOpen, dialog, onClose);
  const { login } = useAuth();

  const [tab, setTab] = useState<
    'LOGIN' | 'REGISTER' | 'VERIFY_OTP' | 'FORGOT_PASS' | 'RESET_OTP' | 'RESET_PASSWORD'
  >(initialTab);

  // Strictly empty initial states — never pre-fill or suggest personal identities
  const [identifier, setIdentifier] = useState('');
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [otp, setOtp] = useState('');
  const [resetToken, setResetToken] = useState('');
  const [terms, setTerms] = useState(false);

  const [localCode, setLocalCode] = useState('');
  const [isTestMode, setIsTestMode] = useState(false);
  const [retryAt, setRetryAt] = useState(0);
  const [waitSeconds, setWaitSeconds] = useState(0);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  useEffect(() => {
    if (isOpen) {
      setTab(initialTab);
      if (sessionExpiredNotice) {
        setErrorMsg(t('web.sessionExpired'));
      }
    }
  }, [isOpen, initialTab, sessionExpiredNotice, t]);

  useEffect(() => {
    if (!isOpen || !retryAt) return;
    const update = () => setWaitSeconds(Math.max(0, Math.ceil((retryAt - Date.now()) / 1000)));
    update();
    const timer = setInterval(update, 1000);
    return () => clearInterval(timer);
  }, [isOpen, retryAt]);

  if (!isOpen) return null;

  const readDelivery = (data: {
    delivery_mode?: string;
    local_code?: string;
    test_otp?: string;
    retry_after_seconds?: number;
    email?: string;
  }) => {
    const isTest =
      data.delivery_mode === 'test_mode' ||
      data.delivery_mode === 'local_preview' ||
      Boolean(data.local_code || data.test_otp);
    setIsTestMode(isTest);
    const code = data.local_code || data.test_otp || '';
    setLocalCode(code);
    setRetryAt(Date.now() + (data.retry_after_seconds || 60) * 1000);
    setOtp('');
    if (isTest) {
      setSuccessMsg(t('web.localOtpNotice'));
    } else {
      setSuccessMsg(t('web.smtpSentNotice', { email: data.email || email }));
    }
  };

  const passwordScore = (() => {
    if (!password) return 0;
    let s = 0;
    if (password.length >= 8) s += 1;
    if (password.length >= 12) s += 1;
    if (/[A-Z]/.test(password) && /[a-z]/.test(password)) s += 1;
    if (/\d|[^A-Za-z0-9]/.test(password)) s += 1;
    return s;
  })();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${customerApi}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ identifier: identifier.trim(), password }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.error_code === 'EMAIL_NOT_VERIFIED') {
          setEmail(data.email || identifier.trim());
          setTab('VERIFY_OTP');
          setSuccessMsg(null);
          setLocalCode('');
        }
        throw new Error(data.message || t('common.errorOccurred'));
      }
      login(data.access_token, data.user, data.refresh_token);
      setPassword('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  const handleRegister = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${customerApi}/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({
          username: username.trim(),
          full_name: displayName.trim() || undefined,
          email: email.trim(),
          phone: phone.trim(),
          password,
          confirm_password: confirmation,
          accept_terms: terms,
          preferred_language: language,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || t('common.errorOccurred'));
      }
      readDelivery(data);
      setTab('VERIFY_OTP');
    } catch (err: any) {
      setErrorMsg(err.message || t('common.errorOccurred'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOtp = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    try {
      const res = await fetch(`${customerApi}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ email, otp }),
      });
      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.message || t('common.errorOccurred'));
      }
      login(data.access_token, data.user, data.refresh_token);
      setPassword('');
      setConfirmation('');
      onClose();
    } catch (err: any) {
      setErrorMsg(err.message || t('errors.OTP_INVALID'));
    } finally {
      setLoading(false);
    }
  };

  const submitRecovery = async (event: React.FormEvent) => {
    event.preventDefault();
    setLoading(true);
    setErrorMsg(null);
    const endpoint =
      tab === 'FORGOT_PASS'
        ? 'forgot-password'
        : tab === 'RESET_OTP'
          ? 'verify-reset-otp'
          : 'reset-password';
    const payload =
      tab === 'FORGOT_PASS'
        ? { identifier: email.trim() }
        : tab === 'RESET_OTP'
          ? { identifier: email.trim(), otp }
          : { reset_token: resetToken, new_password: password, confirm_password: confirmation };

    try {
      const response = await fetch(`${customerApi}/auth/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify(payload),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || t('common.errorOccurred'));

      if (tab === 'FORGOT_PASS') {
        setTab('RESET_OTP');
        readDelivery(data);
      } else if (tab === 'RESET_OTP') {
        setResetToken(data.reset_token);
        setPassword('');
        setConfirmation('');
        setLocalCode('');
        setTab('RESET_PASSWORD');
        setSuccessMsg(null);
      } else {
        setResetToken('');
        setPassword('');
        setConfirmation('');
        setTab('LOGIN');
        setSuccessMsg(t('web.resetSuccess'));
      }
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : t('web.networkError'));
    } finally {
      setLoading(false);
    }
  };

  const resendCode = async () => {
    setLoading(true);
    setErrorMsg(null);
    try {
      const purpose = tab === 'RESET_OTP' ? 'RESET_PASSWORD' : 'REGISTER';
      const response = await fetch(`${customerApi}/auth/resend-otp`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ email, purpose }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message || t('common.errorOccurred'));
      readDelivery(data);
    } catch (error) {
      setErrorMsg(error instanceof Error ? error.message : t('web.networkError'));
    } finally {
      setLoading(false);
    }
  };

  const activeSlides = slides && slides.length > 0 ? slides : DEFAULT_AUTH_SLIDES;

  return (
    <div className="modal-backdrop-anim fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-overlay">
      <div
        ref={dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="AuthModal-title"
        className="modal-panel-anim customer-shell bg-panel rounded-t-token-lg sm:rounded-token-lg shadow-token-elevated max-w-md md:max-w-3xl w-full max-h-[92dvh] overflow-y-auto md:overflow-hidden border border-borderStrong text-textBody md:grid md:grid-cols-[0.94fr_1.16fr]"
      >
        {/* Left Visual Showcase Column (Desktop) */}
        <div className="hidden md:flex relative min-h-[520px] border-r border-borderToken">
          <LoopingPhotoCarousel
            images={activeSlides}
            alt={t('common.appName')}
            intervalMs={4200}
            className="w-full h-full"
            showControls={false}
            showCounter={false}
            showDots={true}
            overlayClassName="carousel-vignette-deep"
          >
            <div className="h-full flex flex-col justify-end p-6 space-y-3 pointer-events-none">
              <span className="w-fit px-3 py-1 rounded-token-full bg-overlay backdrop-blur-sm border border-accent-border text-accent text-xs font-bold inline-flex items-center gap-1.5">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>{t('common.appName')}</span>
              </span>
              <p className="text-lg font-extrabold text-textStrong leading-snug">
                {language === 'en'
                  ? 'Book verified courts in seconds. Zero double-bookings.'
                  : 'Đặt sân chuẩn xác trong vài giây. Giữ chỗ thực tế, ra sân ngay.'}
              </p>
              <p className="text-xs text-textBody leading-relaxed">
                {language === 'en'
                  ? 'Instant OTP verification via email, 10-minute VietQR hold, and live schedule updates.'
                  : 'Xác thực OTP qua Gmail tức thì, giữ khung giờ 10 phút khi quét VietQR và nhận vé lịch điện tử.'}
              </p>
            </div>
          </LoopingPhotoCarousel>
        </div>

        {/* Right Form Column */}
        <div className="flex flex-col max-h-[92dvh] md:overflow-y-auto min-w-0">
          {/* Mobile Top Visual Strip */}
          <div className="md:hidden h-28 relative border-b border-borderToken shrink-0">
            <LoopingPhotoCarousel
              images={activeSlides}
              alt=""
              intervalMs={4200}
              className="w-full h-full"
              showControls={false}
              showCounter={false}
              showDots={true}
              overlayClassName="bg-gradient-to-t from-panel-2 via-page/35 to-transparent"
            />
          </div>

          {/* Header */}
          <div className="bg-panel-2 text-textStrong px-6 py-4 flex items-center justify-between border-b border-borderToken shrink-0">
          <div className="flex items-center space-x-2.5">
            <div className="w-8 h-8 rounded-token-sm bg-accent-soft border border-accent-border flex items-center justify-center">
              <User className="w-4 h-4 text-accent" />
            </div>
            <h3 id="AuthModal-title" className="font-bold text-base text-textStrong">
              {tab === 'LOGIN' && t('web.copy2')}
              {tab === 'REGISTER' && t('web.copy3')}
              {tab === 'VERIFY_OTP' && t('web.copy4')}
              {['FORGOT_PASS', 'RESET_OTP', 'RESET_PASSWORD'].includes(tab) && t('web.resetPassword')}
            </h3>
          </div>
          <button
            onClick={onClose}
            aria-label={t('web.close')}
            className="text-textMuted hover:text-textStrong min-h-[44px] min-w-[44px] flex items-center justify-center rounded-token-md hover:bg-surfaceHover"
            type="button"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Segmented Tab Switcher */}
        {(tab === 'LOGIN' || tab === 'REGISTER') && (
          <div className="p-2 bg-panel-2 border-b border-borderToken grid grid-cols-2 gap-1.5">
            <button
              onClick={() => {
                setTab('LOGIN');
                setErrorMsg(null);
                setSuccessMsg(null);
                setLocalCode('');
              }}
              className={`min-h-[42px] rounded-token-sm text-xs sm:text-sm font-semibold text-center ${
                tab === 'LOGIN'
                  ? 'bg-accent text-textOnAccent font-bold shadow-sm'
                  : 'text-textMuted hover:text-textStrong hover:bg-surfaceHover'
              }`}
              type="button"
            >
              {t('web.copy6')}
            </button>
            <button
              onClick={() => {
                setTab('REGISTER');
                setErrorMsg(null);
              }}
              className={`min-h-[42px] rounded-token-sm text-xs sm:text-sm font-semibold text-center ${
                tab === 'REGISTER'
                  ? 'bg-accent text-textOnAccent font-bold shadow-sm'
                  : 'text-textMuted hover:text-textStrong hover:bg-surfaceHover'
              }`}
              type="button"
            >
              {t('web.copy7')}
            </button>
          </div>
        )}

        <div className="p-6">
          {errorMsg && (
            <div
              role="alert"
              className="mb-4 p-3 bg-statusDanger-soft border border-statusDanger-border text-statusDanger rounded-token-md text-xs sm:text-sm flex items-start space-x-2"
            >
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{errorMsg}</span>
            </div>
          )}

          {successMsg && !localCode && (
            <div className="mb-4 p-3 bg-accent-soft border border-accent-border text-accent rounded-token-md text-xs sm:text-sm flex items-start space-x-2">
              <CheckCircle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{successMsg}</span>
            </div>
          )}

          {localCode && ['VERIFY_OTP', 'RESET_OTP'].includes(tab) && (
            <div className="mb-5 rounded-token-md bg-statusWarning-soft p-4 border border-statusWarning-border space-y-3">
              <div className="flex items-start gap-2 text-statusWarning font-semibold text-xs sm:text-sm">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{t('web.localOtpNotice')}</span>
              </div>
              <p className="text-xs text-textMuted">{t('web.localOtpLabel')}</p>
              <output
                className="block text-center text-3xl font-mono font-bold tracking-[.3em] text-statusWarning bg-panel-2 py-2.5 px-4 rounded-token-sm border border-statusWarning-border tabular-nums"
                aria-label={t('web.copy14')}
              >
                {localCode}
              </output>
              <Button
                variant="secondary"
                type="button"
                className="w-full text-xs sm:text-sm font-semibold py-2"
                onClick={() => setOtp(localCode)}
              >
                {t('web.useLocalCode')}
              </Button>
            </div>
          )}

          {/* LOGIN FORM (Clean, empty, zero personal identity suggestions) */}
          {tab === 'LOGIN' && (
            <form onSubmit={handleLogin} className="tab-panel-anim space-y-4">
              <div>
                <label htmlFor="auth-login-identifier" className="block text-xs font-semibold text-textBody mb-1.5">
                  {t('web.loginIdentifier')}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-textMuted absolute left-3.5 top-3.5" />
                  <input
                    id="auth-login-identifier"
                    type="text"
                    autoComplete="username"
                    required
                    value={identifier}
                    onChange={(e) => setIdentifier(e.target.value)}
                    className="w-full min-h-[46px] pl-10 pr-3.5 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="auth-login-password" className="block text-xs font-semibold text-textBody mb-1.5">
                  {t('web.copy8')}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-textMuted absolute left-3.5 top-3.5" />
                  <input
                    id="auth-login-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="current-password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full min-h-[46px] pl-10 pr-11 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center text-textMuted hover:text-textStrong rounded-token-sm"
                    aria-label={t('auth.password')}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center justify-end">
                <button
                  type="button"
                  onClick={() => {
                    setTab('FORGOT_PASS');
                    setErrorMsg(null);
                    setSuccessMsg(null);
                  }}
                  className="min-h-[40px] text-sm text-accent hover:underline font-medium"
                >
                  {t('web.forgot')}
                </button>
              </div>

              <Button type="submit" disabled={loading} className="w-full" variant="primary">
                <span>{loading ? t('common.loading') : t('web.copy9')}</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>
          )}

          {/* REGISTER FORM */}
          {tab === 'REGISTER' && (
            <form onSubmit={handleRegister} className="tab-panel-anim space-y-3.5">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label htmlFor="reg-fullname" className="block text-xs font-semibold text-textBody mb-1">
                    {t('auth.fullName')}
                  </label>
                  <div className="relative">
                    <BadgeCheck className="w-4 h-4 text-textMuted absolute left-3 top-3.5" />
                    <input
                      id="reg-fullname"
                      type="text"
                      autoComplete="name"
                      maxLength={120}
                      value={displayName}
                      onChange={(e) => setDisplayName(e.target.value)}
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    />
                  </div>
                </div>

                <div>
                  <label htmlFor="reg-username" className="block text-xs font-semibold text-textBody mb-1">
                    {t('web.username')}
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 text-textMuted absolute left-3 top-3.5" />
                    <input
                      id="reg-username"
                      type="text"
                      autoComplete="username"
                      required
                      minLength={4}
                      maxLength={20}
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    />
                  </div>
                  <p className="text-[12px] text-textMuted mt-1">{t('web.usernameHint')}</p>
                </div>
              </div>

              <div>
                <label htmlFor="reg-email" className="block text-xs font-semibold text-textBody mb-1">
                  {t('common.email')}
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-textMuted absolute left-3 top-3.5" />
                  <input
                    id="reg-email"
                    type="email"
                    autoComplete="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="reg-phone" className="block text-xs font-semibold text-textBody mb-1">
                  {t('web.copy11')}
                </label>
                <div className="relative">
                  <Phone className="w-4 h-4 text-textMuted absolute left-3 top-3.5" />
                  <input
                    id="reg-phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full min-h-[44px] pl-9 pr-3 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none tabular-nums"
                  />
                </div>
              </div>

              <div>
                <label htmlFor="reg-password" className="block text-xs font-semibold text-textBody mb-1">
                  {t('web.copy12')}
                </label>
                <div className="relative">
                  <Lock className="w-4 h-4 text-textMuted absolute left-3 top-3.5" />
                  <input
                    id="reg-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    required
                    minLength={8}
                    maxLength={128}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full min-h-[44px] pl-9 pr-11 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword(!showPassword)}
                    className="absolute right-2 top-1.5 min-h-[36px] min-w-[36px] flex items-center justify-center text-textMuted hover:text-textStrong rounded-token-sm"
                    aria-label={t('auth.password')}
                  >
                    {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
                {password.length > 0 && (
                  <div className="grid grid-cols-4 gap-1.5 mt-2" aria-hidden="true">
                    {[1, 2, 3, 4].map((step) => (
                      <span
                        key={step}
                        className={`h-1 rounded-token-full ${
                          passwordScore >= step ? 'bg-accent' : 'bg-panel-3'
                        }`}
                      />
                    ))}
                  </div>
                )}
              </div>

              <div>
                <label htmlFor="register-confirm" className="block text-xs font-semibold text-textBody mb-1">
                  {t('web.confirmPassword')}
                </label>
                <input
                  id="register-confirm"
                  type={showPassword ? 'text' : 'password'}
                  autoComplete="new-password"
                  minLength={8}
                  maxLength={128}
                  required
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                />
              </div>

              <label className="flex min-h-[44px] items-start gap-3 text-sm pt-1 cursor-pointer">
                <input
                  type="checkbox"
                  required
                  checked={terms}
                  onChange={(event) => setTerms(event.target.checked)}
                  className="w-5 h-5 mt-0.5 accent-[var(--accent)] shrink-0"
                />
                <span className="leading-snug">{t('auth.acceptTerms')}</span>
              </label>

              {confirmation && confirmation !== password && (
                <p className="text-sm text-statusDanger" role="alert">
                  {t('web.passwordMismatch')}
                </p>
              )}

              <Button type="submit" disabled={loading} className="w-full mt-2" variant="primary">
                <span>{loading ? t('common.loading') : t('web.copy13')}</span>
                <ArrowRight className="w-4 h-4 ml-2" />
              </Button>
            </form>
          )}

          {/* PASSWORD RECOVERY */}
          {['FORGOT_PASS', 'RESET_OTP', 'RESET_PASSWORD'].includes(tab) && (
            <form onSubmit={submitRecovery} className="tab-panel-anim space-y-4">
              {tab === 'FORGOT_PASS' && (
                <div>
                  <label htmlFor="reset-email" className="block text-sm font-medium text-textBody mb-2">
                    {t('web.resetIntro')}
                  </label>
                  <input
                    id="reset-email"
                    type="text"
                    autoComplete="username"
                    required
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    className="w-full min-h-[48px] px-4 bg-panel-2 rounded-token-md border border-borderStrong text-textStrong focus:border-accent outline-none"
                  />
                </div>
              )}

              {tab === 'RESET_OTP' && (
                <div>
                  <label htmlFor="reset-otp" className="block text-sm font-medium text-textBody mb-2">
                    {t('web.copy14')}
                  </label>
                  <input
                    id="reset-otp"
                    inputMode="numeric"
                    autoComplete="one-time-code"
                    pattern="[0-9]{6}"
                    maxLength={6}
                    required
                    value={otp}
                    onChange={(event) => setOtp(event.target.value.replace(/\D/g, ''))}
                    className="w-full min-h-[52px] px-4 bg-panel-2 rounded-token-md border border-borderStrong text-textStrong tracking-[.35em] text-center font-mono text-2xl tabular-nums focus:border-accent outline-none"
                  />
                </div>
              )}

              {tab === 'RESET_PASSWORD' && (
                <>
                  <div>
                    <label htmlFor="reset-new-password" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('web.newPassword')}
                    </label>
                    <input
                      id="reset-new-password"
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      required
                      value={password}
                      onChange={(event) => setPassword(event.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 rounded-token-md border border-borderStrong text-textStrong focus:border-accent outline-none"
                    />
                  </div>
                  <div>
                    <label htmlFor="reset-confirm" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('web.confirmPassword')}
                    </label>
                    <input
                      id="reset-confirm"
                      type="password"
                      autoComplete="new-password"
                      required
                      minLength={8}
                      maxLength={128}
                      value={confirmation}
                      onChange={(event) => setConfirmation(event.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    />
                  </div>
                </>
              )}

              <Button type="submit" disabled={loading} className="w-full">
                {t(
                  loading
                    ? 'common.loading'
                    : tab === 'FORGOT_PASS'
                      ? 'web.sendCode'
                      : tab === 'RESET_OTP'
                        ? 'web.verifyCode'
                        : 'web.resetPassword'
                )}
              </Button>
              <button
                type="button"
                onClick={() => {
                  setTab('LOGIN');
                  setErrorMsg(null);
                  setSuccessMsg(null);
                  setLocalCode('');
                }}
                className="w-full min-h-[44px] text-sm text-textBody hover:text-textStrong"
              >
                {t('web.backLogin')}
              </button>
            </form>
          )}

          {/* VERIFY REGISTRATION OTP */}
          {tab === 'VERIFY_OTP' && (
            <form onSubmit={handleVerifyOtp} className="tab-panel-anim space-y-4">
              <p className="text-xs text-textMuted">
                {isTestMode ? t('web.otpHelpTestMode') : t('web.otpHelpSmtpMode')}
              </p>

              <div>
                <label htmlFor="verify-reg-otp" className="block text-xs font-semibold text-textBody mb-1.5">
                  {t('web.copy14')}
                </label>
                <input
                  id="verify-reg-otp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  required
                  maxLength={6}
                  value={otp}
                  onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
                  className="w-full min-h-[52px] py-3 text-center font-mono text-2xl tracking-[.35em] bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none tabular-nums"
                />
              </div>

              <Button
                type="submit"
                disabled={loading || otp.length !== 6}
                className="w-full"
                variant="primary"
              >
                {loading ? t('common.loading') : t('web.copy15')}
              </Button>

              <button
                type="button"
                onClick={resendCode}
                disabled={loading || waitSeconds > 0}
                className="w-full min-h-[44px] text-sm text-accent disabled:opacity-50"
              >
                {waitSeconds > 0 ? t('web.resendWait', { seconds: waitSeconds }) : t('web.resend')}
              </button>
              <button
                type="button"
                onClick={() => setTab('REGISTER')}
                className="w-full text-center text-xs text-textMuted hover:text-textStrong py-2"
              >
                {t('web.copy16')}
              </button>
            </form>
          )}
          </div>
        </div>
      </div>
    </div>
  );
}

'use client';

import React, { useState, useEffect, useCallback, useRef } from 'react';
import Link from 'next/link';
import {
  User,
  Camera,
  ShieldCheck,
  CheckCircle2,
  AlertCircle,
  Mail,
  Phone,
  Lock,
  Smartphone,
  Download,
  Trash2,
  LogOut,
  Calendar,
  Award,
  Bell,
  ArrowLeft,
} from 'lucide-react';
import { Header } from '../../components/Header';
import { AuthModal } from '../../components/AuthModal';
import { LoopingPhotoCarousel } from '../../components/LoopingPhotoCarousel';
import { Button } from '../../components/ui/Button';
import { useLanguage } from '../../context/LanguageContext';
import { useAuth } from '../../context/AuthContext';
import { customerApi } from '../../lib/api';
import { DEFAULT_AUTH_SLIDES, DEFAULT_HERO_SLIDES } from '../../lib/media';

interface ActiveSession {
  id: string;
  device_info: string;
  ip_address: string;
  created_at: string;
  expires_at: string;
}

export default function CustomerProfilePage() {
  const { language, setLanguage, t } = useLanguage();
  const {
    user,
    isAuthenticated,
    authenticatedFetch,
    updateUser,
    logout,
    sessionExpired,
    setSessionExpired,
  } = useAuth();

  const [authOpen, setAuthOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'OVERVIEW' | 'EDIT' | 'SECURITY' | 'DATA_RIGHTS'>('OVERVIEW');
  const [loading, setLoading] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; msg: string } | null>(null);

  const [profile, setProfile] = useState<any>(null);
  const [stats, setStats] = useState({
    upcoming_count: 0,
    completed_count: 0,
    cancelled_count: 0,
    no_show_count: 0,
  });
  const [sessions, setSessions] = useState<ActiveSession[]>([]);

  // Edit personal info
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [prefLang, setPrefLang] = useState<'vi' | 'en'>('vi');
  const [savingInfo, setSavingInfo] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Email change (2-step OTP)
  const [newEmail, setNewEmail] = useState('');
  const [emailCurrPass, setEmailCurrPass] = useState('');
  const [emailOtpStep, setEmailOtpStep] = useState(false);
  const [emailOtp, setEmailOtp] = useState('');
  const [emailLocalCode, setEmailLocalCode] = useState('');
  const [emailBusy, setEmailBusy] = useState(false);

  // Password change
  const [currPass, setCurrPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [passBusy, setPassBusy] = useState(false);

  // Marketing & Account deletion
  const [marketingOptIn, setMarketingOptIn] = useState(false);
  const [deletePass, setDeletePass] = useState('');
  const [deleteBusy, setDeleteBusy] = useState(false);

  const showToast = (ok: boolean, msg: string) => {
    setNotice({ ok, msg });
    setTimeout(() => setNotice((curr) => (curr?.msg === msg ? null : curr)), 5000);
  };

  const loadProfile = useCallback(async () => {
    if (!isAuthenticated) return;
    setLoading(true);
    try {
      const [meRes, sessRes] = await Promise.all([
        authenticatedFetch(`${customerApi}/me`),
        authenticatedFetch(`${customerApi}/me/sessions`),
      ]);
      if (meRes.ok) {
        const data = await meRes.json();
        setProfile(data.profile);
        if (data.stats) setStats(data.stats);
        setFullName(data.profile.full_name || '');
        setPhone(data.profile.phone_e164 || '');
        setPrefLang(data.profile.preferred_language === 'en' ? 'en' : 'vi');
        setMarketingOptIn(Boolean(data.profile.marketing_opt_in));
      }
      if (sessRes.ok) {
        setSessions((await sessRes.json()).sessions || []);
      }
    } catch {
      // Handled by authenticatedFetch session guard
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, authenticatedFetch]);

  useEffect(() => {
    loadProfile();
  }, [loadProfile]);

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingAvatar(true);
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const res = await authenticatedFetch(`${customerApi}/me/avatar`, {
        method: 'POST',
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || t('common.errorOccurred'));
      setProfile(data.profile);
      updateUser({ avatar_url: data.avatar_url, full_name: data.profile.full_name });
      showToast(true, t('profile.savedToast'));
    } catch (err: any) {
      showToast(false, err.message || t('common.errorOccurred'));
    } finally {
      setUploadingAvatar(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setSavingInfo(true);
    try {
      const res = await authenticatedFetch(`${customerApi}/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          preferred_language: prefLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || t('common.errorOccurred'));
      setProfile(data.profile);
      updateUser({
        full_name: data.profile.full_name,
        phone_e164: data.profile.phone_e164,
        preferred_language: data.profile.preferred_language,
      });
      if (prefLang !== language) {
        setLanguage(prefLang);
      }
      showToast(true, t('profile.savedToast'));
    } catch (err: any) {
      showToast(false, err.message || t('common.errorOccurred'));
    } finally {
      setSavingInfo(false);
    }
  };

  const handleRequestEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailBusy(true);
    try {
      const res = await authenticatedFetch(`${customerApi}/me/email/request-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ new_email: newEmail.trim(), current_password: emailCurrPass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || t('common.errorOccurred'));
      setEmailOtpStep(true);
      setEmailLocalCode(data.local_code || '');
      setEmailCurrPass('');
      showToast(true, data.local_code ? t('web.localOtpNotice') : t('web.smtpSentNotice', { email: newEmail }));
    } catch (err: any) {
      showToast(false, err.message || t('common.errorOccurred'));
    } finally {
      setEmailBusy(false);
    }
  };

  const handleConfirmEmailChange = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailBusy(true);
    try {
      const res = await authenticatedFetch(`${customerApi}/me/email/confirm-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ new_email: newEmail.trim(), otp: emailOtp.trim() }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || t('errors.OTP_INVALID'));
      setProfile(data.profile);
      updateUser({ email: data.profile.email }, data.access_token);
      setEmailOtpStep(false);
      setNewEmail('');
      setEmailOtp('');
      setEmailLocalCode('');
      showToast(true, t('profile.emailChangedToast'));
    } catch (err: any) {
      showToast(false, err.message || t('errors.OTP_INVALID'));
    } finally {
      setEmailBusy(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass !== confirmPass) {
      showToast(false, t('web.passwordMismatch'));
      return;
    }
    setPassBusy(true);
    try {
      const res = await authenticatedFetch(`${customerApi}/me/password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({
          current_password: currPass,
          new_password: newPass,
          confirm_password: confirmPass,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || t('common.errorOccurred'));
      updateUser({}, data.access_token);
      setCurrPass('');
      setNewPass('');
      setConfirmPass('');
      showToast(true, t('profile.passwordChangedToast'));
      loadProfile();
    } catch (err: any) {
      showToast(false, err.message || t('common.errorOccurred'));
    } finally {
      setPassBusy(false);
    }
  };

  const handleRevokeSession = async (id: string) => {
    await authenticatedFetch(`${customerApi}/me/sessions/${id}`, { method: 'DELETE' });
    loadProfile();
  };

  const handleLogoutAll = async () => {
    await authenticatedFetch(`${customerApi}/me/logout-all`, { method: 'POST' });
    logout();
  };

  const handleToggleMarketing = async (checked: boolean) => {
    setMarketingOptIn(checked);
    await authenticatedFetch(`${customerApi}/me/marketing-consent`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ opted_in: checked }),
    });
    showToast(true, t('profile.savedToast'));
  };

  const handleExportData = async () => {
    const res = await authenticatedFetch(`${customerApi}/me/export`);
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `court-booking-personal-data.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleDeleteAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    setDeleteBusy(true);
    try {
      const res = await authenticatedFetch(`${customerApi}/me/delete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({ current_password: deletePass }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || t('common.errorOccurred'));
      logout();
    } catch (err: any) {
      showToast(false, err.message || t('common.errorOccurred'));
    } finally {
      setDeleteBusy(false);
    }
  };

  const displayTitle = profile?.full_name || user?.full_name || profile?.username || user?.username || '';
  const avatarSrc = profile?.avatar_url || user?.avatar_url || null;

  return (
    <div className="customer-shell min-h-screen text-textBody pb-24 lg:pb-12">
      <Header onOpenAuthModal={() => setAuthOpen(true)} />

      <main className="max-w-[1120px] mx-auto px-4 sm:px-6 lg:px-8 py-6 lg:py-10 space-y-8">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-textStrong tracking-tight">
              {t('profile.title')}
            </h1>
            <p className="text-sm sm:text-base text-textMuted mt-1.5 max-w-[65ch]">
              {t('profile.subtitle')}
            </p>
          </div>
          <Link
            href="/"
            className="inline-flex items-center gap-2 min-h-[44px] px-4 rounded-token-full bg-panel border border-borderStrong text-sm font-semibold text-textStrong hover:bg-surfaceHover"
          >
            <ArrowLeft className="w-4 h-4 text-accent" />
            <span>{t('web.copy64')}</span>
          </Link>
        </div>

        {notice && (
          <div
            role="status"
            className={`p-4 rounded-token-md border text-sm font-semibold flex items-center gap-2.5 ${
              notice.ok
                ? 'bg-accent-soft border-accent-border text-accent'
                : 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
            }`}
          >
            {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{notice.msg}</span>
          </div>
        )}

        {!isAuthenticated ? (
          <section className="stage-enter-1 bg-panel rounded-token-lg overflow-hidden border border-borderStrong text-center">
            <LoopingPhotoCarousel
              images={DEFAULT_AUTH_SLIDES}
              alt=""
              className="h-44 border-b border-borderToken"
              showCounter={false}
              overlayClassName="bg-gradient-to-t from-panel via-page/30 to-transparent"
            />
            <div className="p-8 sm:p-12 space-y-5">
              <div className="w-16 h-16 rounded-token-full bg-accent-soft border border-accent-border text-accent flex items-center justify-center mx-auto">
                <User className="w-8 h-8" />
              </div>
              <h2 className="text-xl sm:text-2xl font-bold text-textStrong">{t('web.copy68')}</h2>
              <p className="text-sm text-textMuted max-w-md mx-auto">{t('web.loginRequired')}</p>
              <Button size="lg" onClick={() => setAuthOpen(true)}>
                {t('web.copy69')}
              </Button>
            </div>
          </section>
        ) : (
          <>
            {/* Identity Banner & Booking Metrics */}
            <section className="stage-enter-1 bg-panel rounded-token-lg overflow-hidden border border-borderStrong shadow-token-card">
              <LoopingPhotoCarousel
                images={DEFAULT_HERO_SLIDES}
                alt=""
                intervalMs={5000}
                className="h-36 sm:h-44 border-b border-borderToken"
                showCounter={false}
                overlayClassName="bg-gradient-to-t from-panel via-page/25 to-transparent"
              />
              <div className="p-6 sm:p-8 space-y-6">
              <div className="flex flex-col md:flex-row md:items-center justify-between gap-6">
                <div className="flex flex-col sm:flex-row sm:items-center gap-5">
                  <div className="relative shrink-0">
                    {avatarSrc ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={avatarSrc}
                        alt={displayTitle}
                        className="w-24 h-24 rounded-token-lg object-cover border-2 border-accent shadow-md"
                      />
                    ) : (
                      <div className="w-24 h-24 rounded-token-lg bg-panel-2 border-2 border-accent-border flex items-center justify-center text-3xl font-extrabold text-accent">
                        {(displayTitle || 'U').charAt(0).toUpperCase()}
                      </div>
                    )}
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      onChange={handleAvatarUpload}
                      className="sr-only"
                      id="customer-avatar-upload"
                    />
                    <button
                      type="button"
                      disabled={uploadingAvatar}
                      onClick={() => fileInputRef.current?.click()}
                      className="mt-2.5 w-full min-h-[38px] px-3 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-xs font-semibold text-textStrong flex items-center justify-center gap-1.5"
                    >
                      <Camera className="w-3.5 h-3.5 text-accent" />
                      <span>{uploadingAvatar ? t('profile.uploadingAvatar') : t('profile.uploadAvatar')}</span>
                    </button>
                  </div>

                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="px-3 py-1 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold inline-flex items-center gap-1.5">
                        <Award className="w-3.5 h-3.5" />
                        <span>{t('profile.roleBadge')}</span>
                      </span>
                      <span className="px-3 py-1 rounded-token-full bg-panel-2 border border-borderToken text-textStrong text-xs font-semibold inline-flex items-center gap-1.5">
                        <CheckCircle2 className="w-3.5 h-3.5 text-accent" />
                        <span>{t('profile.verifiedEmail')}</span>
                      </span>
                    </div>

                    <h2 className="text-2xl sm:text-3xl font-extrabold text-textStrong tracking-tight">
                      {displayTitle}
                    </h2>

                    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-textBody tabular-nums">
                      <span className="font-mono text-textMuted">@{profile?.username || user?.username}</span>
                      <span className="inline-flex items-center gap-1.5">
                        <Mail className="w-4 h-4 text-accent" />
                        <span>{profile?.email || user?.email}</span>
                      </span>
                      {profile?.phone_e164 && (
                        <span className="inline-flex items-center gap-1.5">
                          <Phone className="w-4 h-4 text-accent" />
                          <span>{profile.phone_e164}</span>
                        </span>
                      )}
                      {profile?.created_at && (
                        <span className="inline-flex items-center gap-1.5 text-textMuted">
                          <Calendar className="w-4 h-4 text-accent" />
                          <span>
                            {t('profile.memberSince')}{' '}
                            {new Date(profile.created_at).toLocaleDateString(language === 'vi' ? 'vi-VN' : 'en-US')}
                          </span>
                        </span>
                      )}
                    </div>
                    <p className="text-xs text-textMuted">{t('profile.avatarHint')}</p>
                  </div>
                </div>
              </div>

              {/* Activity Counters */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 pt-2 border-t border-borderToken tabular-nums">
                <div className="bg-panel-2 rounded-token-md p-4 border border-borderToken">
                  <span className="text-xs text-textMuted block">{t('profile.statsUpcoming')}</span>
                  <strong className="text-2xl font-extrabold text-accent mt-1 block">{stats.upcoming_count}</strong>
                </div>
                <div className="bg-panel-2 rounded-token-md p-4 border border-borderToken">
                  <span className="text-xs text-textMuted block">{t('profile.statsCompleted')}</span>
                  <strong className="text-2xl font-extrabold text-textStrong mt-1 block">{stats.completed_count}</strong>
                </div>
                <div className="bg-panel-2 rounded-token-md p-4 border border-borderToken">
                  <span className="text-xs text-textMuted block">{t('profile.statsCancelled')}</span>
                  <strong className="text-2xl font-extrabold text-textBody mt-1 block">{stats.cancelled_count}</strong>
                </div>
                <div className="bg-panel-2 rounded-token-md p-4 border border-borderToken">
                  <span className="text-xs text-textMuted block">{t('profile.statsNoShow')}</span>
                  <strong className="text-2xl font-extrabold text-statusWarning mt-1 block">{stats.no_show_count}</strong>
                </div>
              </div>
              </div>
            </section>

            {/* Sub-navigation Tabs */}
            <div className="flex flex-wrap gap-2">
              {(
                [
                  { id: 'OVERVIEW', label: language === 'vi' ? 'Quyền Hạn & Nghĩa Vụ' : 'Capabilities & Rules', icon: ShieldCheck },
                  { id: 'EDIT', label: language === 'vi' ? 'Chỉnh Sửa Tên & Email' : 'Edit Name & Email', icon: User },
                  { id: 'SECURITY', label: language === 'vi' ? 'Mật Khẩu & Thiết Bị' : 'Password & Devices', icon: Lock },
                  { id: 'DATA_RIGHTS', label: language === 'vi' ? 'Quyền Dữ Liệu (C-06)' : 'Data Rights (C-06)', icon: Download },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`min-h-[44px] px-4 rounded-token-full text-sm font-semibold flex items-center gap-2 border ${
                      active
                        ? 'bg-accent text-textOnAccent border-accent font-bold'
                        : 'bg-panel text-textBody border-borderToken hover:text-textStrong hover:bg-surfaceHover'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{item.label}</span>
                  </button>
                );
              })}
            </div>

            {/* TAB 1: ROLE CAPABILITIES & OBLIGATIONS */}
            {activeTab === 'OVERVIEW' && (
              <section className="tab-panel-anim grid md:grid-cols-2 gap-6">
                <div className="bg-panel rounded-token-lg p-6 sm:p-7 border border-borderStrong space-y-4">
                  <h3 className="text-lg sm:text-xl font-bold text-textStrong flex items-center gap-2.5">
                    <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
                    <span>{t('profile.capabilitiesTitle')}</span>
                  </h3>
                  <ul className="space-y-3 text-sm leading-relaxed text-textBody">
                    {(['cap1', 'cap2', 'cap3', 'cap4'] as const).map((k) => (
                      <li key={k} className="flex items-start gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-accent mt-2 shrink-0" />
                        <span>{t(`profile.${k}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>

                <div className="bg-panel rounded-token-lg p-6 sm:p-7 border border-borderStrong space-y-4">
                  <h3 className="text-lg sm:text-xl font-bold text-textStrong flex items-center gap-2.5">
                    <ShieldCheck className="w-5 h-5 text-statusWarning shrink-0" />
                    <span>{t('profile.obligationsTitle')}</span>
                  </h3>
                  <ul className="space-y-3 text-sm leading-relaxed text-textBody">
                    {(['ob1', 'ob2', 'ob3', 'ob4'] as const).map((k) => (
                      <li key={k} className="flex items-start gap-2.5">
                        <span className="w-2 h-2 rounded-full bg-statusWarning mt-2 shrink-0" />
                        <span>{t(`profile.${k}`)}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </section>
            )}

            {/* TAB 2: EDIT PERSONAL DETAILS & 2-STEP EMAIL CHANGE */}
            {activeTab === 'EDIT' && (
              <section className="tab-panel-anim grid lg:grid-cols-2 gap-6">
                <form
                  onSubmit={handleSaveProfile}
                  className="bg-panel rounded-token-lg p-6 sm:p-7 border border-borderStrong space-y-4"
                >
                  <h3 className="text-lg font-bold text-textStrong">{t('profile.personalInfoTitle')}</h3>

                  <div>
                    <label htmlFor="prof-fullname" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('profile.fullNameLabel')}
                    </label>
                    <input
                      id="prof-fullname"
                      type="text"
                      maxLength={120}
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="prof-phone" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('profile.phoneLabel')}
                    </label>
                    <input
                      id="prof-phone"
                      type="tel"
                      value={phone}
                      onChange={(e) => setPhone(e.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong tabular-nums focus:border-accent outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="prof-lang" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('common.language')}
                    </label>
                    <select
                      id="prof-lang"
                      value={prefLang}
                      onChange={(e) => setPrefLang(e.target.value as 'vi' | 'en')}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    >
                      <option value="vi">Tiếng Việt</option>
                      <option value="en">English</option>
                    </select>
                  </div>

                  <Button type="submit" disabled={savingInfo || loading} className="w-full">
                    {savingInfo ? t('common.loading') : t('profile.saveProfile')}
                  </Button>
                </form>

                {/* Email Change with OTP Verification */}
                <div className="bg-panel rounded-token-lg p-6 sm:p-7 border border-borderStrong space-y-4">
                  <h3 className="text-lg font-bold text-textStrong">{t('profile.emailChangeTitle')}</h3>

                  {!emailOtpStep ? (
                    <form onSubmit={handleRequestEmailChange} className="space-y-4">
                      <div>
                        <label htmlFor="prof-new-email" className="block text-sm font-medium text-textBody mb-1.5">
                          {t('profile.newEmailLabel')}
                        </label>
                        <input
                          id="prof-new-email"
                          type="email"
                          required
                          value={newEmail}
                          onChange={(e) => setNewEmail(e.target.value)}
                          className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                        />
                      </div>

                      <div>
                        <label htmlFor="prof-email-pass" className="block text-sm font-medium text-textBody mb-1.5">
                          {t('profile.currentPasswordLabel')}
                        </label>
                        <input
                          id="prof-email-pass"
                          type="password"
                          required
                          value={emailCurrPass}
                          onChange={(e) => setEmailCurrPass(e.target.value)}
                          className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                        />
                      </div>

                      <Button type="submit" variant="secondary" disabled={emailBusy} className="w-full">
                        {emailBusy ? t('common.loading') : t('profile.requestEmailOtp')}
                      </Button>
                    </form>
                  ) : (
                    <form onSubmit={handleConfirmEmailChange} className="space-y-4">
                      {emailLocalCode && (
                        <div className="p-3.5 rounded-token-md bg-statusWarning-soft border border-statusWarning-border space-y-2">
                          <p className="text-xs text-statusWarning font-semibold">{t('web.localOtpLabel')}</p>
                          <output className="block text-center font-mono text-2xl font-bold tracking-[.3em] text-statusWarning tabular-nums">
                            {emailLocalCode}
                          </output>
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="w-full"
                            onClick={() => setEmailOtp(emailLocalCode)}
                          >
                            {t('web.useLocalCode')}
                          </Button>
                        </div>
                      )}

                      <div>
                        <label htmlFor="prof-email-otp" className="block text-sm font-medium text-textBody mb-1.5">
                          {t('web.copy14')} ({newEmail})
                        </label>
                        <input
                          id="prof-email-otp"
                          type="text"
                          inputMode="numeric"
                          maxLength={6}
                          required
                          value={emailOtp}
                          onChange={(e) => setEmailOtp(e.target.value.replace(/\D/g, ''))}
                          className="w-full min-h-[50px] text-center font-mono text-2xl tracking-[.35em] bg-panel-2 border border-borderStrong rounded-token-md text-textStrong tabular-nums focus:border-accent outline-none"
                        />
                      </div>

                      <div className="flex gap-2">
                        <Button type="submit" disabled={emailBusy || emailOtp.length !== 6} className="flex-1">
                          {t('profile.confirmEmailChange')}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={() => {
                            setEmailOtpStep(false);
                            setEmailLocalCode('');
                          }}
                        >
                          {t('common.cancel')}
                        </Button>
                      </div>
                    </form>
                  )}
                </div>
              </section>
            )}

            {/* TAB 3: PASSWORD & MULTI-DEVICE ACTIVE SESSIONS */}
            {activeTab === 'SECURITY' && (
              <section className="tab-panel-anim grid lg:grid-cols-2 gap-6">
                <form
                  onSubmit={handleChangePassword}
                  className="bg-panel rounded-token-lg p-6 sm:p-7 border border-borderStrong space-y-4"
                >
                  <h3 className="text-lg font-bold text-textStrong">{t('auth.changePassword')}</h3>

                  <div>
                    <label htmlFor="sec-curr-pass" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('profile.currentPasswordLabel')}
                    </label>
                    <input
                      id="sec-curr-pass"
                      type="password"
                      required
                      value={currPass}
                      onChange={(e) => setCurrPass(e.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="sec-new-pass" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('web.newPassword')}
                    </label>
                    <input
                      id="sec-new-pass"
                      type="password"
                      minLength={8}
                      required
                      value={newPass}
                      onChange={(e) => setNewPass(e.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    />
                  </div>

                  <div>
                    <label htmlFor="sec-confirm-pass" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('web.confirmPassword')}
                    </label>
                    <input
                      id="sec-confirm-pass"
                      type="password"
                      minLength={8}
                      required
                      value={confirmPass}
                      onChange={(e) => setConfirmPass(e.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                    />
                  </div>

                  <Button type="submit" disabled={passBusy} className="w-full">
                    {passBusy ? t('common.loading') : t('profile.updatePasswordBtn')}
                  </Button>
                </form>

                {/* Active Device Refresh Sessions */}
                <div className="bg-panel rounded-token-lg p-6 sm:p-7 border border-borderStrong space-y-4">
                  <div className="flex items-center justify-between gap-3">
                    <h3 className="text-lg font-bold text-textStrong flex items-center gap-2">
                      <Smartphone className="w-5 h-5 text-accent" />
                      <span>{t('profile.activeSessionsTitle')} ({sessions.length})</span>
                    </h3>
                    <button
                      type="button"
                      onClick={handleLogoutAll}
                      className="min-h-[38px] px-3 rounded-token-full bg-statusDanger-soft border border-statusDanger-border text-statusDanger text-xs font-bold inline-flex items-center gap-1.5"
                    >
                      <LogOut className="w-3.5 h-3.5" />
                      <span>{t('profile.logoutAllDevices')}</span>
                    </button>
                  </div>

                  <div className="space-y-2.5 max-h-[300px] overflow-y-auto pr-1">
                    {sessions.map((s) => (
                      <div
                        key={s.id}
                        className="p-3.5 rounded-token-md bg-panel-2 border border-borderToken flex items-center justify-between gap-3"
                      >
                        <div className="min-w-0">
                          <p className="text-sm font-semibold text-textStrong truncate">{s.device_info}</p>
                          <p className="text-xs text-textMuted tabular-nums mt-0.5">
                            IP: {s.ip_address || 'Local'} ·{' '}
                            {new Date(s.created_at).toLocaleString(language === 'vi' ? 'vi-VN' : 'en-US')}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => handleRevokeSession(s.id)}
                          className="min-h-[36px] px-3 rounded-token-full bg-panel border border-borderStrong text-xs font-semibold text-textBody hover:text-statusDanger shrink-0"
                        >
                          {t('profile.revokeDevice')}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </section>
            )}

            {/* TAB 4: MARKETING PREFERENCES & C-06 DATA RIGHTS */}
            {activeTab === 'DATA_RIGHTS' && (
              <section className="tab-panel-anim grid lg:grid-cols-2 gap-6">
                <div className="bg-panel rounded-token-lg p-6 sm:p-7 border border-borderStrong space-y-6">
                  <div className="space-y-3">
                    <h3 className="text-lg font-bold text-textStrong flex items-center gap-2">
                      <Bell className="w-5 h-5 text-accent" />
                      <span>{t('profile.marketingTitle')}</span>
                    </h3>
                    <label className="flex items-start gap-3 cursor-pointer p-3.5 rounded-token-md bg-panel-2 border border-borderToken">
                      <input
                        type="checkbox"
                        checked={marketingOptIn}
                        onChange={(e) => handleToggleMarketing(e.target.checked)}
                        className="w-5 h-5 mt-0.5 accent-[var(--accent)] shrink-0"
                      />
                      <span className="text-sm leading-relaxed text-textBody">
                        {t('profile.marketingConsentLabel')}
                      </span>
                    </label>
                  </div>

                  <div className="pt-4 border-t border-borderToken space-y-3">
                    <h3 className="text-lg font-bold text-textStrong flex items-center gap-2">
                      <Download className="w-5 h-5 text-accent" />
                      <span>{t('profile.dataRightsTitle')}</span>
                    </h3>
                    <Button type="button" variant="secondary" onClick={handleExportData} className="w-full">
                      <Download className="w-4 h-4 mr-2" />
                      <span>{t('profile.exportDataBtn')}</span>
                    </Button>
                  </div>
                </div>

                <form
                  onSubmit={handleDeleteAccount}
                  className="bg-panel rounded-token-lg p-6 sm:p-7 border border-statusDanger-border space-y-4"
                >
                  <h3 className="text-lg font-bold text-statusDanger flex items-center gap-2">
                    <Trash2 className="w-5 h-5" />
                    <span>{t('profile.deleteAccountBtn')}</span>
                  </h3>
                  <p className="text-sm text-textBody leading-relaxed">{t('profile.deleteWarning')}</p>

                  <div>
                    <label htmlFor="del-acc-pass" className="block text-sm font-medium text-textBody mb-1.5">
                      {t('profile.currentPasswordLabel')}
                    </label>
                    <input
                      id="del-acc-pass"
                      type="password"
                      required
                      value={deletePass}
                      onChange={(e) => setDeletePass(e.target.value)}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-statusDanger outline-none"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={deleteBusy || !deletePass}
                    className="w-full min-h-[46px] rounded-token-full bg-statusDanger-soft hover:bg-statusDanger text-statusDanger hover:text-textOnAccent border border-statusDanger-border font-bold text-sm disabled:opacity-50"
                  >
                    {deleteBusy ? t('common.loading') : t('profile.deleteAccountBtn')}
                  </button>
                </form>
              </section>
            )}
          </>
        )}
      </main>

      <AuthModal
        isOpen={authOpen}
        onClose={() => {
          setAuthOpen(false);
          setSessionExpired(false);
        }}
        initialTab="LOGIN"
        sessionExpiredNotice={sessionExpired}
      />
    </div>
  );
}

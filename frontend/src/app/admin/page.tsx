'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  Building2,
  BarChart3,
  Lock,
  ShieldCheck,
  Upload,
  Users,
  AlertTriangle,
  CheckCircle2,
  LogOut,
  Image as ImageIcon,
  RefreshCw,
  TrendingUp,
  Plus,
  X,
  Landmark,
  Layers,
  User,
  Trash2,
  Star,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { adminApi } from '../../lib/api';
import { DEFAULT_OPS_SLIDES, resolveVenueGallery } from '../../lib/media';
import { vietnamDate } from '../../../../shared/booking';
import { AdminExecutiveCharts } from '../../components/admin/AdminExecutiveCharts';
import { AdminExtensionsSuite } from '../../components/admin/AdminExtensionsSuite';
import { AdminReviewsManager } from '../../components/admin/AdminReviewsManager';
import { LoopingPhotoCarousel } from '../../components/LoopingPhotoCarousel';
import { OperatorProfilePanel } from '../../components/OperatorProfilePanel';

type AdminTab =
  | 'DASHBOARD'
  | 'EXTENSIONS'
  | 'REVIEWS'
  | 'BANK_REFUNDS'
  | 'MAINTENANCE'
  | 'STAFF'
  | 'PHOTOS'
  | 'PROFILE';

export default function AdminPage() {
  const { language, toggleLanguage } = useLanguage();
  const isEn = language === 'en';

  const [token, setToken] = useState<string | null>(null);
  const [adminUser, setAdminUser] = useState<any>(null);

  useEffect(() => {
    const savedT = localStorage.getItem('court_admin_token');
    const savedU = localStorage.getItem('court_admin_user');
    if (savedT && savedU) {
      try {
        setToken(savedT);
        setAdminUser(JSON.parse(savedU));
      } catch {
        localStorage.removeItem('court_admin_token');
      }
    }
  }, []);

  // Strictly empty login fields — zero pre-filled credentials or personal identity hints
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [twoFactorCode, setTwoFactorCode] = useState('');
  const [requires2fa, setRequires2fa] = useState(false);
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  const [activeTab, setActiveTab] = useState<AdminTab>('DASHBOARD');
  const [extInitialModule, setExtInitialModule] = useState<string>('CONFIG_PRICING');
  const [toast, setToast] = useState<{ ok: boolean; msg: string } | null>(null);

  const [startDate, setStartDate] = useState(() => vietnamDate(new Date(Date.now() - 29 * 86400000)));
  const [endDate, setEndDate] = useState(() => vietnamDate());
  const [reportVenueFilter, setReportVenueFilter] = useState('');
  const [reportData, setReportData] = useState<any>(null);
  const [venues, setVenues] = useState<any[]>([]);
  const [courts, setCourts] = useState<any[]>([]);
  const [staffList, setStaffList] = useState<any[]>([]);
  const [reconciliation, setReconciliation] = useState<any>({ review_bookings: [], refunds: [] });
  const [dataLoading, setDataLoading] = useState(false);

  // Bank Settings State
  const [bankId, setBankId] = useState('MB');
  const [accountNumber, setAccountNumber] = useState('');
  const [accountName, setAccountName] = useState('');
  const [verifiedByOwner, setVerifiedByOwner] = useState(false);
  const [sandboxMode, setSandboxMode] = useState(true);
  const [bankSaving, setBankSaving] = useState(false);

  // Block state
  const [blockVenueId, setBlockVenueId] = useState('');
  const [blockCourtId, setBlockCourtId] = useState('');
  const [blockStart, setBlockStart] = useState('');
  const [blockEnd, setBlockEnd] = useState('');
  const [blockReason, setBlockReason] = useState('Bảo trì mặt sân và hệ thống chiếu sáng');
  const [blockLoading, setBlockLoading] = useState(false);

  // Multi-photo gallery upload & reorder
  const [uploadVenueId, setUploadVenueId] = useState('');
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [setUploadAsCover, setSetUploadAsCover] = useState(true);
  const [uploadLoading, setUploadLoading] = useState(false);

  // Staff creation
  const [showStaffModal, setShowStaffModal] = useState(false);
  const [newStaffFullName, setNewStaffFullName] = useState('');
  const [newStaffUsername, setNewStaffUsername] = useState('');
  const [newStaffPhone, setNewStaffPhone] = useState('');
  const [newStaffRole, setNewStaffRole] = useState<'STAFF' | 'MANAGER'>('STAFF');
  const [createdCredentials, setCreatedCredentials] = useState<{ username: string; tempPass: string } | null>(null);

  const notify = (ok: boolean, msg: string) => {
    setToast({ ok, msg });
    setTimeout(() => setToast((c) => (c?.msg === msg ? null : c)), 4500);
  };

  const getAuthHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      'Accept-Language': language,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [language, token]
  );

  const handleLogout = useCallback(() => {
    setToken(null);
    setAdminUser(null);
    localStorage.removeItem('court_admin_token');
    localStorage.removeItem('court_admin_user');
  }, []);

  const fetchDashboardData = useCallback(async () => {
    if (!token) return;
    setDataLoading(true);
    try {
      const headers = { 'Accept-Language': language, Authorization: `Bearer ${token}` };
      const venueQuery = reportVenueFilter ? `&venue_id=${encodeURIComponent(reportVenueFilter)}` : '';
      const [meRes, revRes, venuesRes, courtsRes, bankRes, recRes] = await Promise.all([
        fetch(`${adminApi}/me`, { headers }),
        fetch(`${adminApi}/reports/revenue?start_date=${startDate}&end_date=${endDate}${venueQuery}`, { headers }),
        fetch(`${adminApi}/venues`, { headers }),
        fetch(`${adminApi}/courts`, { headers }),
        fetch(`${adminApi}/settings/bank-account`, { headers }),
        fetch(`${adminApi}/reconciliation`, { headers }),
      ]);

      if (revRes.status === 401 || meRes.status === 401) {
        handleLogout();
        return;
      }
      if (meRes.ok) {
        const md = await meRes.json();
        if (md.profile) {
          setAdminUser((prev: any) => {
            const next = { ...prev, ...md.profile };
            localStorage.setItem('court_admin_user', JSON.stringify(next));
            return next;
          });
        }
      }
      if (revRes.ok) setReportData(await revRes.json());
      if (venuesRes.ok) {
        const vList = (await venuesRes.json()).venues || [];
        setVenues(vList);
        if (vList.length > 0) {
          setBlockVenueId((curr) => curr || vList[0].id);
          setUploadVenueId((curr) => curr || vList[0].id);
        }
      }
      if (courtsRes.ok) {
        const cList = (await courtsRes.json()).courts || [];
        setCourts(cList);
        if (cList.length > 0) setBlockCourtId((curr) => curr || cList[0].id);
      }
      if (bankRes.ok) {
        const b = (await bankRes.json()).bank_account;
        if (b) {
          setBankId(b.bank_id || 'MB');
          setAccountNumber(b.account_number || '');
          setAccountName(b.account_name || '');
          setVerifiedByOwner(Boolean(b.verified_by_owner));
          setSandboxMode(Boolean(b.sandbox_mode));
        }
      }
      if (recRes.ok) setReconciliation(await recRes.json());
    } finally {
      setDataLoading(false);
    }
  }, [token, language, startDate, endDate, reportVenueFilter, handleLogout]);

  const fetchStaffData = useCallback(async () => {
    if (!token) return;
    const res = await fetch(`${adminApi}/staff`, {
      headers: { 'Accept-Language': language, Authorization: `Bearer ${token}` },
    });
    if (res.ok) setStaffList((await res.json()).staff || []);
  }, [token, language]);

  useEffect(() => {
    if (token) fetchDashboardData();
  }, [token, fetchDashboardData]);

  useEffect(() => {
    if (token && activeTab === 'STAFF') fetchStaffData();
  }, [token, activeTab, fetchStaffData]);

  useEffect(() => {
    const tomorrow = new Date(Date.now() + 86400000);
    tomorrow.setHours(8, 0, 0, 0);
    const tomorrowEnd = new Date(tomorrow);
    tomorrowEnd.setHours(10, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const toIsoLocal = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setBlockStart(toIsoLocal(tomorrow));
    setBlockEnd(toIsoLocal(tomorrowEnd));
  }, []);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${adminApi}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({
          username: loginIdentifier.trim(),
          email: loginIdentifier.trim(),
          password,
          totp_code: twoFactorCode || undefined,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        if (data.requires_2fa) {
          setRequires2fa(true);
          return;
        }
        throw new Error(data.message || 'Đăng nhập quản trị thất bại');
      }
      setToken(data.access_token);
      setAdminUser(data.admin);
      setPassword('');
      localStorage.setItem('court_admin_token', data.access_token);
      localStorage.setItem('court_admin_user', JSON.stringify(data.admin));
    } catch (err: any) {
      setLoginError(err.message || 'Lỗi xác thực');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleSaveBank = async (e: React.FormEvent) => {
    e.preventDefault();
    setBankSaving(true);
    try {
      const res = await fetch(`${adminApi}/settings/bank-account`, {
        method: 'PUT',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          bank_id: bankId,
          account_number: accountNumber,
          account_name: accountName,
          verified_by_owner: verifiedByOwner,
          sandbox_mode: sandboxMode,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(true, data.message);
        fetchDashboardData();
      } else {
        notify(false, data.message || 'Không thể lưu cấu hình ngân hàng.');
      }
    } finally {
      setBankSaving(false);
    }
  };

  const handleApproveRefund = async (refundId: string) => {
    const res = await fetch(`${adminApi}/refunds/${refundId}/complete`, {
      method: 'POST',
      headers: getAuthHeaders(),
    });
    const data = await res.json();
    if (res.ok) {
      notify(true, data.message || 'Đã hoàn cọc thành công.');
      fetchDashboardData();
    } else {
      notify(false, data.message || 'Thao tác thất bại.');
    }
  };

  const handleBlockCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!blockCourtId || !blockVenueId) return;
    setBlockLoading(true);
    try {
      const res = await fetch(`${adminApi}/blocks`, {
        method: 'POST',
        headers: getAuthHeaders(),
        body: JSON.stringify({
          venue_id: blockVenueId,
          court_id: blockCourtId,
          start_at: new Date(blockStart).toISOString(),
          end_at: new Date(blockEnd).toISOString(),
          reason: blockReason,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        notify(true, data.message || 'Khóa sân bảo trì thành công.');
        fetchDashboardData();
      } else {
        notify(false, data.message || 'Không thể khóa sân.');
      }
    } finally {
      setBlockLoading(false);
    }
  };

  const handleUploadPhoto = async (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedFiles.length === 0) return;
    setUploadLoading(true);
    const formData = new FormData();
    for (const f of selectedFiles) {
      formData.append('photos', f);
    }
    if (uploadVenueId) formData.append('venue_id', uploadVenueId);
    formData.append('set_as_cover', setUploadAsCover ? 'true' : 'false');

    try {
      const res = await fetch(`${adminApi}/uploads`, {
        method: 'POST',
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: formData,
      });
      const data = await res.json();
      if (res.ok) {
        notify(true, data.message || 'Đã cập nhật thư viện ảnh cơ sở!');
        setSelectedFiles([]);
        fetchDashboardData();
      } else {
        notify(false, data.message || 'Upload thất bại');
      }
    } finally {
      setUploadLoading(false);
    }
  };

  const handleUpdateVenueGallery = async (venueId: string, nextPhotos: string[], nextCover?: string | null) => {
    const res = await fetch(`${adminApi}/venues/${venueId}/photos`, {
      method: 'PUT',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        photos: nextPhotos,
        cover_photo_url: nextCover !== undefined ? nextCover : nextPhotos[0] || null,
      }),
    });
    const data = await res.json();
    if (res.ok) {
      notify(true, data.message || 'Đã lưu thay đổi thư viện ảnh.');
      fetchDashboardData();
    } else {
      notify(false, data.message || 'Không thể cập nhật thư viện ảnh.');
    }
  };

  const handleCreateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/staff`, {
      method: 'POST',
      headers: getAuthHeaders(),
      body: JSON.stringify({
        full_name: newStaffFullName.trim(),
        username: newStaffUsername.trim(),
        phone: newStaffPhone.trim(),
        role: newStaffRole,
        venue_ids: venues.map((v) => v.id),
      }),
    });
    const data = await res.json();
    if (res.ok) {
      setCreatedCredentials({ username: data.staff.username, tempPass: data.temporary_password });
      fetchStaffData();
      setNewStaffFullName('');
      setNewStaffUsername('');
      setNewStaffPhone('');
    } else {
      notify(false, data.message || 'Không thể tạo nhân viên');
    }
  };

  const formatVnd = (amount: number) =>
    new Intl.NumberFormat('vi-VN').format(Number(amount || 0)) + ' ₫';

  return (
    <div className="ops-shell min-h-screen bg-page text-textBody flex flex-col font-sans">
      <header className="sticky top-0 z-30 h-16 bg-accent-pressed border-b border-borderStrong px-4 sm:px-8 flex items-center justify-between text-textStrong shadow-md">
        <div className="flex items-center space-x-3 min-w-0">
          <div className="w-9 h-9 bg-panel rounded-token-sm flex items-center justify-center border border-accent-border shrink-0">
            <Building2 className="w-5 h-5 text-accent" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center space-x-2">
              <span className="bg-page text-accent border border-accent-border text-[11px] font-extrabold px-2 py-0.5 rounded uppercase shrink-0">
                QUẢN TRỊ
              </span>
              <h1 className="font-extrabold text-sm sm:text-base tracking-tight text-textStrong truncate">
                {adminUser?.tenant_name || (isEn ? 'Tenant Administration Portal' : 'Cổng Quản Trị Chủ Sân')}
              </h1>
            </div>
            <p className="text-xs text-textBody hidden sm:block truncate">
              {adminUser
                ? `${adminUser.full_name} (${adminUser.role === 'OWNER' ? (isEn ? 'Owner' : 'Chủ Sân') : isEn ? 'Manager' : 'Quản Lý'})`
                : isEn
                  ? 'Owner & Venue Manager Console'
                  : 'Quản lý doanh thu, lịch sân và vận hành'}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 shrink-0">
          <button
            type="button"
            onClick={toggleLanguage}
            className="min-h-[38px] px-2.5 rounded-token-sm bg-panel hover:bg-surfaceHover border border-borderStrong text-xs font-bold text-textStrong"
          >
            <span className={language === 'vi' ? 'text-accent' : 'text-textMuted'}>VI</span>
            <span className="mx-1 text-borderStrong">|</span>
            <span className={language === 'en' ? 'text-accent' : 'text-textMuted'}>EN</span>
          </button>

          <Link
            href="/"
            className="text-xs text-textStrong px-3 py-2 rounded-token-sm bg-panel hover:bg-surfaceHover border border-borderStrong"
          >
            ← {isEn ? 'Customer Web' : 'Web Khách Hàng'}
          </Link>

          {token && (
            <>
              <button
                type="button"
                onClick={() => setActiveTab('PROFILE')}
                className="min-h-[38px] px-2.5 rounded-token-full bg-panel hover:bg-surfaceHover border border-borderStrong text-xs font-semibold text-textStrong flex items-center gap-1.5"
              >
                {adminUser?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={adminUser.avatar_url} alt="" className="w-5 h-5 rounded-token-full object-cover" />
                ) : (
                  <User className="w-3.5 h-3.5 text-accent" />
                )}
                <span className="hidden md:inline max-w-[100px] truncate">{adminUser?.full_name}</span>
              </button>

              <button
                type="button"
                onClick={handleLogout}
                className="text-xs text-statusDanger px-3 py-2 rounded-token-sm bg-panel hover:bg-statusDanger-soft border border-statusDanger-border flex items-center gap-1"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">{isEn ? 'Log out' : 'Đăng xuất'}</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-[1240px] mx-auto p-4 sm:p-6 lg:p-8 w-full flex-1 space-y-6">
        {toast && (
          <div
            role="status"
            className={`p-4 rounded-token-md border text-sm font-semibold flex items-center justify-between ${
              toast.ok
                ? 'bg-accent-soft border-accent-border text-accent'
                : 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
            }`}
          >
            <span>{toast.msg}</span>
            <button type="button" onClick={() => setToast(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!token ? (
          <div className="stage-enter-1 max-w-4xl mx-auto mt-6 lg:mt-10 bg-panel rounded-token-lg overflow-hidden border border-borderStrong shadow-token-elevated grid grid-cols-1 lg:grid-cols-[1.08fr_1fr]">
            <LoopingPhotoCarousel
              images={DEFAULT_OPS_SLIDES}
              alt="Cổng quản trị chủ sân"
              intervalMs={4600}
              className="h-44 sm:h-56 lg:h-full lg:min-h-[460px] border-b lg:border-b-0 lg:border-r border-borderToken"
              showControls={true}
              showCounter={false}
              overlayClassName="carousel-vignette-deep"
            >
              <div className="h-full flex flex-col justify-end p-5 sm:p-7 space-y-2 pointer-events-none">
                <span className="w-fit px-3 py-1 rounded-token-full bg-overlay backdrop-blur-sm border border-accent-border text-accent text-xs font-bold">
                  {isEn ? 'VENUE OWNER & MANAGER CONSOLE' : 'QUẢN TRỊ CHỦ SÂN · ĐA CƠ SỞ'}
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-textStrong leading-snug">
                  {isEn
                    ? 'Track net revenue, court occupancy heatmaps, pricing rules, and multi-photo venue galleries.'
                    : 'Quản lý doanh thu ròng, mật độ lấp đầy, bảng giá ca giờ và thư viện ảnh lặp tự động.'}
                </p>
              </div>
            </LoopingPhotoCarousel>

            <div className="p-6 sm:p-8 flex flex-col justify-center space-y-6">
              <div className="space-y-2">
                <div className="w-11 h-11 bg-accent-soft text-accent rounded-token-md flex items-center justify-center border border-accent-border">
                  <ShieldCheck className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-textStrong">
                  {isEn ? 'Tenant Admin Sign In' : 'Đăng Nhập Quản Trị Chủ Sân'}
                </h2>
                <p className="text-xs text-textMuted">
                  {isEn
                    ? 'Authorized strictly for Venue Owners and Managers.'
                    : 'Dành riêng cho tài khoản Chủ sân (Owner) và Quản lý cơ sở (Manager).'}
                </p>
              </div>

              {loginError && (
                <div
                  role="alert"
                  className="p-3 bg-statusDanger-soft border border-statusDanger-border text-statusDanger rounded-token-md text-xs flex items-center gap-2"
                >
                  <AlertTriangle className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4 text-sm">
                <div>
                  <label htmlFor="admin-login-id" className="block text-xs font-semibold text-textBody mb-1.5">
                    {isEn ? 'Email or Username' : 'Email hoặc Tên đăng nhập'}
                  </label>
                  <input
                    id="admin-login-id"
                    type="text"
                    autoComplete="username"
                    value={loginIdentifier}
                    onChange={(e) => setLoginIdentifier(e.target.value)}
                    className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong outline-none focus:border-accent"
                    required
                  />
                </div>
                <div>
                  <label htmlFor="admin-login-pw" className="block text-xs font-semibold text-textBody mb-1.5">
                    {isEn ? 'Password' : 'Mật khẩu'}
                  </label>
                  <input
                    id="admin-login-pw"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong outline-none focus:border-accent"
                    required
                  />
                </div>
                {requires2fa && (
                  <div>
                    <label htmlFor="admin-2fa" className="block text-xs font-semibold text-accent mb-1.5">
                      {isEn ? '6-Digit Authenticator Code (2FA)' : 'Mã xác thực 2FA (6 chữ số)'}
                    </label>
                    <input
                      id="admin-2fa"
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      value={twoFactorCode}
                      onChange={(e) => setTwoFactorCode(e.target.value.replace(/\D/g, ''))}
                      className="w-full min-h-[46px] px-4 bg-panel-2 border border-accent rounded-token-md text-center font-mono text-lg text-textStrong tabular-nums"
                      required
                    />
                  </div>
                )}
                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full min-h-[46px] bg-accent hover:bg-accent-hover text-textOnAccent font-bold rounded-token-full shadow-md"
                >
                  {loginLoading ? (isEn ? 'Signing in...' : 'Đang xác thực...') : isEn ? 'Sign In' : 'Đăng Nhập Quản Trị'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Primary Navigation Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-borderToken pb-3">
              {(
                [
                  { id: 'DASHBOARD', icon: BarChart3, label: isEn ? 'Executive Dashboard' : 'Dashboard & Biểu Đồ' },
                  { id: 'EXTENSIONS', icon: Layers, label: isEn ? 'Config, Wizard, Deals & Ops' : 'Cấu Hình, Deals, Giải Đấu & IoT' },
                  { id: 'REVIEWS', icon: Star, label: isEn ? 'Reviews & Ratings' : 'Đánh Giá & Chấm Sao' },
                  {
                    id: 'BANK_REFUNDS',
                    icon: Landmark,
                    label: `VietQR & ${isEn ? 'Refunds' : 'Hoàn Cọc'} (${reconciliation.refunds?.filter((r: any) => r.status === 'PENDING').length || 0})`,
                  },
                  { id: 'MAINTENANCE', icon: Lock, label: isEn ? 'Maintenance Blocks' : 'Khóa Sân Bảo Trì' },
                  { id: 'STAFF', icon: Users, label: isEn ? 'Staff' : 'Nhân Viên' },
                  { id: 'PHOTOS', icon: ImageIcon, label: isEn ? 'Photo Gallery (WebP)' : 'Thư Viện Ảnh Sân' },
                  { id: 'PROFILE', icon: User, label: isEn ? 'My Profile & Rules' : 'Hồ Sơ & Quyền Hạn' },
                ] as const
              ).map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setActiveTab(item.id)}
                    className={`min-h-[42px] px-4 rounded-token-full text-xs sm:text-sm font-semibold flex items-center gap-2 border ${
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

            {/* TAB 1: EXECUTIVE DASHBOARD WITH CHARTS & HEATMAP */}
            {activeTab === 'DASHBOARD' && (
              <div className="tab-panel-anim space-y-6">
                <div className="bg-panel p-5 rounded-token-lg border border-borderStrong flex flex-col lg:flex-row lg:items-end justify-between gap-4">
                  <div>
                    <h2 className="font-bold text-lg sm:text-xl text-textStrong flex items-center gap-2">
                      <TrendingUp className="w-5 h-5 text-accent" />
                      <span>
                        {isEn
                          ? 'Executive Revenue, Occupancy & Utilization Dashboard'
                          : 'Dashboard Quản Trị Doanh Thu, Công Suất Lấp Đầy & Phân Tích Khung Giờ'}
                      </span>
                    </h2>
                    <p className="text-xs text-textMuted mt-1">
                      {isEn
                        ? 'Live ledger aggregation across configured opening hours, leaf physical courts, and completed refunds.'
                        : 'Tổng hợp trực tiếp từ sổ thanh toán đã xác nhận, giờ mở cửa cấu hình thực tế của từng sân vật lý và đã khấu trừ hoàn cọc.'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-end gap-2.5">
                    <div>
                      <label htmlFor="dash-venue-filter" className="block text-xs text-textMuted mb-1">
                        {isEn ? 'Venue Scope' : 'Phạm vi cơ sở'}
                      </label>
                      <select
                        id="dash-venue-filter"
                        value={reportVenueFilter}
                        onChange={(e) => setReportVenueFilter(e.target.value)}
                        className="min-h-[40px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-xs"
                      >
                        <option value="">{isEn ? 'All Assigned Venues' : 'Tất cả cơ sở được gán'}</option>
                        {venues.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name}
                          </option>
                        ))}
                      </select>
                    </div>

                    <div>
                      <label htmlFor="dash-start" className="block text-xs text-textMuted mb-1">
                        {isEn ? 'From' : 'Từ ngày'}
                      </label>
                      <input
                        id="dash-start"
                        type="date"
                        value={startDate}
                        onChange={(e) => setStartDate(e.target.value)}
                        className="min-h-[40px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-xs tabular-nums"
                      />
                    </div>
                    <div>
                      <label htmlFor="dash-end" className="block text-xs text-textMuted mb-1">
                        {isEn ? 'To' : 'Đến ngày'}
                      </label>
                      <input
                        id="dash-end"
                        type="date"
                        value={endDate}
                        onChange={(e) => setEndDate(e.target.value)}
                        className="min-h-[40px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-xs tabular-nums"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={fetchDashboardData}
                      disabled={dataLoading}
                      className="min-h-[40px] px-4 bg-accent text-textOnAccent font-bold rounded-token-sm text-xs flex items-center gap-1.5"
                    >
                      <RefreshCw className={`w-3.5 h-3.5 ${dataLoading ? 'animate-spin' : ''}`} />
                      <span>{isEn ? 'Apply' : 'Làm mới'}</span>
                    </button>
                  </div>
                </div>

                <AdminExecutiveCharts
                  reportData={reportData}
                  language={language}
                  onQuickSuggestDeal={() => {
                    setExtInitialModule('DEALS');
                    setActiveTab('EXTENSIONS');
                  }}
                />
              </div>
            )}

            {/* TAB 2: FULL P1 CONFIG & P2/P3 EXTENSIONS SUITE */}
            {activeTab === 'EXTENSIONS' && (
              <AdminExtensionsSuite
                token={token}
                language={language}
                venues={venues}
                courts={courts}
                initialModule={extInitialModule}
                onNotify={notify}
                onRefreshVenuesAndCourts={fetchDashboardData}
              />
            )}

            {/* TAB 3: VIETQR BANK CONFIG & RECONCILIATION / REFUNDS */}
            {activeTab === 'BANK_REFUNDS' && (
              <div className="tab-panel-anim grid lg:grid-cols-2 gap-6">
                <form
                  onSubmit={handleSaveBank}
                  className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4"
                >
                  <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
                    <Landmark className="w-5 h-5 text-accent" />
                    <span>Cấu Hình Tài Khoản Nhận Tiền VietQR Trực Tiếp</span>
                  </h3>
                  <p className="text-xs text-textBody leading-relaxed">
                    Tiền đặt sân của khách chuyển thẳng vào tài khoản ngân hàng của chủ sân. Khi chưa bật tài khoản thật, hãy giữ chế độ Sandbox để kiểm thử an toàn.
                  </p>

                  <div className="grid sm:grid-cols-2 gap-3 text-sm">
                    <div>
                      <label htmlFor="bank-bin" className="block text-xs text-textMuted mb-1">
                        Ngân hàng thụ hưởng (BIN)
                      </label>
                      <select
                        id="bank-bin"
                        value={bankId}
                        onChange={(e) => setBankId(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                      >
                        <option value="MB">MB Bank</option>
                        <option value="VCB">Vietcombank</option>
                        <option value="TCB">Techcombank</option>
                        <option value="ACB">ACB</option>
                        <option value="BIDV">BIDV</option>
                        <option value="ICB">VietinBank</option>
                        <option value="VPB">VPBank</option>
                        <option value="TPB">TPBank</option>
                      </select>
                    </div>
                    <div>
                      <label htmlFor="bank-acc-no" className="block text-xs text-textMuted mb-1">
                        Số tài khoản nhận tiền
                      </label>
                      <input
                        id="bank-acc-no"
                        type="text"
                        value={accountNumber}
                        onChange={(e) => setAccountNumber(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong font-mono tabular-nums"
                      />
                    </div>
                  </div>

                  <div>
                    <label htmlFor="bank-acc-name" className="block text-xs text-textMuted mb-1">
                      Tên chủ tài khoản (Không dấu, in hoa)
                    </label>
                    <input
                      id="bank-acc-name"
                      type="text"
                      value={accountName}
                      onChange={(e) => setAccountName(e.target.value.toUpperCase())}
                      className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong uppercase"
                    />
                  </div>

                  <label className="flex items-start gap-2.5 text-xs text-textBody cursor-pointer pt-1">
                    <input
                      type="checkbox"
                      checked={verifiedByOwner}
                      onChange={(e) => {
                        setVerifiedByOwner(e.target.checked);
                        if (e.target.checked) setSandboxMode(false);
                      }}
                      className="w-4 h-4 mt-0.5 accent-[var(--accent)]"
                    />
                    <span>
                      Xác nhận tài khoản chính chủ của cơ sở — cho phép sinh mã VietQR thanh toán thật.
                    </span>
                  </label>

                  <label className="flex items-start gap-2.5 text-xs text-statusWarning cursor-pointer">
                    <input
                      type="checkbox"
                      checked={sandboxMode}
                      onChange={(e) => {
                        setSandboxMode(e.target.checked);
                        if (e.target.checked) setVerifiedByOwner(false);
                      }}
                      className="w-4 h-4 mt-0.5 accent-[var(--warning)]"
                    />
                    <span>
                      Bật Chế độ Mô Phỏng Thanh Toán (Sandbox) — không phát sinh chuyển tiền thật.
                    </span>
                  </label>

                  <button
                    type="submit"
                    disabled={bankSaving}
                    className="w-full min-h-[46px] bg-accent hover:bg-accent-hover text-textOnAccent font-bold rounded-token-full"
                  >
                    {bankSaving ? 'Đang lưu...' : 'Lưu Cấu Hình Thanh Toán'}
                  </button>
                </form>

                {/* Refunds & Payment Mismatch Queue */}
                <div className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4">
                  <h3 className="font-bold text-base text-textStrong">
                    Hàng Đợi Đối Soát Lệch Tiền & Hoàn Cọc ({reconciliation.refunds?.length || 0})
                  </h3>

                  {reconciliation.refunds?.length === 0 && reconciliation.review_bookings?.length === 0 ? (
                    <p className="text-xs text-textMuted py-8 text-center">
                      Không có giao dịch lệch tiền hoặc yêu cầu hoàn cọc nào đang chờ xử lý.
                    </p>
                  ) : (
                    <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                      {reconciliation.refunds?.map((r: any) => (
                        <div
                          key={r.id}
                          className="p-3.5 rounded-token-md bg-panel-2 border border-borderToken flex items-center justify-between gap-3 tabular-nums"
                        >
                          <div className="text-xs space-y-1">
                            <p className="font-bold text-textStrong">
                              {r.booking_code} · {r.customer_name}
                            </p>
                            <p className="text-textMuted">{r.reason}</p>
                            <p className="font-mono font-bold text-statusWarning">{formatVnd(r.amount)}</p>
                          </div>
                          {r.status === 'PENDING' ? (
                            <button
                              type="button"
                              onClick={() => handleApproveRefund(r.id)}
                              className="min-h-[38px] px-3.5 rounded-token-full bg-accent text-textOnAccent font-bold text-xs shrink-0"
                            >
                              Xác nhận hoàn tiền
                            </button>
                          ) : (
                            <span className="px-2.5 py-1 rounded-token-full bg-accent-soft text-accent text-xs font-bold">
                              Đã hoàn
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* TAB 4: MAINTENANCE BLOCK */}
            {activeTab === 'MAINTENANCE' && (
              <form
                onSubmit={handleBlockCourt}
                className="tab-panel-anim max-w-2xl bg-panel border border-borderStrong rounded-token-lg p-6 sm:p-8 space-y-4"
              >
                <h3 className="font-bold text-lg text-textStrong flex items-center gap-2">
                  <Lock className="w-5 h-5 text-accent" />
                  <span>Khóa Khung Giờ Sân Bảo Trì (Tự động khóa các sân ghép thành phần)</span>
                </h3>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="block text-xs text-textMuted mb-1">Cơ sở</label>
                    <select
                      value={blockVenueId}
                      onChange={(e) => setBlockVenueId(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                    >
                      {venues.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs text-textMuted mb-1">Sân cần khóa</label>
                    <select
                      value={blockCourtId}
                      onChange={(e) => setBlockCourtId(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                    >
                      {courts
                        .filter((c) => !blockVenueId || c.venue_id === blockVenueId)
                        .map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name} ({c.court_type})
                          </option>
                        ))}
                    </select>
                  </div>
                </div>
                <div className="grid sm:grid-cols-2 gap-4 text-sm">
                  <div>
                    <label className="block text-xs text-textMuted mb-1">Bắt đầu</label>
                    <input
                      type="datetime-local"
                      value={blockStart}
                      onChange={(e) => setBlockStart(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-textMuted mb-1">Kết thúc</label>
                    <input
                      type="datetime-local"
                      value={blockEnd}
                      onChange={(e) => setBlockEnd(e.target.value)}
                      className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                      required
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-textMuted mb-1">Lý do bảo trì</label>
                  <input
                    type="text"
                    value={blockReason}
                    onChange={(e) => setBlockReason(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={blockLoading}
                  className="w-full min-h-[46px] bg-statusDanger text-textOnAccent font-bold rounded-token-full"
                >
                  {blockLoading ? 'Đang kiểm tra trùng & khóa sân...' : 'Xác Nhận Khóa Khung Giờ'}
                </button>
              </form>
            )}

            {/* TAB 5: STAFF */}
            {activeTab === 'STAFF' && (
              <div className="tab-panel-anim space-y-4">
                <div className="flex justify-between items-center bg-panel p-5 rounded-token-lg border border-borderStrong">
                  <h3 className="font-bold text-base text-textStrong">Nhân Sự Cơ Sở ({staffList.length})</h3>
                  <button
                    type="button"
                    onClick={() => {
                      setShowStaffModal(true);
                      setCreatedCredentials(null);
                    }}
                    className="min-h-[40px] px-4 bg-accent text-textOnAccent font-bold rounded-token-full text-xs flex items-center gap-1.5"
                  >
                    <Plus className="w-4 h-4" />
                    <span>Thêm Nhân Viên</span>
                  </button>
                </div>

                <div className="grid md:grid-cols-3 gap-4">
                  {staffList.map((st) => (
                    <div key={st.id} className="bg-panel border border-borderStrong rounded-token-md p-5 space-y-2 text-xs">
                      <div className="flex justify-between">
                        <strong className="text-sm text-textStrong">{st.full_name}</strong>
                        <span className="px-2 py-0.5 rounded bg-panel-2 text-accent font-bold">{st.role}</span>
                      </div>
                      <p className="font-mono text-textMuted tabular-nums">
                        @{st.username} · {st.phone}
                      </p>
                      <p className="text-accent font-semibold">{st.status}</p>
                    </div>
                  ))}
                </div>

                {showStaffModal && (
                  <div className="modal-backdrop-anim fixed inset-0 z-50 bg-overlay flex items-center justify-center p-4">
                    <div className="modal-panel-anim bg-panel border border-borderStrong rounded-token-lg max-w-md w-full p-6 space-y-4">
                      <div className="flex justify-between items-center border-b border-borderToken pb-2">
                        <h4 className="font-bold text-textStrong">Tạo Tài Khoản Nhân Viên</h4>
                        <button type="button" onClick={() => setShowStaffModal(false)}>
                          <X className="w-5 h-5" />
                        </button>
                      </div>
                      {createdCredentials ? (
                        <div className="p-4 bg-accent-soft border border-accent-border rounded-token-md space-y-2 text-xs">
                          <p className="font-bold text-accent flex items-center gap-1.5">
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Đã tạo! Mật khẩu tạm hiển thị 1 lần duy nhất:</span>
                          </p>
                          <p className="font-mono text-textStrong">Username: {createdCredentials.username}</p>
                          <p className="font-mono text-accent font-bold">Mật khẩu tạm: {createdCredentials.tempPass}</p>
                        </div>
                      ) : (
                        <form onSubmit={handleCreateStaff} className="space-y-3 text-sm">
                          <div>
                            <label className="block text-xs text-textMuted mb-1">Họ và tên nhân viên</label>
                            <input
                              type="text"
                              required
                              value={newStaffFullName}
                              onChange={(e) => setNewStaffFullName(e.target.value)}
                              className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-textMuted mb-1">Tên đăng nhập (username)</label>
                            <input
                              type="text"
                              required
                              value={newStaffUsername}
                              onChange={(e) => setNewStaffUsername(e.target.value)}
                              className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-textMuted mb-1">Số điện thoại</label>
                            <input
                              type="tel"
                              required
                              value={newStaffPhone}
                              onChange={(e) => setNewStaffPhone(e.target.value)}
                              className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong"
                            />
                          </div>
                          <div>
                            <label className="block text-xs text-textMuted mb-1">Vai trò</label>
                            <select
                              value={newStaffRole}
                              onChange={(e) => setNewStaffRole(e.target.value as any)}
                              className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong"
                            >
                              <option value="STAFF">Nhân viên trực quầy (Staff)</option>
                              <option value="MANAGER">Quản lý cơ sở (Manager)</option>
                            </select>
                          </div>
                          <button
                            type="submit"
                            className="w-full min-h-[44px] bg-accent text-textOnAccent font-bold rounded-token-full"
                          >
                            Tạo Tài Khoản & Cấp Mật Khẩu Tạm
                          </button>
                        </form>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* TAB 6: MULTI-PHOTO WEBP VENUE GALLERY & SLIDESHOW */}
            {activeTab === 'PHOTOS' && (() => {
              const targetVenue = venues.find((v) => v.id === (uploadVenueId || venues[0]?.id)) || venues[0];
              const storedPhotos: string[] = Array.isArray(targetVenue?.photos)
                ? Array.from(
                    new Set(
                      [targetVenue.cover_photo_url, ...targetVenue.photos].filter(
                        (u): u is string => typeof u === 'string' && u.trim().length > 0
                      )
                    )
                  )
                : targetVenue?.cover_photo_url
                  ? [targetVenue.cover_photo_url]
                  : [];
              const previewSlides = resolveVenueGallery(targetVenue);

              return (
                <div className="tab-panel-anim grid grid-cols-1 lg:grid-cols-[1fr_1.35fr] gap-6">
                  <form
                    onSubmit={handleUploadPhoto}
                    className="bg-panel border border-borderStrong rounded-token-lg p-6 sm:p-7 space-y-4 h-fit"
                  >
                    <h3 className="font-bold text-lg text-textStrong flex items-center gap-2">
                      <Upload className="w-5 h-5 text-accent" />
                      <span>Tải Lên Nhiều Ảnh Sân (Tự động nén WebP & chạy lặp)</span>
                    </h3>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Chọn cơ sở quản lý thư viện ảnh</label>
                      <select
                        value={targetVenue?.id || ''}
                        onChange={(e) => setUploadVenueId(e.target.value)}
                        className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                      >
                        {venues.map((v) => (
                          <option key={v.id} value={v.id}>
                            {v.name} ({Array.isArray(v.photos) ? v.photos.length : v.cover_photo_url ? 1 : 0} ảnh)
                          </option>
                        ))}
                      </select>
                    </div>

                    <label className="block cursor-pointer rounded-token-md border-2 border-dashed border-accent-border bg-panel-2/70 hover:bg-surfaceHover p-6 text-center space-y-2">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) =>
                          setSelectedFiles(e.target.files ? Array.from(e.target.files).slice(0, 10) : [])
                        }
                        className="sr-only"
                      />
                      <div className="w-12 h-12 rounded-token-full bg-accent-soft border border-accent-border flex items-center justify-center mx-auto text-accent">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                      {selectedFiles.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-accent">
                            Đã chọn {selectedFiles.length} ảnh sẵn sàng tải lên
                          </p>
                          <p className="text-xs text-textMuted truncate max-w-sm mx-auto">
                            {selectedFiles.map((f) => f.name).join(', ')}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-textStrong">
                            Nhấn để chọn 1 hoặc nhiều ảnh sân cùng lúc (Tối đa 10 ảnh/lần)
                          </p>
                          <p className="text-xs text-textMuted">
                            JPG, PNG, WebP — Tự động nén WebP sắc nét và chạy lặp trên trang khách hàng
                          </p>
                        </div>
                      )}
                    </label>

                    <label className="flex items-center gap-2.5 text-xs text-textBody cursor-pointer">
                      <input
                        type="checkbox"
                        checked={setUploadAsCover}
                        onChange={(e) => setSetUploadAsCover(e.target.checked)}
                        className="w-4 h-4 accent-accent rounded"
                      />
                      <span>Đặt ảnh mới tải lên lên vị trí đầu tiên (Ảnh bìa chính)</span>
                    </label>

                    <button
                      type="submit"
                      disabled={selectedFiles.length === 0 || uploadLoading}
                      className="w-full min-h-[46px] bg-accent text-textOnAccent font-bold rounded-token-full disabled:opacity-50"
                    >
                      {uploadLoading
                        ? 'Đang nén WebP & Lưu thư viện...'
                        : `Tải Lên ${selectedFiles.length > 0 ? `${selectedFiles.length} Ảnh` : 'Vào Thư Viện Sân'}`}
                    </button>
                  </form>

                  <div className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-base text-textStrong">
                          Xem Trước Trình Chiếu Lặp ({targetVenue?.name})
                        </h3>
                        <p className="text-xs text-textMuted mt-0.5">
                          Các ảnh tự động chuyển mượt mà và hỗ trợ nút ‹ › hoặc vuốt trên điện thoại.
                        </p>
                      </div>
                      <span className="px-3 py-1 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold tabular-nums">
                        {storedPhotos.length} ảnh đã lưu
                      </span>
                    </div>

                    <LoopingPhotoCarousel
                      images={previewSlides}
                      alt={targetVenue?.name || 'Venue preview'}
                      className="aspect-[16/9] rounded-token-md border border-borderStrong"
                    />

                    {storedPhotos.length > 0 && targetVenue && (
                      <div className="space-y-2.5">
                        <p className="text-xs font-bold text-textStrong">
                          Danh sách ảnh trong thư viện (Nhấn ngôi sao để đưa lên đầu, thùng rác để xóa):
                        </p>
                        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                          {storedPhotos.map((url, idx) => (
                            <div
                              key={`${url}-${idx}`}
                              className="group relative rounded-token-sm overflow-hidden border border-borderStrong bg-panel-2 aspect-[16/10]"
                            >
                              {/* eslint-disable-next-line @next/next/no-img-element */}
                              <img src={url} alt="" className="w-full h-full object-cover" />
                              <div className="absolute inset-0 bg-gradient-to-t from-page/90 via-transparent to-page/40" />
                              <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-page/85 text-[11px] font-bold text-textStrong tabular-nums">
                                {idx === 0 ? '#1 · Ảnh bìa' : `#${idx + 1}`}
                              </span>
                              <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                                {idx > 0 && (
                                  <button
                                    type="button"
                                    title="Đặt làm ảnh đầu tiên"
                                    onClick={() =>
                                      handleUpdateVenueGallery(
                                        targetVenue.id,
                                        [url, ...storedPhotos.filter((u) => u !== url)],
                                        url
                                      )
                                    }
                                    className="min-h-[32px] px-2 rounded bg-accent text-textOnAccent text-[11px] font-bold inline-flex items-center gap-1"
                                  >
                                    <Star className="w-3 h-3" />
                                    <span>Đầu</span>
                                  </button>
                                )}
                                <button
                                  type="button"
                                  title="Xóa ảnh này"
                                  onClick={() => {
                                    const remaining = storedPhotos.filter((u) => u !== url);
                                    handleUpdateVenueGallery(targetVenue.id, remaining, remaining[0] || null);
                                  }}
                                  className="min-h-[32px] min-w-[32px] rounded bg-statusDanger-soft border border-statusDanger-border text-statusDanger flex items-center justify-center hover:bg-statusDanger hover:text-textOnAccent"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            </div>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
              );
            })()}

            {/* C-18 CUSTOMER REVIEWS & STAR RATINGS MODERATION */}
            {activeTab === 'REVIEWS' && token && (
              <AdminReviewsManager
                token={token}
                language={language}
                venues={venues}
                onNotify={notify}
              />
            )}

            {/* TAB 7: OWNER / MANAGER PROFILE & OBLIGATIONS */}
            {activeTab === 'PROFILE' && (
              <OperatorProfilePanel
                portal="admin"
                apiBase={adminApi}
                token={token}
                language={language}
                onProfileUpdated={(p) => {
                  const merged = { ...adminUser, ...p };
                  setAdminUser(merged);
                  localStorage.setItem('court_admin_user', JSON.stringify(merged));
                }}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

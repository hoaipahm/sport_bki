'use client';

import React, { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ShieldAlert,
  Server,
  Building2,
  LogOut,
  RefreshCw,
  Plus,
  Mail,
  Send,
  User,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Trash2,
  Trophy,
  Save,
  Image as ImageIcon,
  Upload,
  Star,
} from 'lucide-react';
import { platformApi } from '../../lib/api';
import { DEFAULT_HERO_SLIDES, DEFAULT_AUTH_SLIDES, DEFAULT_OPS_SLIDES, resolveVenueGallery } from '../../lib/media';
import { useLanguage } from '../../context/LanguageContext';
import { LoopingPhotoCarousel } from '../../components/LoopingPhotoCarousel';
import { OperatorProfilePanel } from '../../components/OperatorProfilePanel';

export default function PlatformPage() {
  const { language, toggleLanguage } = useLanguage();
  const isEn = language === 'en';

  const [token, setToken] = useState<string | null>(null);
  const [admin, setAdmin] = useState<any>(null);

  // Strictly empty login fields — never pre-fill Super Admin credentials
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');

  const [activeTab, setActiveTab] = useState<'TENANTS' | 'MEDIA' | 'SPORTS' | 'SMTP' | 'SUPPORT' | 'PROFILE'>('TENANTS');
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  const [tenants, setTenants] = useState<any[]>([]);
  const [monitoring, setMonitoring] = useState<any>(null);
  const [newName, setNewName] = useState('');
  const [newCode, setNewCode] = useState('');
  const [newPlanName, setNewPlanName] = useState('STANDARD');
  const [newPlanPrice, setNewPlanPrice] = useState('350000');
  const [ownerFullName, setOwnerFullName] = useState('');
  const [ownerEmail, setOwnerEmail] = useState('');
  const [ownerPassword, setOwnerPassword] = useState('');
  const [tenantEdits, setTenantEdits] = useState<Record<string, { name: string; price: string }>>({});

  // Dynamic Sports Catalog
  const [sportsList, setSportsList] = useState<any[]>([]);
  const [sportCode, setSportCode] = useState('');
  const [sportVi, setSportVi] = useState('');
  const [sportEn, setSportEn] = useState('');
  const [sportMinDur, setSportMinDur] = useState(60);

  // SMTP Settings
  const [smtpHost, setSmtpHost] = useState('');
  const [smtpPort, setSmtpPort] = useState(587);
  const [smtpSecure, setSmtpSecure] = useState(false);
  const [smtpUser, setSmtpUser] = useState('');
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpFromEmail, setSmtpFromEmail] = useState('');
  const [smtpFromName, setSmtpFromName] = useState('Sports Court Booking');
  const [smtpEnabled, setSmtpEnabled] = useState(false);
  const [smtpStatusInfo, setSmtpStatusInfo] = useState<any>(null);
  const [testRecipient, setTestRecipient] = useState('');
  const [smtpBusy, setSmtpBusy] = useState(false);

  // Support Sessions (P-02)
  const [supportSessions, setSupportSessions] = useState<any[]>([]);
  const [supTenantId, setSupTenantId] = useState('');
  const [supReason, setSupReason] = useState('');

  // Platform Media & Cross-Tenant Venue Galleries
  const [mediaSettings, setMediaSettings] = useState<{
    hero_slides: string[];
    auth_slides: string[];
    ops_slides: string[];
  }>({
    hero_slides: DEFAULT_HERO_SLIDES,
    auth_slides: DEFAULT_AUTH_SLIDES,
    ops_slides: DEFAULT_OPS_SLIDES,
  });
  const [platformVenues, setPlatformVenues] = useState<any[]>([]);
  const [mediaTargetType, setMediaTargetType] = useState<'venue' | 'hero' | 'auth' | 'ops'>('venue');
  const [mediaVenueId, setMediaVenueId] = useState('');
  const [mediaFiles, setMediaFiles] = useState<File[]>([]);
  const [mediaBusy, setMediaBusy] = useState(false);

  useEffect(() => {
    const t = localStorage.getItem('court_platform_token');
    const u = localStorage.getItem('court_platform_user');
    if (t && u) {
      try {
        setToken(t);
        setAdmin(JSON.parse(u));
      } catch {
        localStorage.removeItem('court_platform_token');
      }
    }
  }, []);

  const showNotice = (ok: boolean, text: string) => {
    setNotice({ ok, text });
    setTimeout(() => setNotice((c) => (c?.text === text ? null : c)), 5000);
  };

  const loadData = useCallback(async () => {
    if (!token) return;
    try {
      const headers = { Authorization: `Bearer ${token}`, 'Accept-Language': language };
      const [meRes, tRes, spRes, mRes, sRes, supRes, medRes] = await Promise.all([
        fetch(`${platformApi}/me`, { headers }),
        fetch(`${platformApi}/tenants`, { headers }),
        fetch(`${platformApi}/sports`, { headers }),
        fetch(`${platformApi}/monitoring`, { headers }),
        fetch(`${platformApi}/smtp`, { headers }),
        fetch(`${platformApi}/support/sessions`, { headers }),
        fetch(`${platformApi}/media`, { headers }),
      ]);
      if (meRes.status === 401 || tRes.status === 401) {
        setToken(null);
        setAdmin(null);
        localStorage.removeItem('court_platform_token');
        localStorage.removeItem('court_platform_user');
        return;
      }
      if (meRes.ok) {
        const md = await meRes.json();
        if (md.profile) {
          setAdmin(md.profile);
          localStorage.setItem('court_platform_user', JSON.stringify(md.profile));
        }
      }
      if (tRes.ok) {
        const tList = (await tRes.json()).tenants || [];
        setTenants(tList);
        if (tList[0]) setSupTenantId((c) => c || tList[0].id);
      }
      if (spRes.ok) {
        setSportsList((await spRes.json()).sports || []);
      }
      if (mRes.ok) setMonitoring(await mRes.json());
      if (sRes.ok) {
        const sd = await sRes.json();
        setSmtpStatusInfo(sd);
        if (sd.settings) {
          setSmtpHost(sd.settings.host || '');
          setSmtpPort(sd.settings.port || 587);
          setSmtpSecure(Boolean(sd.settings.secure));
          setSmtpUser(sd.settings.username || '');
          setSmtpFromEmail(sd.settings.from_email || '');
          setSmtpFromName(sd.settings.from_name || 'Sports Court Booking');
          setSmtpEnabled(Boolean(sd.settings.enabled));
        }
      }
      if (supRes.ok) setSupportSessions((await supRes.json()).sessions || []);
      if (medRes && medRes.ok) {
        const md = await medRes.json();
        if (md.settings) {
          setMediaSettings({
            hero_slides: Array.isArray(md.settings.hero_slides) && md.settings.hero_slides.length > 0 ? md.settings.hero_slides : DEFAULT_HERO_SLIDES,
            auth_slides: Array.isArray(md.settings.auth_slides) && md.settings.auth_slides.length > 0 ? md.settings.auth_slides : DEFAULT_AUTH_SLIDES,
            ops_slides: Array.isArray(md.settings.ops_slides) && md.settings.ops_slides.length > 0 ? md.settings.ops_slides : DEFAULT_OPS_SLIDES,
          });
        }
        if (Array.isArray(md.venues)) {
          setPlatformVenues(md.venues);
          if (md.venues[0]) setMediaVenueId((c) => c || md.venues[0].id);
        }
      }
    } catch {
      // Ignore transient network errors
    }
  }, [token, language]);

  useEffect(() => {
    void loadData();
  }, [loadData]);

  const login = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const res = await fetch(`${platformApi}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    const data = await res.json();
    if (!res.ok) {
      setError(data.message || 'Đăng nhập thất bại');
      return;
    }
    setToken(data.access_token);
    setAdmin(data.admin);
    setPassword('');
    localStorage.setItem('court_platform_token', data.access_token);
    localStorage.setItem('court_platform_user', JSON.stringify(data.admin));
  };

  const toggleTenant = async (id: string, status: string) => {
    const action = status === 'ACTIVE' ? 'suspend' : 'reactivate';
    await fetch(`${platformApi}/tenants/${id}/${action}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    loadData();
  };

  const createTenant = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newName || !newCode) return;
    const res = await fetch(`${platformApi}/tenants`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: newName.trim(),
        code: newCode.trim(),
        plan_name: newPlanName.trim() || 'STANDARD',
        price_per_month: Number(newPlanPrice) || 350000,
        owner_full_name: ownerFullName.trim() || undefined,
        owner_email: ownerEmail.trim() || undefined,
        owner_password: ownerPassword || undefined,
      }),
    });
    const d = await res.json();
    if (res.ok) {
      setNewName('');
      setNewCode('');
      setOwnerFullName('');
      setOwnerEmail('');
      setOwnerPassword('');
      showNotice(
        true,
        d.owner
          ? `Đã tạo đơn vị chủ sân mới kèm tài khoản Chủ sân (${d.owner.email}).`
          : 'Đã khởi tạo đối tác chủ sân (Tenant) mới.'
      );
      loadData();
    } else {
      showNotice(false, d.message || 'Không thể tạo Tenant.');
    }
  };

  const saveTenantEdit = async (t: any) => {
    const ed = tenantEdits[t.id];
    const res = await fetch(`${platformApi}/tenants/${t.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        name: ed?.name ?? t.name,
        price_per_month: ed?.price !== undefined ? Number(ed.price) : Number(t.price_per_month || 350000),
      }),
    });
    if (res.ok) {
      showNotice(true, 'Đã cập nhật tên đơn vị & mức phí thuê bao.');
      loadData();
    }
  };

  const deleteTenant = async (t: any) => {
    if (!window.confirm(`Xóa vĩnh viễn đơn vị "${t.name}" cùng toàn bộ cơ sở, sân và lịch đặt thuộc đơn vị này?`)) return;
    const res = await fetch(`${platformApi}/tenants/${t.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) {
      showNotice(true, `Đã xóa hoàn toàn đơn vị "${t.name}".`);
      loadData();
    }
  };

  const purgeDemoData = async () => {
    if (!window.confirm('Xóa toàn bộ lịch đặt mẫu (DS-DEMO*) và giải đấu mẫu để đưa sổ sách về 0 chuẩn bị chạy dữ liệu thật?')) return;
    const res = await fetch(`${platformApi}/demo-data/purge`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (res.ok) {
      showNotice(
        true,
        `Đã dọn sạch ${d.deleted_bookings} lịch đặt mẫu & ${d.deleted_tournaments} giải đấu mẫu.`
      );
      loadData();
    }
  };

  const createOrUpdateSport = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sportCode.trim() || !sportVi.trim()) return;
    const res = await fetch(`${platformApi}/sports`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        code: sportCode.trim(),
        name_vi: sportVi.trim(),
        name_en: sportEn.trim() || sportVi.trim(),
        min_duration_mins: Number(sportMinDur) || 60,
      }),
    });
    const d = await res.json();
    if (res.ok) {
      setSportCode('');
      setSportVi('');
      setSportEn('');
      showNotice(true, 'Đã lưu môn thể thao vào danh mục toàn hệ thống.');
      loadData();
    } else {
      showNotice(false, d.message || 'Không thể lưu môn thể thao');
    }
  };

  const deleteSport = async (s: any) => {
    if (!window.confirm(`Xóa môn "${s.name_i18n?.vi || s.code}" khỏi hệ thống?`)) return;
    const res = await fetch(`${platformApi}/sports/${s.id}`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
    const d = await res.json();
    if (res.ok) {
      showNotice(true, `Đã xóa môn "${s.name_i18n?.vi || s.code}".`);
      loadData();
    } else {
      showNotice(false, d.message || 'Không thể xóa môn thể thao đang có sân sử dụng.');
    }
  };

  const saveSmtpSettings = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpBusy(true);
    try {
      const res = await fetch(`${platformApi}/smtp`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          host: smtpHost,
          port: smtpPort,
          secure: smtpSecure,
          username: smtpUser,
          password: smtpPass || undefined,
          from_email: smtpFromEmail,
          from_name: smtpFromName,
          enabled: smtpEnabled,
        }),
      });
      const d = await res.json();
      if (res.ok) {
        setSmtpPass('');
        showNotice(true, d.is_live ? 'Đã lưu & kích hoạt máy chủ SMTP gửi mail thật!' : 'Đã lưu cấu hình SMTP (đang ở chế độ tắt).');
        loadData();
      } else {
        showNotice(false, d.message || 'Không thể lưu SMTP');
      }
    } finally {
      setSmtpBusy(false);
    }
  };

  const triggerTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpBusy(true);
    try {
      const res = await fetch(`${platformApi}/smtp/test`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Accept-Language': language,
        },
        body: JSON.stringify({ recipient: testRecipient }),
      });
      const d = await res.json();
      if (res.ok) {
        showNotice(true, `Đã gửi email thật thành công qua ${d.host} (MsgID: ${d.messageId})`);
      } else {
        showNotice(false, d.message || 'Kết nối SMTP thất bại');
      }
    } finally {
      setSmtpBusy(false);
    }
  };

  const startSupportSession = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${platformApi}/support/sessions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ tenant_id: supTenantId, reason: supReason, duration_mins: 30 }),
    });
    if (res.ok) {
      setSupReason('');
      showNotice(true, 'Đã mở phiên hỗ trợ chỉ đọc 30 phút (đã ghi Audit Log).');
      loadData();
    }
  };

  const uploadPlatformMedia = async (e: React.FormEvent) => {
    e.preventDefault();
    if (mediaFiles.length === 0) return;
    setMediaBusy(true);
    try {
      const fd = new FormData();
      for (const f of mediaFiles) {
        fd.append('photos', f);
      }
      fd.append('target_type', mediaTargetType);
      if (mediaTargetType === 'venue' && (mediaVenueId || platformVenues[0]?.id)) {
        fd.append('venue_id', mediaVenueId || platformVenues[0].id);
      }
      const res = await fetch(`${platformApi}/media/upload`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const d = await res.json();
      if (res.ok) {
        setMediaFiles([]);
        showNotice(true, d.message || 'Đã tải ảnh lên thư viện thành công!');
        loadData();
      } else {
        showNotice(false, d.message || 'Tải ảnh thất bại.');
      }
    } finally {
      setMediaBusy(false);
    }
  };

  const updateSystemSlideList = async (kind: 'hero' | 'auth' | 'ops', nextList: string[]) => {
    const key = kind === 'hero' ? 'hero_slides' : kind === 'auth' ? 'auth_slides' : 'ops_slides';
    const res = await fetch(`${platformApi}/media`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ [key]: nextList }),
    });
    if (res.ok) {
      showNotice(true, 'Đã cập nhật trình chiếu ảnh hệ thống.');
      loadData();
    } else {
      showNotice(false, 'Không thể lưu thay đổi ảnh hệ thống.');
    }
  };

  const updatePlatformVenueGallery = async (venueId: string, nextPhotos: string[]) => {
    const res = await fetch(`${platformApi}/venues/${venueId}/photos`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ photos: nextPhotos, cover_photo_url: nextPhotos[0] || null }),
    });
    if (res.ok) {
      showNotice(true, 'Đã cập nhật thư viện ảnh cơ sở sân.');
      loadData();
    } else {
      showNotice(false, 'Không thể lưu thư viện ảnh cơ sở.');
    }
  };

  return (
    <div className="ops-shell min-h-screen bg-page text-textBody flex flex-col font-sans">
      <header className="sticky top-0 z-30 h-16 bg-panel-2 border-b border-borderStrong px-4 sm:px-8 flex items-center justify-between text-textStrong">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-token-sm bg-accent-soft border border-accent-border flex items-center justify-center">
            <ShieldAlert className="w-5 h-5 text-accent" />
          </div>
          <div>
            <span className="bg-page text-accent border border-accent-border text-[11px] font-extrabold px-2 py-0.5 rounded uppercase mr-2">
              SUPER ADMIN
            </span>
            <span className="font-extrabold text-sm sm:text-base">{admin?.full_name || 'Platform Console'}</span>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={toggleLanguage}
            className="min-h-[36px] px-2.5 rounded-token-sm bg-panel border border-borderStrong text-xs font-bold"
          >
            <span className={language === 'vi' ? 'text-accent' : 'text-textMuted'}>VI</span>
            <span className="mx-1 text-borderStrong">|</span>
            <span className={language === 'en' ? 'text-accent' : 'text-textMuted'}>EN</span>
          </button>

          <Link href="/" className="text-xs px-3 py-2 rounded-token-sm bg-panel border border-borderStrong text-textStrong">
            ← {isEn ? 'Customer Web' : 'Web Khách Hàng'}
          </Link>
          {token && (
            <button
              type="button"
              onClick={() => {
                setToken(null);
                setAdmin(null);
                localStorage.removeItem('court_platform_token');
                localStorage.removeItem('court_platform_user');
              }}
              className="text-xs px-3 py-2 rounded-token-sm bg-statusDanger-soft text-statusDanger border border-statusDanger-border flex items-center gap-1"
            >
              <LogOut className="w-3.5 h-3.5" />
              <span>{isEn ? 'Log out' : 'Đăng xuất'}</span>
            </button>
          )}
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto p-4 sm:p-8 w-full flex-1 space-y-6">
        {notice && (
          <div
            role="status"
            className={`p-4 rounded-token-md border text-sm font-semibold flex items-center gap-2 ${
              notice.ok
                ? 'bg-accent-soft border-accent-border text-accent'
                : 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
            }`}
          >
            {notice.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        {!token ? (
          <div className="stage-enter-1 max-w-4xl mx-auto mt-6 lg:mt-10 bg-panel border border-borderStrong rounded-token-lg overflow-hidden shadow-token-elevated grid grid-cols-1 lg:grid-cols-[1.08fr_1fr]">
            <LoopingPhotoCarousel
              images={DEFAULT_OPS_SLIDES}
              alt="Super Admin Platform Console"
              intervalMs={4600}
              className="h-44 sm:h-56 lg:h-full lg:min-h-[440px] border-b lg:border-b-0 lg:border-r border-borderToken"
              showControls={true}
              showCounter={false}
              overlayClassName="carousel-vignette-deep"
            >
              <div className="h-full flex flex-col justify-end p-5 sm:p-7 space-y-2 pointer-events-none">
                <span className="w-fit px-3 py-1 rounded-token-full bg-overlay backdrop-blur-sm border border-accent-border text-accent text-xs font-bold">
                  SUPER ADMIN · PLATFORM CONSOLE
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-textStrong leading-snug">
                  {isEn
                    ? 'Multi-tenant operations, sports catalog, live SMTP delivery, and system media galleries.'
                    : 'Điều hành đa chủ sân, danh mục môn thể thao, máy chủ Gmail SMTP và kho ảnh trình chiếu toàn hệ thống.'}
                </p>
              </div>
            </LoopingPhotoCarousel>

            <form
              onSubmit={login}
              className="p-6 sm:p-8 flex flex-col justify-center space-y-4"
            >
              <div className="space-y-1.5">
                <div className="w-11 h-11 rounded-token-md bg-accent-soft border border-accent-border flex items-center justify-center text-accent mb-2">
                  <ShieldAlert className="w-5 h-5" />
                </div>
                <h1 className="text-xl font-bold text-textStrong">Super Admin Console</h1>
                <p className="text-xs text-textMuted">
                  {isEn ? 'Platform operator authentication required.' : 'Yêu cầu xác thực tài khoản vận hành nền tảng.'}
                </p>
              </div>
              {error && (
                <p role="alert" className="text-xs text-statusDanger bg-statusDanger-soft p-3 rounded-token-sm">
                  {error}
                </p>
              )}
              <div>
                <label htmlFor="plat-email" className="block text-xs font-semibold text-textBody mb-1.5">
                  {isEn ? 'Internal Admin Email' : 'Email quản trị nội bộ'}
                </label>
                <input
                  id="plat-email"
                  type="email"
                  autoComplete="username"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                  required
                />
              </div>
              <div>
                <label htmlFor="plat-pw" className="block text-xs font-semibold text-textBody mb-1.5">
                  {isEn ? 'Password' : 'Mật khẩu'}
                </label>
                <input
                  id="plat-pw"
                  type="password"
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="w-full min-h-[46px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                  required
                />
              </div>
              <button
                type="submit"
                className="w-full min-h-[46px] bg-accent hover:bg-accent-hover text-textOnAccent font-bold rounded-token-full"
              >
                {isEn ? 'Sign In to Console' : 'Đăng Nhập Console'}
              </button>
            </form>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Console Tabs */}
            <div className="flex flex-wrap gap-2 border-b border-borderToken pb-3">
              {(
                [
                  { id: 'TENANTS', icon: Building2, label: isEn ? 'Tenants & Data Control' : 'Chủ Sân, Giá Gói & Dữ Liệu' },
                  { id: 'MEDIA', icon: ImageIcon, label: isEn ? 'Venue & System Galleries' : 'Thư Viện Ảnh Sân & Hệ Thống' },
                  { id: 'SPORTS', icon: Trophy, label: isEn ? 'Sports Catalog' : `Danh Mục Môn Thể Thao (${sportsList.length})` },
                  { id: 'SMTP', icon: Mail, label: isEn ? 'Live SMTP Mail Setup' : 'Cấu Hình Gửi Mail SMTP Thật' },
                  { id: 'SUPPORT', icon: Eye, label: isEn ? 'Support Sessions (P-02)' : 'Phiên Hỗ Trợ Có Hạn (P-02)' },
                  { id: 'PROFILE', icon: User, label: isEn ? 'My Profile & Rules' : 'Hồ Sơ & Nghĩa Vụ' },
                ] as const
              ).map((tab) => {
                const Icon = tab.icon;
                const active = activeTab === tab.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => setActiveTab(tab.id)}
                    className={`min-h-[42px] px-4 rounded-token-full text-xs sm:text-sm font-semibold flex items-center gap-2 border ${
                      active
                        ? 'bg-accent text-textOnAccent border-accent font-bold'
                        : 'bg-panel text-textBody border-borderToken hover:text-textStrong hover:bg-surfaceHover'
                    }`}
                  >
                    <Icon className="w-4 h-4" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>

            {activeTab === 'TENANTS' && (
              <div className="tab-panel-anim space-y-6">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 tabular-nums">
                  <div className="bg-panel border border-borderStrong rounded-token-md p-5">
                    <span className="text-xs text-textMuted">Tổng số Tenant</span>
                    <p className="text-2xl font-extrabold text-textStrong mt-1">{tenants.length}</p>
                  </div>
                  <div className="bg-panel border border-borderStrong rounded-token-md p-5">
                    <span className="text-xs text-textMuted">Tổng số môn thể thao đang mở</span>
                    <p className="text-2xl font-extrabold text-accent mt-1">{sportsList.length}</p>
                  </div>
                  <div className="bg-panel border border-borderStrong rounded-token-md p-5 flex items-center justify-between gap-2">
                    <div>
                      <span className="text-xs text-textMuted">Dọn dữ liệu mẫu khi chạy thật</span>
                      <div className="mt-2">
                        <button
                          type="button"
                          onClick={purgeDemoData}
                          className="min-h-[34px] px-3 rounded-token-full bg-statusDanger-soft border border-statusDanger-border text-statusDanger text-xs font-bold flex items-center gap-1.5"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                          <span>Xóa Lịch & Giải Đấu Mẫu</span>
                        </button>
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={loadData}
                      aria-label="Làm mới"
                      className="p-2 rounded bg-panel-2 border border-borderStrong"
                    >
                      <RefreshCw className="w-4 h-4 text-accent" />
                    </button>
                  </div>
                </div>

                {/* Create Real Tenant + Optional Initial Owner Account */}
                <form
                  onSubmit={createTenant}
                  className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4"
                >
                  <h3 className="font-bold text-base text-textStrong">
                    Khởi Tạo Đơn Vị Chủ Sân Thật Mới (Kèm Gói Cước & Tài Khoản Chủ Sân)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-textMuted mb-1">Tên đơn vị chủ sân *</label>
                      <input
                        type="text"
                        value={newName}
                        onChange={(e) => setNewName(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Mã định danh (code) *</label>
                      <input
                        type="text"
                        value={newCode}
                        onChange={(e) => setNewCode(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Giá gói / tháng (VND)</label>
                      <input
                        type="number"
                        value={newPlanPrice}
                        onChange={(e) => setNewPlanPrice(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 items-end pt-1">
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Họ tên Chủ sân (tùy chọn)</label>
                      <input
                        type="text"
                        value={ownerFullName}
                        onChange={(e) => setOwnerFullName(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Email đăng nhập /admin</label>
                      <input
                        type="email"
                        value={ownerEmail}
                        onChange={(e) => setOwnerEmail(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Mật khẩu khởi tạo (&gt;=8 ký tự)</label>
                      <input
                        type="password"
                        value={ownerPassword}
                        onChange={(e) => setOwnerPassword(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                      />
                    </div>
                    <button
                      type="submit"
                      className="min-h-[42px] px-5 bg-accent text-textOnAccent font-bold rounded-token-full text-xs flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Tạo Tenant & Chủ Sân</span>
                    </button>
                  </div>
                </form>

                <div className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-3">
                  <h2 className="font-bold text-base text-textStrong flex items-center gap-2">
                    <Building2 className="w-5 h-5 text-accent" />
                    <span>Danh Sách Chủ Sân — Sửa Tên, Đổi Giá Thuê Bao Hoặc Xóa Dữ Liệu Mẫu (P-01)</span>
                  </h2>
                  <div className="divide-y divide-borderToken">
                    {tenants.map((t) => {
                      const ed = tenantEdits[t.id] || {
                        name: t.name,
                        price: String(t.price_per_month ?? 350000),
                      };
                      return (
                        <div key={t.id} className="py-4 flex flex-col lg:flex-row lg:items-center justify-between gap-3 text-sm tabular-nums">
                          <div className="flex flex-wrap items-center gap-2 flex-1">
                            <input
                              type="text"
                              aria-label="Tên Tenant"
                              value={ed.name}
                              onChange={(e) =>
                                setTenantEdits((prev) => ({
                                  ...prev,
                                  [t.id]: { ...ed, name: e.target.value },
                                }))
                              }
                              className="min-h-[38px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong font-bold text-sm"
                            />
                            <input
                              type="number"
                              aria-label="Giá thuê bao tháng"
                              value={ed.price}
                              onChange={(e) =>
                                setTenantEdits((prev) => ({
                                  ...prev,
                                  [t.id]: { ...ed, price: e.target.value },
                                }))
                              }
                              className="w-32 min-h-[38px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-accent font-bold text-xs"
                            />
                            <span className="text-xs text-textMuted">
                              ₫/tháng · {t.venue_count || 0} cơ sở · Mã: {t.code} ·{' '}
                              <strong className={t.status === 'ACTIVE' ? 'text-accent' : 'text-statusDanger'}>
                                {t.status}
                              </strong>
                            </span>
                          </div>
                          <div className="flex flex-wrap items-center gap-2">
                            <button
                              type="button"
                              onClick={() => saveTenantEdit(t)}
                              className="min-h-[36px] px-3 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-textStrong text-xs font-bold inline-flex items-center gap-1"
                            >
                              <Save className="w-3.5 h-3.5 text-accent" />
                              <span>Lưu sửa</span>
                            </button>
                            <button
                              type="button"
                              onClick={() => toggleTenant(t.id, t.status)}
                              className={`min-h-[36px] px-3.5 rounded-token-full text-xs font-bold border ${
                                t.status === 'ACTIVE'
                                  ? 'bg-statusWarning-soft text-statusWarning border-statusWarning-border'
                                  : 'bg-accent-soft text-accent border-accent-border'
                              }`}
                            >
                              {t.status === 'ACTIVE' ? 'Tạm khóa' : 'Kích hoạt lại'}
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteTenant(t)}
                              className="min-h-[36px] px-3 rounded-token-full bg-statusDanger-soft text-statusDanger border border-statusDanger-border text-xs font-bold inline-flex items-center gap-1"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                              <span>Xóa hẳn</span>
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* DYNAMIC SPORTS CATALOG MANAGEMENT */}
            {activeTab === 'SPORTS' && (
              <div className="tab-panel-anim space-y-6">
                <form
                  onSubmit={createOrUpdateSport}
                  className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4"
                >
                  <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
                    <Trophy className="w-5 h-5 text-accent" />
                    <span>Thêm Hoặc Cập Nhật Môn Thể Thao Toàn Nền Tảng</span>
                  </h3>
                  <p className="text-xs text-textMuted">
                    Mọi môn thể thao tại đây tự động đồng bộ ngay lập tức ra thanh bộ lọc Trang Chủ Khách Hàng và mục tạo sân của Chủ Sân.
                  </p>
                  <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-end">
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Mã môn (vd: padel, golf)</label>
                      <input
                        type="text"
                        required
                        value={sportCode}
                        onChange={(e) => setSportCode(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Tên Tiếng Việt *</label>
                      <input
                        type="text"
                        required
                        value={sportVi}
                        onChange={(e) => setSportVi(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Tên Tiếng Anh</label>
                      <input
                        type="text"
                        value={sportEn}
                        onChange={(e) => setSportEn(e.target.value)}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Phút tối thiểu</label>
                      <input
                        type="number"
                        min={30}
                        step={15}
                        value={sportMinDur}
                        onChange={(e) => setSportMinDur(Number(e.target.value))}
                        className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-sm text-textStrong text-sm tabular-nums"
                      />
                    </div>
                    <button
                      type="submit"
                      className="min-h-[42px] px-4 bg-accent text-textOnAccent font-bold rounded-token-full text-xs flex items-center justify-center gap-1.5"
                    >
                      <Plus className="w-4 h-4" />
                      <span>Lưu Môn</span>
                    </button>
                  </div>
                </form>

                <div className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-3">
                  <h3 className="font-bold text-base text-textStrong">
                    Danh Sách Môn Thể Thao Hiện Có ({sportsList.length})
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 text-xs tabular-nums">
                    {sportsList.map((s) => (
                      <div
                        key={s.id}
                        className="p-4 rounded-token-md bg-panel-2 border border-borderToken flex items-center justify-between gap-3"
                      >
                        <div>
                          <p className="font-bold text-sm text-textStrong">
                            {s.name_i18n?.vi || s.code}{' '}
                            <span className="text-textMuted font-normal">/ {s.name_i18n?.en || s.code}</span>
                          </p>
                          <p className="text-textMuted mt-0.5">
                            Mã: <strong className="text-accent">{s.code}</strong> · Tối thiểu {s.min_duration_mins}p ·{' '}
                            {s.court_count || 0} sân đang dùng
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => deleteSport(s)}
                          title="Xóa môn thể thao"
                          className="p-2 rounded bg-statusDanger-soft text-statusDanger border border-statusDanger-border hover:opacity-90 shrink-0"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* REAL SMTP MAIL CONFIGURATION & TEST */}
            {activeTab === 'SMTP' && (
              <div className="tab-panel-anim grid lg:grid-cols-[1.3fr_1fr] gap-6">
                <form
                  onSubmit={saveSmtpSettings}
                  className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4 text-sm"
                >
                  <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
                    <Mail className="w-5 h-5 text-accent" />
                    <span>Cấu Hình Máy Chủ SMTP Gửi Email Giao Dịch Thật (Nodemailer)</span>
                  </h3>
                  <p className="text-xs text-textMuted">
                    Hỗ trợ Gmail App Password (smtp.gmail.com:587), Amazon SES, SendGrid, Brevo hoặc Mailpit. Khi bật, toàn bộ OTP, vé .ICS và chiến dịch sẽ gửi thật qua SMTP kèm cơ chế tự thử lại thông minh.
                  </p>

                  <div className="grid sm:grid-cols-3 gap-3">
                    <div className="sm:col-span-2">
                      <label className="block text-xs text-textMuted mb-1">SMTP Host</label>
                      <input
                        type="text"
                        value={smtpHost}
                        onChange={(e) => setSmtpHost(e.target.value)}
                        className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong font-mono text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">SMTP Port</label>
                      <input
                        type="number"
                        value={smtpPort}
                        onChange={(e) => setSmtpPort(Number(e.target.value))}
                        className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong font-mono text-xs tabular-nums"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-textMuted mb-1">SMTP Username</label>
                      <input
                        type="text"
                        value={smtpUser}
                        onChange={(e) => setSmtpUser(e.target.value)}
                        className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">
                        SMTP Password / App Password {smtpStatusInfo?.settings?.has_password ? '(Đã lưu — để trống nếu giữ nguyên)' : ''}
                      </label>
                      <input
                        type="password"
                        value={smtpPass}
                        onChange={(e) => setSmtpPass(e.target.value)}
                        className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
                      />
                    </div>
                  </div>

                  <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Địa chỉ người gửi (From Email)</label>
                      <input
                        type="email"
                        value={smtpFromEmail}
                        onChange={(e) => setSmtpFromEmail(e.target.value)}
                        className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-textMuted mb-1">Tên hiển thị người gửi</label>
                      <input
                        type="text"
                        value={smtpFromName}
                        onChange={(e) => setSmtpFromName(e.target.value)}
                        className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
                      />
                    </div>
                  </div>

                  <div className="flex flex-wrap gap-5 pt-1 text-xs">
                    <label className="inline-flex items-center gap-2 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={smtpSecure}
                        onChange={(e) => setSmtpSecure(e.target.checked)}
                        className="accent-[var(--accent)]"
                      />
                      <span>Bật TLS trực tiếp (Port 465)</span>
                    </label>
                    <label className="inline-flex items-center gap-2 cursor-pointer font-bold text-accent">
                      <input
                        type="checkbox"
                        checked={smtpEnabled}
                        onChange={(e) => setSmtpEnabled(e.target.checked)}
                        className="accent-[var(--accent)]"
                      />
                      <span>Kích hoạt gửi Email thật qua SMTP</span>
                    </label>
                  </div>

                  <button
                    type="submit"
                    disabled={smtpBusy}
                    className="w-full min-h-[44px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
                  >
                    Lưu Cấu Hình Máy Chủ SMTP
                  </button>
                </form>

                <form
                  onSubmit={triggerTestEmail}
                  className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4 h-fit"
                >
                  <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
                    <Send className="w-4 h-4 text-accent" />
                    <span>Kiểm Tra Gửi Thư Thực Tế</span>
                  </h3>
                  <p className="text-xs text-textMuted">
                    Xác minh kết nối xác thực máy chủ SMTP (`transporter.verify()`) và gửi ngay 1 email kiểm tra tới hộp thư bạn chỉ định.
                  </p>
                  <div>
                    <label className="block text-xs text-textMuted mb-1">Email nhận thư kiểm tra</label>
                    <input
                      type="email"
                      required
                      value={testRecipient}
                      onChange={(e) => setTestRecipient(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={smtpBusy || !testRecipient}
                    className="w-full min-h-[44px] rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-textStrong font-bold text-xs disabled:opacity-50"
                  >
                    Xác Minh Kết Nối & Gửi Email Kiểm Tra
                  </button>
                </form>
              </div>
            )}

            {/* P-02 TIME-LIMITED SUPPORT SESSIONS */}
            {activeTab === 'SUPPORT' && (
              <div className="tab-panel-anim grid lg:grid-cols-2 gap-6">
                <form
                  onSubmit={startSupportSession}
                  className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4 text-sm"
                >
                  <h3 className="font-bold text-base text-textStrong">Mở Phiên Hỗ Trợ Kỹ Thuật Chỉ Đọc (P-02)</h3>
                  <p className="text-xs text-textMuted">
                    Mọi phiên hỗ trợ tự động hết hạn sau 30 phút, mặc định chỉ đọc (read_only = true) và được ghi vào Audit Log của Tenant.
                  </p>
                  <select
                    value={supTenantId}
                    onChange={(e) => setSupTenantId(e.target.value)}
                    className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  >
                    {tenants.map((t) => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                  <div>
                    <label className="block text-xs text-textMuted mb-1">Lý do mở phiên hỗ trợ (Bắt buộc ghi log)</label>
                    <input
                      type="text"
                      required
                      value={supReason}
                      onChange={(e) => setSupReason(e.target.value)}
                      className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                    />
                  </div>
                  <button
                    type="submit"
                    className="w-full min-h-[44px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
                  >
                    Bắt Đầu Phiên Hỗ Trợ 30 Phút
                  </button>
                </form>

                <div className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-3">
                  <h3 className="font-bold text-base text-textStrong">Nhật Ký Phiên Hỗ Trợ ({supportSessions.length})</h3>
                  <div className="space-y-2.5 max-h-[340px] overflow-y-auto text-xs tabular-nums">
                    {supportSessions.map((s) => (
                      <div key={s.id} className="p-3 rounded bg-panel-2 border border-borderToken space-y-1">
                        <div className="flex justify-between">
                          <strong className="text-textStrong">{s.tenant_name}</strong>
                          <span className="text-accent font-bold">READ-ONLY</span>
                        </div>
                        <p className="text-textBody">{s.reason}</p>
                        <p className="text-textMuted">
                          Hết hạn: {new Date(s.expires_at).toLocaleString('vi-VN')}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            {/* PLATFORM MEDIA & VENUE GALLERIES MANAGER */}
            {activeTab === 'MEDIA' && (() => {
              const targetVenue =
                platformVenues.find((v) => v.id === (mediaVenueId || platformVenues[0]?.id)) || platformVenues[0];
              const currentSlides: string[] =
                mediaTargetType === 'venue'
                  ? resolveVenueGallery(targetVenue)
                  : mediaTargetType === 'hero'
                    ? mediaSettings.hero_slides
                    : mediaTargetType === 'auth'
                      ? mediaSettings.auth_slides
                      : mediaSettings.ops_slides;

              return (
                <div className="tab-panel-anim grid grid-cols-1 lg:grid-cols-[1fr_1.35fr] gap-6">
                  <form
                    onSubmit={uploadPlatformMedia}
                    className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4 h-fit"
                  >
                    <h2 className="font-bold text-base sm:text-lg text-textStrong flex items-center gap-2">
                      <Upload className="w-5 h-5 text-accent" />
                      <span>Tải Lên Nhiều Ảnh Trình Chiếu Lặp (WebP)</span>
                    </h2>

                    <div>
                      <label className="block text-xs font-semibold text-textBody mb-1.5">
                        Chọn vị trí hiển thị ảnh
                      </label>
                      <select
                        value={mediaTargetType}
                        onChange={(e) => setMediaTargetType(e.target.value as any)}
                        className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                      >
                        <option value="venue">Thư viện ảnh của Cơ sở sân cụ thể (chạy lặp trên thẻ sân)</option>
                        <option value="hero">Ảnh nền Hero Trang Chủ & Mobile</option>
                        <option value="auth">Ảnh trình chiếu khung Đăng Nhập / Đăng Ký Khách Hàng</option>
                        <option value="ops">Ảnh trình chiếu cổng Đăng Nhập Quản Trị / Thu Ngân</option>
                      </select>
                    </div>

                    {mediaTargetType === 'venue' && (
                      <div>
                        <label className="block text-xs font-semibold text-textBody mb-1.5">
                          Chọn cơ sở sân áp dụng
                        </label>
                        <select
                          value={targetVenue?.id || ''}
                          onChange={(e) => setMediaVenueId(e.target.value)}
                          className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                        >
                          {platformVenues.map((v) => (
                            <option key={v.id} value={v.id}>
                              {v.name} — {v.tenant_name} ({Array.isArray(v.photos) ? v.photos.length : 0} ảnh)
                            </option>
                          ))}
                        </select>
                      </div>
                    )}

                    <label className="block cursor-pointer rounded-token-md border-2 border-dashed border-accent-border bg-panel-2/70 hover:bg-surfaceHover p-6 text-center space-y-2">
                      <input
                        type="file"
                        accept="image/*"
                        multiple
                        onChange={(e) =>
                          setMediaFiles(e.target.files ? Array.from(e.target.files).slice(0, 10) : [])
                        }
                        className="sr-only"
                      />
                      <div className="w-12 h-12 rounded-token-full bg-accent-soft border border-accent-border flex items-center justify-center mx-auto text-accent">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                      {mediaFiles.length > 0 ? (
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-accent">
                            Đã chọn {mediaFiles.length} ảnh sẵn sàng nén WebP
                          </p>
                          <p className="text-xs text-textMuted truncate max-w-sm mx-auto">
                            {mediaFiles.map((f) => f.name).join(', ')}
                          </p>
                        </div>
                      ) : (
                        <div className="space-y-1">
                          <p className="text-sm font-bold text-textStrong">
                            Nhấn chọn nhiều ảnh cùng lúc (Tối đa 10 ảnh/lần)
                          </p>
                          <p className="text-xs text-textMuted">
                            Tự động nén chuẩn WebP, chạy lặp tự động và có mũi tên ‹ › chuyển ảnh
                          </p>
                        </div>
                      )}
                    </label>

                    <button
                      type="submit"
                      disabled={mediaFiles.length === 0 || mediaBusy}
                      className="w-full min-h-[46px] rounded-token-full bg-accent text-textOnAccent font-bold text-sm disabled:opacity-50"
                    >
                      {mediaBusy ? 'Đang nén WebP & Lưu...' : `Tải Lên ${mediaFiles.length > 0 ? `${mediaFiles.length} Ảnh` : 'Vào Hệ Thống'}`}
                    </button>
                  </form>

                  <div className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-5">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <h3 className="font-bold text-base text-textStrong">
                          Xem Trước Trình Chiếu Lặp ({currentSlides.length} ảnh)
                        </h3>
                        <p className="text-xs text-textMuted mt-0.5">
                          Đưa ảnh bất kỳ lên vị trí #1 hoặc xóa ảnh trực tiếp bên dưới.
                        </p>
                      </div>
                    </div>

                    <LoopingPhotoCarousel
                      images={currentSlides}
                      alt="Preview"
                      className="aspect-[16/9] rounded-token-md border border-borderStrong"
                    />

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
                      {currentSlides.map((url, idx) => (
                        <div
                          key={`${url}-${idx}`}
                          className="relative rounded-token-sm overflow-hidden border border-borderStrong bg-panel-2 aspect-[16/10]"
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={url} alt="" className="w-full h-full object-cover" />
                          <div className="absolute inset-0 bg-gradient-to-t from-page/90 via-transparent to-page/40" />
                          <span className="absolute top-2 left-2 px-2 py-0.5 rounded bg-page/85 text-[11px] font-bold text-textStrong tabular-nums">
                            {idx === 0 ? '#1 · Đầu tiên' : `#${idx + 1}`}
                          </span>
                          <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
                            {idx > 0 && (
                              <button
                                type="button"
                                onClick={() => {
                                  const reordered = [url, ...currentSlides.filter((u) => u !== url)];
                                  if (mediaTargetType === 'venue' && targetVenue) {
                                    void updatePlatformVenueGallery(targetVenue.id, reordered);
                                  } else if (mediaTargetType !== 'venue') {
                                    void updateSystemSlideList(mediaTargetType, reordered);
                                  }
                                }}
                                className="min-h-[30px] px-2 rounded bg-accent text-textOnAccent text-[11px] font-bold inline-flex items-center gap-1"
                              >
                                <Star className="w-3 h-3" />
                                <span>Đầu</span>
                              </button>
                            )}
                            <button
                              type="button"
                              onClick={() => {
                                const remaining = currentSlides.filter((u) => u !== url);
                                if (mediaTargetType === 'venue' && targetVenue) {
                                  void updatePlatformVenueGallery(targetVenue.id, remaining);
                                } else if (mediaTargetType !== 'venue') {
                                  void updateSystemSlideList(mediaTargetType, remaining);
                                }
                              }}
                              className="min-h-[30px] min-w-[30px] rounded bg-statusDanger-soft border border-statusDanger-border text-statusDanger flex items-center justify-center hover:bg-statusDanger hover:text-textOnAccent"
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })()}

            {/* SUPER ADMIN PROFILE & RESPONSIBILITIES */}
            {activeTab === 'PROFILE' && (
              <OperatorProfilePanel
                portal="platform"
                apiBase={platformApi}
                token={token}
                language={language}
                onProfileUpdated={(p) => {
                  const merged = { ...admin, ...p };
                  setAdmin(merged);
                  localStorage.setItem('court_platform_user', JSON.stringify(merged));
                }}
              />
            )}
          </div>
        )}
      </main>
    </div>
  );
}

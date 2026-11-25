'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  Camera,
  CheckCircle2,
  ShieldCheck,
  AlertCircle,
  Lock,
  Award,
  Mail,
  Phone,
  Calendar,
  KeyRound,
} from 'lucide-react';

interface OperatorProfilePanelProps {
  portal: 'staff' | 'admin' | 'platform';
  apiBase: string;
  token: string;
  language: 'vi' | 'en';
  onProfileUpdated?: (profile: any) => void;
}

const ROLE_MATRIX: Record<
  string,
  {
    badgeVi: string;
    badgeEn: string;
    capsVi: string[];
    capsEn: string[];
    obsVi: string[];
    obsEn: string[];
  }
> = {
  STAFF: {
    badgeVi: 'Nhân Viên Trực Quầy (Staff)',
    badgeEn: 'Front-Desk Counter Staff',
    capsVi: [
      'Xem lịch sân thời gian thực tại các cơ sở được phân công trực tiếp.',
      'Mở ca trực đầu giờ, tạo lịch đặt tại quầy cho khách vãng lai hoặc khách gọi điện/Zalo.',
      'Thực hiện thủ tục Check-in, đánh dấu Vắng mặt (No-show) và thu tiền mặt/VietQR phần còn lại.',
      'Nhận cảnh báo thiết bị đèn/cửa IoT mất kết nối và bật/tắt thủ công tại tủ điều khiển quầy.',
    ],
    capsEn: [
      'Inspect live court calendars strictly within assigned venues.',
      'Open counter shifts and create walk-in or phone bookings via the unified pricing core.',
      'Check in arriving players, mark no-shows, and collect remaining cash/VietQR balances.',
      'Receive smart-lighting failure alerts and trigger manual relay overrides at the desk.',
    ],
    obsVi: [
      'Tuyệt đối một người một tài khoản — nghiêm cấm dùng chung tài khoản trên máy quầy.',
      'Kiểm đếm tiền mặt đầu ca và chốt ca trung thực; mọi khoản lệch tiền (variance) bắt buộc ghi rõ lý do giải trình.',
      'Khóa màn hình bằng mã PIN khi rời quầy; không tự ý hoàn tiền cọc hoặc giảm giá vượt hạn mức được cấp.',
      'Bảo mật thông tin liên hệ của khách hàng, không xuất danh sách khách ra ngoài.',
    ],
    obsEn: [
      'One person, one account — never share credentials on counter terminals.',
      'Count opening and closing drawer cash accurately and document any variance for Manager review.',
      'Lock the screen with your PIN when stepping away; refunds and over-limit discounts require Manager/Owner approval.',
      'Protect customer contact privacy; bulk list export is prohibited.',
    ],
  },
  MANAGER: {
    badgeVi: 'Quản Lý Cơ Sở (Manager)',
    badgeEn: 'Venue Manager',
    capsVi: [
      'Quản lý lịch sân, cấu hình giờ mở cửa, bảng giá, khóa sân bảo trì và chính sách mưa tại cơ sở được giao.',
      'Tạo và quản lý tài khoản Nhân viên quầy, phê duyệt đối soát ca trực và xử lý lệch thanh toán.',
      'Vận hành nhập dữ liệu CSV, đề xuất ưu đãi giờ trống, giải đấu phong trào và điều khiển đèn IoT.',
      'Theo dõi báo cáo doanh thu, tỷ lệ lấp đầy cấu hình thực và xuất báo cáo CSV.',
    ],
    capsEn: [
      'Configure courts, opening hours, pricing bands, maintenance blocks, and weather closures for assigned venues.',
      'Manage counter staff accounts, review shift reconciliations, and resolve payment mismatches.',
      'Run CSV imports, off-peak deal rules, tournaments, and smart court lighting schedules.',
      'Monitor real configured occupancy, net revenue charts, and localized CSV exports.',
    ],
    obsVi: [
      'Chỉ thao tác trong phạm vi cơ sở được Chủ sân phân quyền; mọi chỉnh sửa giá, hoàn tiền và điểm giải đấu đều ghi Audit Log.',
      'Kiểm tra kỹ danh sách ảnh hưởng trước khi xác nhận đóng sân hàng loạt hoặc gửi chiến dịch email.',
      'Khuyến nghị kích hoạt xác thực 2 lớp (2FA) và đổi mật khẩu định kỳ.',
    ],
    obsEn: [
      'Operate strictly within assigned venues; all pricing, refund, and tournament score edits are audited.',
      'Verify affected bookings carefully before executing bulk weather closures or marketing campaigns.',
      'Keep 2FA enabled and safeguard administrative credentials.',
    ],
  },
  OWNER: {
    badgeVi: 'Chủ Sân (Tenant Owner)',
    badgeEn: 'Venue Owner (Tenant Admin)',
    capsVi: [
      'Toàn quyền quản trị tất cả cơ sở, sân đơn/sân ghép, bảng giá, chính sách đặt cọc và hoàn hủy của đơn vị.',
      'Thiết lập và xác minh tài khoản ngân hàng nhận tiền VietQR trực tiếp từ khách đặt sân.',
      'Phê duyệt hoàn tiền cọc, quản lý nhân sự (Quản lý & Nhân viên), phê duyệt ưu đãi giờ trống & chiến dịch khách hàng.',
      'Truy cập toàn bộ Dashboard biểu đồ doanh thu thuần, bản đồ nhiệt công suất sân và nhật ký kiểm toán (Audit Log).',
    ],
    capsEn: [
      'Full authority across all tenant venues, composite courts, pricing tables, and deposit/refund policies.',
      'Configure and verify the live receiving bank account for direct VietQR customer transfers.',
      'Approve deposit refunds, manage Managers and Staff, and authorize deal rules and marketing campaigns.',
      'Access complete executive revenue analytics, occupancy heatmaps, and immutable audit logs.',
    ],
    obsVi: [
      'Bắt buộc sử dụng xác thực 2 lớp (2FA) để bảo vệ cấu hình tài khoản ngân hàng nhận tiền.',
      'Đảm bảo thông tin tài khoản nhận tiền chính chủ và xử lý hoàn cọc đúng cam kết chính sách đã công bố cho khách.',
      'Tuân thủ bảo vệ dữ liệu cá nhân khách hàng (chỉ gửi tin khuyến mãi cho khách đã đồng ý opt-in).',
    ],
    obsEn: [
      'Enforce two-factor authentication (2FA) to protect receiving bank settings and financial controls.',
      'Verify accurate receiving bank details and honor published cancellation refund policies.',
      'Respect customer data rights and send promotional campaigns strictly to opted-in players.',
    ],
  },
  SUPER_ADMIN: {
    badgeVi: 'Quản Trị Viên Nền Tảng (Super Admin)',
    badgeEn: 'Platform Super Admin',
    capsVi: [
      'Quản lý danh sách đối tác chủ sân (Tenants), gói thuê bao, kích hoạt hoặc tạm khóa đơn vị vi phạm.',
      'Cấu hình máy chủ gửi thư SMTP toàn nền tảng và kiểm tra kết nối gửi email giao dịch thật.',
      'Giám sát sức khỏe hệ thống, hàng đợi email outbox, giữ chỗ đang hoạt động và webhook.',
      'Mở phiên hỗ trợ kỹ thuật có thời hạn (Time-limited Read-Only Support Session) có ghi nhật ký kiểm toán.',
    ],
    capsEn: [
      'Manage tenant onboarding, subscription plans, suspensions, and reactivations.',
      'Configure platform-wide live SMTP delivery settings and verify outbound mail connectivity.',
      'Monitor platform health, email outbox queues, active holds, and webhook events.',
      'Initiate time-limited, read-only, fully audited tenant support sessions.',
    ],
    obsVi: [
      'Tuyệt đối không truy cập dữ liệu riêng của chủ sân ngoài phiên hỗ trợ có lý do và ghi vết Audit Log.',
      'Không can thiệp luồng tiền trực tiếp của chủ sân; đảm bảo cô lập dữ liệu đa khách hàng (Multi-tenant RLS).',
      'Bảo vệ khóa bí mật hệ thống, cấu hình SMTP và thực hiện kiểm tra sao lưu định kỳ.',
    ],
    obsEn: [
      'Never inspect tenant operational data outside an explicit, time-limited, audited support session.',
      'Never take custody of venue owners’ funds; preserve strict multi-tenant RLS isolation.',
      'Safeguard platform secrets, SMTP credentials, and infrastructure reliability.',
    ],
  },
};

export function OperatorProfilePanel({
  portal,
  apiBase,
  token,
  language,
  onProfileUpdated,
}: OperatorProfilePanelProps) {
  const [profile, setProfile] = useState<any>(null);
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [prefLang, setPrefLang] = useState<'vi' | 'en'>(language);
  const [currPass, setCurrPass] = useState('');
  const [newPass, setNewPass] = useState('');
  const [confirmPass, setConfirmPass] = useState('');
  const [newPin, setNewPin] = useState('');
  const [totpSetup, setTotpSetup] = useState<{ secret: string; otpauth: string } | null>(null);
  const [totpCode, setTotpCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isEn = language === 'en';

  const loadMe = async () => {
    const res = await fetch(`${apiBase}/me`, {
      headers: { Authorization: `Bearer ${token}`, 'Accept-Language': language },
    });
    if (res.ok) {
      const data = await res.json();
      setProfile(data.profile);
      setFullName(data.profile.full_name || '');
      setPhone(data.profile.phone || '');
      setEmail(data.profile.email || '');
      setPrefLang(data.profile.preferred_language === 'en' ? 'en' : 'vi');
    }
  };

  useEffect(() => {
    void loadMe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [apiBase, token]);

  const notify = (ok: boolean, text: string) => {
    setMsg({ ok, text });
    setTimeout(() => setMsg((c) => (c?.text === text ? null : c)), 4500);
  };

  const handleAvatar = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploading(true);
    const fd = new FormData();
    fd.append('avatar', file);
    try {
      const res = await fetch(`${apiBase}/me/avatar`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
        body: fd,
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Upload failed');
      setProfile((prev: any) => ({ ...prev, ...data.profile, avatar_url: data.avatar_url }));
      onProfileUpdated?.(data.profile);
      notify(true, isEn ? 'Avatar updated (WebP 320×320).' : 'Đã cập nhật ảnh đại diện chuẩn WebP.');
    } catch (err: any) {
      notify(false, err.message || 'Error');
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const res = await fetch(`${apiBase}/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
          'Accept-Language': language,
        },
        body: JSON.stringify({
          full_name: fullName.trim(),
          phone: phone.trim(),
          email: email.trim(),
          preferred_language: prefLang,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Update failed');
      setProfile((prev: any) => ({ ...prev, ...data.profile }));
      onProfileUpdated?.(data.profile);
      notify(true, isEn ? 'Profile saved.' : 'Đã lưu thông tin hồ sơ.');
    } catch (err: any) {
      notify(false, err.message || 'Error');
    } finally {
      setBusy(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPass !== confirmPass) {
      notify(false, isEn ? 'Passwords do not match.' : 'Hai mật khẩu mới chưa khớp.');
      return;
    }
    setBusy(true);
    try {
      const endpoint = portal === 'staff' ? `${apiBase}/auth/change-password` : `${apiBase}/me/password`;
      const body =
        portal === 'staff'
          ? { old_password: currPass, new_password: newPass, new_pin: newPin || undefined }
          : { current_password: currPass, new_password: newPass, confirm_password: confirmPass };

      const res = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Password update failed');
      setCurrPass('');
      setNewPass('');
      setConfirmPass('');
      setNewPin('');
      notify(true, isEn ? 'Security credentials updated.' : 'Đã cập nhật mật khẩu bảo mật thành công.');
    } catch (err: any) {
      notify(false, err.message || 'Error');
    } finally {
      setBusy(false);
    }
  };

  const init2fa = async () => {
    const res = await fetch(`${apiBase}/auth/2fa/setup`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.ok) setTotpSetup(await res.json());
  };

  const verify2fa = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${apiBase}/auth/2fa/verify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ token: totpCode }),
    });
    const data = await res.json();
    if (res.ok) {
      setTotpSetup(null);
      setTotpCode('');
      setProfile((prev: any) => ({ ...prev, totp_enabled: true }));
      notify(true, data.message || '2FA Activated');
    } else {
      notify(false, data.message || 'Invalid 2FA code');
    }
  };

  const roleKey = profile?.role || (portal === 'platform' ? 'SUPER_ADMIN' : portal === 'admin' ? 'OWNER' : 'STAFF');
  const spec = ROLE_MATRIX[roleKey] || ROLE_MATRIX.STAFF;

  return (
    <div className="tab-panel-anim space-y-6">
      {msg && (
        <div
          role="status"
          className={`p-4 rounded-token-md border text-sm font-semibold flex items-center gap-2 ${
            msg.ok
              ? 'bg-accent-soft border-accent-border text-accent'
              : 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
          }`}
        >
          {msg.ok ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
          <span>{msg.text}</span>
        </div>
      )}

      {/* Identity Card */}
      <div className="bg-panel rounded-token-lg border border-borderStrong p-6 sm:p-8 flex flex-col md:flex-row md:items-center justify-between gap-6">
        <div className="flex flex-col sm:flex-row sm:items-center gap-5">
          <div className="shrink-0">
            {profile?.avatar_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={profile.avatar_url}
                alt={profile.full_name || 'Avatar'}
                className="w-24 h-24 rounded-token-lg object-cover border-2 border-accent"
              />
            ) : (
              <div className="w-24 h-24 rounded-token-lg bg-panel-2 border-2 border-accent-border flex items-center justify-center text-3xl font-extrabold text-accent">
                {(profile?.full_name || 'A').charAt(0).toUpperCase()}
              </div>
            )}
            <input
              ref={fileRef}
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={handleAvatar}
              className="sr-only"
            />
            <button
              type="button"
              disabled={uploading}
              onClick={() => fileRef.current?.click()}
              className="mt-2.5 w-full min-h-[38px] px-3 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-xs font-semibold text-textStrong flex items-center justify-center gap-1.5"
            >
              <Camera className="w-3.5 h-3.5 text-accent" />
              <span>{uploading ? '...' : isEn ? 'Change Photo' : 'Đổi ảnh đại diện'}</span>
            </button>
          </div>

          <div className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <span className="px-3 py-1 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold inline-flex items-center gap-1.5">
                <Award className="w-3.5 h-3.5" />
                <span>{isEn ? spec.badgeEn : spec.badgeVi}</span>
              </span>
              {profile?.tenant_name && (
                <span className="px-3 py-1 rounded-token-full bg-panel-2 border border-borderToken text-textStrong text-xs font-semibold">
                  {profile.tenant_name}
                </span>
              )}
            </div>

            <h2 className="text-2xl font-extrabold text-textStrong">{profile?.full_name || '...'}</h2>

            <div className="flex flex-wrap items-center gap-4 text-xs sm:text-sm text-textBody tabular-nums">
              {profile?.username && <span className="font-mono text-textMuted">@{profile.username}</span>}
              {profile?.email && (
                <span className="inline-flex items-center gap-1.5">
                  <Mail className="w-4 h-4 text-accent" />
                  <span>{profile.email}</span>
                </span>
              )}
              {profile?.phone && (
                <span className="inline-flex items-center gap-1.5">
                  <Phone className="w-4 h-4 text-accent" />
                  <span>{profile.phone}</span>
                </span>
              )}
              {profile?.created_at && (
                <span className="inline-flex items-center gap-1.5 text-textMuted">
                  <Calendar className="w-4 h-4 text-accent" />
                  <span>{new Date(profile.created_at).toLocaleDateString(isEn ? 'en-US' : 'vi-VN')}</span>
                </span>
              )}
            </div>

            {typeof profile?.discount_limit === 'number' && portal !== 'platform' && (
              <p className="text-xs text-accent font-semibold tabular-nums">
                {isEn ? 'Authorized manual discount limit:' : 'Hạn mức giảm giá trực tiếp được cấp:'}{' '}
                {new Intl.NumberFormat('vi-VN').format(profile.discount_limit)} ₫
                {Array.isArray(profile?.assigned_venues) &&
                  ` · ${isEn ? 'Assigned venues:' : 'Số cơ sở phụ trách:'} ${profile.assigned_venues.length}`}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Role Capabilities vs Operational Responsibilities */}
      <div className="grid md:grid-cols-2 gap-6">
        <div className="bg-panel rounded-token-lg border border-borderStrong p-6 space-y-3.5">
          <h3 className="font-bold text-base sm:text-lg text-textStrong flex items-center gap-2">
            <CheckCircle2 className="w-5 h-5 text-accent shrink-0" />
            <span>{isEn ? 'Authorized Capabilities & Scope' : 'Chức Năng & Quyền Hạn Được Cấp'}</span>
          </h3>
          <ul className="space-y-2.5 text-sm text-textBody leading-relaxed">
            {(isEn ? spec.capsEn : spec.capsVi).map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="w-2 h-2 rounded-full bg-accent mt-2 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>

        <div className="bg-panel rounded-token-lg border border-borderStrong p-6 space-y-3.5">
          <h3 className="font-bold text-base sm:text-lg text-textStrong flex items-center gap-2">
            <ShieldCheck className="w-5 h-5 text-statusWarning shrink-0" />
            <span>{isEn ? 'Operational Responsibilities & Audit Rules' : 'Nghĩa Vụ Vận Hành & Kỷ Luật Bảo Mật'}</span>
          </h3>
          <ul className="space-y-2.5 text-sm text-textBody leading-relaxed">
            {(isEn ? spec.obsEn : spec.obsVi).map((line) => (
              <li key={line} className="flex items-start gap-2.5">
                <span className="w-2 h-2 rounded-full bg-statusWarning mt-2 shrink-0" />
                <span>{line}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>

      {/* Edit Info & Security Forms */}
      <div className="grid lg:grid-cols-2 gap-6">
        <form onSubmit={handleSaveInfo} className="bg-panel rounded-token-lg border border-borderStrong p-6 space-y-4">
          <h3 className="font-bold text-base text-textStrong">
            {isEn ? 'Update Personal Information' : 'Cập Nhật Thông Tin Cá Nhân'}
          </h3>

          <div>
            <label htmlFor="op-fullname" className="block text-xs font-semibold text-textBody mb-1">
              {isEn ? 'Full Name' : 'Họ và tên'}
            </label>
            <input
              id="op-fullname"
              type="text"
              required
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
            />
          </div>

          {portal !== 'platform' && (
            <>
              {portal === 'admin' && (
                <div>
                  <label htmlFor="op-phone" className="block text-xs font-semibold text-textBody mb-1">
                    {isEn ? 'Phone Number' : 'Số điện thoại'}
                  </label>
                  <input
                    id="op-phone"
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong tabular-nums focus:border-accent outline-none"
                  />
                </div>
              )}

              <div>
                <label htmlFor="op-email" className="block text-xs font-semibold text-textBody mb-1">
                  Email
                </label>
                <input
                  id="op-email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                />
              </div>
            </>
          )}

          <button
            type="submit"
            disabled={busy}
            className="w-full min-h-[44px] rounded-token-full bg-accent hover:bg-accent-hover text-textOnAccent font-bold text-sm"
          >
            {isEn ? 'Save Profile Changes' : 'Lưu Thay Đổi Hồ Sơ'}
          </button>
        </form>

        <div className="bg-panel rounded-token-lg border border-borderStrong p-6 space-y-5">
          <form onSubmit={handleSavePassword} className="space-y-3.5">
            <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
              <Lock className="w-4 h-4 text-accent" />
              <span>{isEn ? 'Change Password' : 'Đổi Mật Khẩu'}{portal === 'staff' ? ' & Mã PIN Quầy' : ''}</span>
            </h3>

            <div>
              <label htmlFor="op-curr-pass" className="block text-xs font-semibold text-textBody mb-1">
                {isEn ? 'Current Password' : 'Mật khẩu hiện tại'}
              </label>
              <input
                id="op-curr-pass"
                type="password"
                required
                value={currPass}
                onChange={(e) => setCurrPass(e.target.value)}
                className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
              />
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label htmlFor="op-new-pass" className="block text-xs font-semibold text-textBody mb-1">
                  {isEn ? 'New Password (≥8 chars)' : 'Mật khẩu mới (≥8 ký tự)'}
                </label>
                <input
                  id="op-new-pass"
                  type="password"
                  minLength={8}
                  required
                  value={newPass}
                  onChange={(e) => setNewPass(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                />
              </div>
              <div>
                <label htmlFor="op-conf-pass" className="block text-xs font-semibold text-textBody mb-1">
                  {isEn ? 'Confirm New Password' : 'Nhập lại mật khẩu mới'}
                </label>
                <input
                  id="op-conf-pass"
                  type="password"
                  minLength={8}
                  required
                  value={confirmPass}
                  onChange={(e) => setConfirmPass(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong focus:border-accent outline-none"
                />
              </div>
            </div>

            {portal === 'staff' && (
              <div>
                <label htmlFor="op-pin" className="block text-xs font-semibold text-textBody mb-1">
                  {isEn ? 'Quick Unlock PIN (4–6 digits, optional)' : 'Mã PIN mở khóa nhanh (4–6 số, tùy chọn)'}
                </label>
                <input
                  id="op-pin"
                  type="password"
                  inputMode="numeric"
                  maxLength={6}
                  value={newPin}
                  onChange={(e) => setNewPin(e.target.value.replace(/\D/g, ''))}
                  className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong font-mono tracking-widest tabular-nums focus:border-accent outline-none"
                />
              </div>
            )}

            <button
              type="submit"
              disabled={busy}
              className="w-full min-h-[44px] rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-textStrong font-bold text-sm"
            >
              {isEn ? 'Update Security Credentials' : 'Cập Nhật Mật Khẩu Bảo Mật'}
            </button>
          </form>

          {(portal === 'admin' || portal === 'platform') && (
            <div className="pt-4 border-t border-borderToken space-y-3">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs sm:text-sm font-bold text-textStrong flex items-center gap-1.5">
                  <KeyRound className="w-4 h-4 text-accent" />
                  <span>{isEn ? 'Two-Factor Authentication (TOTP 2FA)' : 'Xác Thực 2 Lớp (TOTP 2FA)'}</span>
                </span>
                <span
                  className={`px-2.5 py-0.5 rounded-token-full text-xs font-bold ${
                    profile?.totp_enabled
                      ? 'bg-accent-soft text-accent border border-accent-border'
                      : 'bg-statusWarning-soft text-statusWarning border border-statusWarning-border'
                  }`}
                >
                  {profile?.totp_enabled ? (isEn ? 'Enabled' : 'Đã bật') : isEn ? 'Not Enrolled' : 'Chưa bật'}
                </span>
              </div>

              {!profile?.totp_enabled && !totpSetup && (
                <button
                  type="button"
                  onClick={init2fa}
                  className="min-h-[38px] px-4 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold"
                >
                  {isEn ? 'Initialize Authenticator 2FA' : 'Thiết lập khóa 2FA ngay'}
                </button>
              )}

              {totpSetup && (
                <form onSubmit={verify2fa} className="p-3.5 rounded-token-md bg-panel-2 border border-borderStrong space-y-2.5 text-xs">
                  <p className="text-textBody">
                    {isEn ? 'Enter this secret into Google Authenticator / Authy:' : 'Nhập khóa bí mật này vào ứng dụng Authenticator:'}
                  </p>
                  <code className="block p-2 rounded bg-page text-accent font-mono font-bold break-all select-all">
                    {totpSetup.secret}
                  </code>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      inputMode="numeric"
                      maxLength={6}
                      required
                      value={totpCode}
                      onChange={(e) => setTotpCode(e.target.value.replace(/\D/g, ''))}
                      aria-label="6-digit 2FA code"
                      className="flex-1 min-h-[40px] px-3 bg-page border border-borderStrong rounded-token-sm text-center font-mono text-base text-textStrong tabular-nums"
                    />
                    <button
                      type="submit"
                      className="min-h-[40px] px-4 rounded-token-sm bg-accent text-textOnAccent font-bold"
                    >
                      {isEn ? 'Verify' : 'Kích hoạt'}
                    </button>
                  </div>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

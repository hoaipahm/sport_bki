'use client';

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import Link from 'next/link';
import {
  Briefcase,
  Search,
  CheckCircle2,
  User,
  Phone,
  DollarSign,
  PlusCircle,
  LogOut,
  Calendar,
  AlertCircle,
  RefreshCw,
  X,
  Lightbulb,
  Power,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { staffApi, createIdempotencyKey } from '../../lib/api';
import { DEFAULT_OPS_SLIDES } from '../../lib/media';
import { PriceRule, resolvePrice, vietnamDate } from '../../../../shared/booking';
import { LoopingPhotoCarousel } from '../../components/LoopingPhotoCarousel';
import { OperatorProfilePanel } from '../../components/OperatorProfilePanel';

interface StaffBooking {
  id: string;
  booking_code: string;
  venue_id: string;
  venue_name: string;
  court_id: string;
  court_name: string;
  customer_name: string;
  customer_phone: string;
  start_at: string;
  end_at: string;
  total_amount: number;
  deposit_amount: number;
  paid_amount: number;
  due_at_venue: number;
  refund_status?: string;
  payment_review_reason?: string | null;
  status: string;
}

interface StaffVenue {
  id: string;
  name: string;
  address: string;
}

interface StaffCourt {
  id: string;
  venue_id: string;
  name: string;
  court_type: string;
  min_duration_mins: number;
  step_mins: number;
}

export default function StaffPage() {
  const { language, toggleLanguage } = useLanguage();

  const [token, setToken] = useState<string | null>(null);
  const [staffInfo, setStaffInfo] = useState<any>(null);
  const [staffTab, setStaffTab] = useState<'COUNTER' | 'IOT' | 'PROFILE'>('COUNTER');
  const [iotDevices, setIotDevices] = useState<any[]>([]);

  useEffect(() => {
    const savedToken = localStorage.getItem('court_staff_token');
    const savedUser = localStorage.getItem('court_staff_user');
    if (savedToken && savedUser) {
      try {
        setToken(savedToken);
        setStaffInfo(JSON.parse(savedUser));
      } catch {
        localStorage.removeItem('court_staff_token');
      }
    }
  }, []);

  // Login form (strictly empty — never pre-fill credentials)
  const [loginIdentifier, setLoginIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [loginLoading, setLoginLoading] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  // Toast feedback (no window.alert)
  const [notice, setNotice] = useState<{ type: 'ok' | 'err'; text: string } | null>(null);

  // Venues, Courts & Price Rules
  const [venues, setVenues] = useState<StaffVenue[]>([]);
  const [courts, setCourts] = useState<StaffCourt[]>([]);
  const [priceRules, setPriceRules] = useState<(PriceRule & { venue_id?: string })[]>([]);
  const [selectedVenueId, setSelectedVenueId] = useState<string>('');

  // Shift state
  const [activeShift, setActiveShift] = useState<any>(null);
  const [openingCash, setOpeningCash] = useState('500000');
  const [closingCash, setClosingCash] = useState('');
  const [closingNote, setClosingNote] = useState('');
  const [handoverNote, setHandoverNote] = useState('');
  const [showShiftModal, setShowShiftModal] = useState(false);
  const [shiftLoading, setShiftLoading] = useState(false);

  // Bookings list & search
  const [searchQuery, setSearchQuery] = useState('');
  const [bookings, setBookings] = useState<StaffBooking[]>([]);
  const [bookingsLoading, setBookingsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [confirmNoShowId, setConfirmNoShowId] = useState<string | null>(null);

  // Payment Collection Modal
  const [selectedBookingForPay, setSelectedBookingForPay] = useState<StaffBooking | null>(null);
  const [payMethod, setPayMethod] = useState<'CASH' | 'VIETQR'>('CASH');
  const [payAmount, setPayAmount] = useState<number>(0);
  const [payLoading, setPayLoading] = useState(false);

  // Counter Walk-in Booking Modal
  const [showCounterModal, setShowCounterModal] = useState(false);
  const [counterPhone, setCounterPhone] = useState('');
  const [counterName, setCounterName] = useState('');
  const [counterCourtId, setCounterCourtId] = useState('');
  const [counterDate, setCounterDate] = useState(() => vietnamDate());
  const [counterTime, setCounterTime] = useState('18:00');
  const [counterDuration, setCounterDuration] = useState(60);
  const [collectMode, setCollectMode] = useState<'NONE' | 'DEPOSIT' | 'FULL'>('FULL');
  const [counterMethod, setCounterMethod] = useState<'CASH' | 'VIETQR'>('CASH');
  const [counterLoading, setCounterLoading] = useState(false);

  const showToast = (type: 'ok' | 'err', text: string) => {
    setNotice({ type, text });
    setTimeout(() => setNotice(curr => (curr?.text === text ? null : curr)), 4500);
  };

  const getHeaders = useCallback(
    () => ({
      'Content-Type': 'application/json',
      'Accept-Language': language,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    }),
    [language, token]
  );

  const handleLogout = useCallback(() => {
    setToken(null);
    setStaffInfo(null);
    localStorage.removeItem('court_staff_token');
    localStorage.removeItem('court_staff_user');
  }, []);

  const fetchMetadata = useCallback(async () => {
    if (!token) return;
    try {
      const [meRes, res] = await Promise.all([
        fetch(`${staffApi}/me`, { headers: getHeaders() }),
        fetch(`${staffApi}/venues`, { headers: getHeaders() }),
      ]);
      if (res.status === 401 || meRes.status === 401) {
        handleLogout();
        return;
      }
      if (meRes.ok) {
        const md = await meRes.json();
        if (md.profile) {
          setStaffInfo((prev: any) => {
            const next = { ...prev, ...md.profile };
            localStorage.setItem('court_staff_user', JSON.stringify(next));
            return next;
          });
        }
      }
      if (res.ok) {
        const data = await res.json();
        const vList: StaffVenue[] = data.venues || [];
        const cList: StaffCourt[] = data.courts || [];
        setVenues(vList);
        setCourts(cList);
        setPriceRules(data.price_rules || []);
        if (vList.length > 0) {
          setSelectedVenueId(curr => curr || vList[0].id);
        }
        if (cList.length > 0) {
          setCounterCourtId(curr => curr || cList[0].id);
        }
      }
    } catch {
      // ignore
    }
  }, [token, getHeaders, handleLogout]);

  const fetchCurrentShift = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${staffApi}/shifts/current`, { headers: getHeaders() });
      if (res.ok) {
        const data = await res.json();
        setActiveShift(data.shift);
      }
    } catch {
      // ignore
    }
  }, [token, getHeaders]);

  const fetchBookings = useCallback(async () => {
    if (!token) return;
    setBookingsLoading(true);
    try {
      const url = new URL(`${staffApi}/bookings`);
      if (selectedVenueId) url.searchParams.set('venue_id', selectedVenueId);
      if (searchQuery.trim()) url.searchParams.set('q', searchQuery.trim());
      const res = await fetch(url.toString(), { headers: getHeaders() });
      if (res.status === 401) {
        handleLogout();
        return;
      }
      if (res.ok) {
        const data = await res.json();
        setBookings(data.bookings || []);
      }
    } finally {
      setBookingsLoading(false);
    }
  }, [token, selectedVenueId, searchQuery, getHeaders, handleLogout]);

  useEffect(() => {
    if (token) {
      fetchMetadata();
      fetchCurrentShift();
    }
  }, [token, fetchMetadata, fetchCurrentShift]);

  useEffect(() => {
    if (token) {
      fetchBookings();
    }
  }, [token, fetchBookings]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoginLoading(true);
    setLoginError(null);
    try {
      const res = await fetch(`${staffApi}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept-Language': language },
        body: JSON.stringify({
          username: loginIdentifier,
          email: loginIdentifier,
          phone: loginIdentifier,
          password,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.message || 'Đăng nhập nhân viên thất bại');
      setToken(data.access_token);
      setStaffInfo(data.staff);
      localStorage.setItem('court_staff_token', data.access_token);
      localStorage.setItem('court_staff_user', JSON.stringify(data.staff));
    } catch (err: any) {
      setLoginError(err.message || 'Lỗi đăng nhập');
    } finally {
      setLoginLoading(false);
    }
  };

  const handleOpenShift = async (e: React.FormEvent) => {
    e.preventDefault();
    setShiftLoading(true);
    try {
      const vId = selectedVenueId || staffInfo?.assigned_venues?.[0];
      const res = await fetch(`${staffApi}/shifts/open`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          venue_id: vId,
          opening_cash: parseInt(openingCash, 10) || 0,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        setActiveShift(data.shift);
        setShowShiftModal(false);
        showToast('ok', 'Đã mở ca trực thành công.');
      } else {
        showToast('err', data.message || 'Không thể mở ca làm việc.');
      }
    } finally {
      setShiftLoading(false);
    }
  };

  const handleCloseShift = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeShift) return;
    setShiftLoading(true);
    try {
      const res = await fetch(`${staffApi}/shifts/close`, {
        method: 'POST',
        headers: getHeaders(),
        body: JSON.stringify({
          shift_id: activeShift.id,
          counted_cash: parseInt(closingCash, 10) || 0,
          note: closingNote,
          handover_note: handoverNote,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast(
          'ok',
          `Đóng ca thành công! Hệ thống: ${formatVnd(data.shift.expected_cash || 0)} · Thực đếm: ${formatVnd(
            data.shift.counted_cash || 0
          )} · Lệch: ${formatVnd(data.shift.variance || 0)}`
        );
        setActiveShift(null);
        setShowShiftModal(false);
        setClosingCash('');
        setClosingNote('');
        setHandoverNote('');
      } else {
        showToast('err', data.message || 'Lỗi đóng ca.');
      }
    } finally {
      setShiftLoading(false);
    }
  };

  const handleBookingAction = async (bookingId: string, endpoint: 'check-in' | 'complete' | 'no-show') => {
    setActionLoading(bookingId);
    try {
      const res = await fetch(`${staffApi}/bookings/${bookingId}/${endpoint}`, {
        method: 'POST',
        headers: getHeaders(),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('ok', data.message || 'Cập nhật thành công.');
        setConfirmNoShowId(null);
        fetchBookings();
      } else {
        showToast('err', data.message || 'Thao tác không thành công.');
      }
    } finally {
      setActionLoading(null);
    }
  };

  const handleCollectPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedBookingForPay) return;
    setPayLoading(true);
    try {
      const res = await fetch(`${staffApi}/payments`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Idempotency-Key': createIdempotencyKey('staff-pay'),
        },
        body: JSON.stringify({
          booking_id: selectedBookingForPay.id,
          shift_id: activeShift?.id || null,
          method: payMethod,
          amount: payAmount,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('ok', `Đã thu ${formatVnd(payAmount)} thành công.`);
        setSelectedBookingForPay(null);
        fetchBookings();
        fetchCurrentShift();
      } else {
        showToast('err', data.message || 'Thu tiền thất bại.');
      }
    } finally {
      setPayLoading(false);
    }
  };

  // Calculate live counter quote using shared resolvePrice
  const counterQuote = useMemo(() => {
    const c = courts.find(item => item.id === counterCourtId);
    if (!c || !counterDate || !counterTime) return 0;
    const [hh, mm] = counterTime.split(':').map(Number);
    const startMins = hh * 60 + mm;
    const vRules = priceRules.filter(r => !r.venue_id || r.venue_id === c.venue_id);
    let sum = 0;
    for (let pt = startMins; pt < startMins + counterDuration; pt += 30) {
      const tStr = `${String(Math.floor(pt / 60)).padStart(2, '0')}:${String(pt % 60).padStart(2, '0')}`;
      const p = resolvePrice(vRules, c.id, c.court_type, counterDate, tStr);
      if (p === null) return 0;
      sum += Math.round(p / 2);
    }
    return sum;
  }, [courts, counterCourtId, counterDate, counterTime, counterDuration, priceRules]);

  const handleCreateCounterBooking = async (e: React.FormEvent) => {
    e.preventDefault();
    const court = courts.find(c => c.id === counterCourtId);
    if (!court) return;
    setCounterLoading(true);
    try {
      const startDt = new Date(`${counterDate}T${counterTime}:00+07:00`);
      const endDt = new Date(startDt.getTime() + counterDuration * 60000);
      const res = await fetch(`${staffApi}/bookings`, {
        method: 'POST',
        headers: {
          ...getHeaders(),
          'Idempotency-Key': createIdempotencyKey('staff-walkin'),
        },
        body: JSON.stringify({
          venue_id: court.venue_id,
          court_id: court.id,
          start_at: startDt.toISOString(),
          end_at: endDt.toISOString(),
          customer_name: counterName,
          customer_phone: counterPhone,
          collect_mode: collectMode,
          payment_method: counterMethod,
        }),
      });
      const data = await res.json();
      if (res.ok) {
        showToast('ok', `Đã tạo lịch tại quầy (${data.booking.booking_code}) thành công!`);
        setShowCounterModal(false);
        setCounterPhone('');
        fetchBookings();
        fetchCurrentShift();
      } else {
        showToast('err', data.message || 'Không thể đặt sân tại quầy.');
      }
    } finally {
      setCounterLoading(false);
    }
  };

  const fetchIotDevices = useCallback(async () => {
    if (!token) return;
    try {
      const res = await fetch(`${staffApi}/iot/devices`, { headers: getHeaders() });
      if (res.ok) setIotDevices((await res.json()).devices || []);
    } catch {
      // ignore
    }
  }, [token, getHeaders]);

  const handleManualIot = async (deviceId: string, command: 'TURN_ON' | 'TURN_OFF') => {
    const res = await fetch(`${staffApi}/iot/devices/${deviceId}/manual`, {
      method: 'POST',
      headers: getHeaders(),
      body: JSON.stringify({ command }),
    });
    if (res.ok) {
      showToast('ok', `Đã chuyển đèn tủ quầy sang ${command === 'TURN_ON' ? 'BẬT' : 'TẮT'}.`);
      fetchIotDevices();
    }
  };

  useEffect(() => {
    if (token) fetchIotDevices();
  }, [token, fetchIotDevices]);

  const formatVnd = (amount: number) =>
    new Intl.NumberFormat('vi-VN').format(Number(amount || 0)) + ' ₫';

  const currentVenueName = venues.find(v => v.id === selectedVenueId)?.name || 'Quầy Vận Hành Cơ Sở';

  return (
    <div className="ops-shell min-h-screen bg-page text-textBody flex flex-col font-sans">
      {/* Staff Portal Header (Spec 21.2) */}
      <header className="sticky top-0 z-30 h-16 bg-accent-pressed border-b border-borderStrong px-4 sm:px-8 flex items-center justify-between text-textStrong shadow-md">
        <div className="flex items-center space-x-3">
          <div className="w-9 h-9 bg-panel rounded-token-sm flex items-center justify-center border border-accent-border">
            <Briefcase className="w-5 h-5 text-accent" />
          </div>
          <div>
            <div className="flex items-center space-x-2">
              <span className="bg-page text-accent border border-accent-border text-[11px] font-extrabold px-2 py-0.5 rounded tracking-wider uppercase">
                NHÂN VIÊN
              </span>
              <h1 className="font-extrabold text-sm sm:text-base tracking-tight text-textStrong">
                {currentVenueName}
              </h1>
            </div>
            <p className="text-xs text-textBody hidden sm:block">
              {staffInfo ? `${staffInfo.full_name} (@${staffInfo.username})` : 'Trực quầy & Vận hành ca'}
              {activeShift &&
                ` · Ca đang mở (${new Date(activeShift.opened_at).toLocaleTimeString('vi-VN', {
                  hour: '2-digit',
                  minute: '2-digit',
                })})`}
            </p>
          </div>
        </div>

        <div className="flex items-center space-x-2 sm:space-x-3">
          <button
            type="button"
            onClick={toggleLanguage}
            className="min-h-[36px] px-2.5 rounded-token-sm bg-panel hover:bg-surfaceHover border border-borderStrong text-xs font-bold text-textStrong"
          >
            <span className={language === 'vi' ? 'text-accent' : 'text-textMuted'}>VI</span>
            <span className="mx-1 text-borderStrong">|</span>
            <span className={language === 'en' ? 'text-accent' : 'text-textMuted'}>EN</span>
          </button>

          <Link
            href="/"
            className="text-xs text-textStrong px-3 py-2 rounded-token-sm bg-panel hover:bg-surfaceHover border border-borderStrong transition-colors"
          >
            ← Web Khách Hàng
          </Link>
          {token && (
            <>
              <button
                type="button"
                onClick={() => setStaffTab('PROFILE')}
                className="min-h-[36px] px-2.5 rounded-token-full bg-panel hover:bg-surfaceHover border border-borderStrong text-xs font-semibold text-textStrong flex items-center gap-1.5"
              >
                {staffInfo?.avatar_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={staffInfo.avatar_url} alt="" className="w-5 h-5 rounded-token-full object-cover" />
                ) : (
                  <User className="w-3.5 h-3.5 text-accent" />
                )}
                <span className="hidden md:inline max-w-[100px] truncate">{staffInfo?.full_name}</span>
              </button>
              <button
                onClick={handleLogout}
                type="button"
                className="text-xs text-statusDanger px-3 py-2 rounded-token-sm bg-panel hover:bg-statusDanger-soft border border-statusDanger-border flex items-center space-x-1.5 transition-colors"
              >
                <LogOut className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Đăng xuất</span>
              </button>
            </>
          )}
        </div>
      </header>

      <main className="max-w-[1200px] mx-auto p-4 sm:p-6 lg:p-8 w-full flex-1 space-y-6">
        {notice && (
          <div
            role="status"
            className={`p-4 rounded-token-md border text-sm font-medium flex items-center justify-between gap-3 ${
              notice.type === 'ok'
                ? 'bg-accent-soft border-accent-border text-accent'
                : 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
            }`}
          >
            <span>{notice.text}</span>
            <button type="button" onClick={() => setNotice(null)}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}

        {!token ? (
          <div className="stage-enter-1 max-w-4xl mx-auto mt-6 lg:mt-10 bg-panel rounded-token-lg overflow-hidden border border-borderStrong shadow-token-elevated grid grid-cols-1 lg:grid-cols-[1.08fr_1fr]">
            <LoopingPhotoCarousel
              images={DEFAULT_OPS_SLIDES}
              alt="Quầy trực sân"
              intervalMs={4600}
              className="h-44 sm:h-56 lg:h-full lg:min-h-[440px] border-b lg:border-b-0 lg:border-r border-borderToken"
              showControls={true}
              showCounter={false}
              overlayClassName="carousel-vignette-deep"
            >
              <div className="h-full flex flex-col justify-end p-5 sm:p-7 space-y-2 pointer-events-none">
                <span className="w-fit px-3 py-1 rounded-token-full bg-overlay backdrop-blur-sm border border-accent-border text-accent text-xs font-bold">
                  QUẦY TRỰC SÂN · CA THU NGÂN
                </span>
                <p className="text-lg sm:text-xl font-extrabold text-textStrong leading-snug">
                  Mở ca nhanh, check-in vé QR và điều khiển đèn sân theo thời gian thực.
                </p>
              </div>
            </LoopingPhotoCarousel>

            <div className="p-6 sm:p-8 flex flex-col justify-center space-y-6">
              <div className="space-y-2">
                <div className="w-11 h-11 bg-accent-soft text-accent rounded-token-md flex items-center justify-center border border-accent-border">
                  <Briefcase className="w-5 h-5" />
                </div>
                <h2 className="text-xl font-bold text-textStrong tracking-tight">
                  Đăng Nhập Quầy Thu Ngân
                </h2>
                <p className="text-xs text-textMuted">
                  Sử dụng tài khoản nhân viên do Chủ sân hoặc Quản lý cấp (mỗi nhân viên 1 tài khoản riêng).
                </p>
              </div>

              {loginError && (
                <div className="p-3 bg-statusDanger-soft border border-statusDanger-border text-statusDanger rounded-token-md text-xs flex items-center space-x-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  <span>{loginError}</span>
                </div>
              )}

              <form onSubmit={handleLogin} className="space-y-4 text-sm">
                <div>
                  <label className="block text-textBody mb-1.5 text-xs font-semibold">
                    Tên tài khoản hoặc Số điện thoại
                  </label>
                  <input
                    type="text"
                    value={loginIdentifier}
                    onChange={e => setLoginIdentifier(e.target.value)}
                    className="w-full min-h-[44px] px-4 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong outline-none focus:border-accent"
                    required
                  />
                </div>

                <div>
                  <label className="block text-textBody mb-1.5 text-xs font-semibold">Mật khẩu</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    className="w-full min-h-[44px] px-4 py-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong outline-none focus:border-accent"
                    required
                  />
                </div>

                <button
                  type="submit"
                  disabled={loginLoading}
                  className="w-full min-h-[46px] bg-accent hover:bg-accent-hover text-textOnAccent font-bold rounded-token-full shadow-md transition-colors disabled:opacity-50"
                >
                  {loginLoading ? 'Đang xác thực...' : 'Đăng Nhập Ca Trực'}
                </button>
              </form>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            {/* Staff Portal Navigation */}
            <div className="flex flex-wrap gap-2 border-b border-borderToken pb-3">
              <button
                type="button"
                onClick={() => setStaffTab('COUNTER')}
                className={`min-h-[42px] px-4 rounded-token-full text-xs sm:text-sm font-semibold flex items-center gap-2 border ${
                  staffTab === 'COUNTER'
                    ? 'bg-accent text-textOnAccent border-accent font-bold'
                    : 'bg-panel text-textBody border-borderToken hover:text-textStrong'
                }`}
              >
                <Calendar className="w-4 h-4" />
                <span>Ca Trực & Lịch Sân</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  setStaffTab('IOT');
                  fetchIotDevices();
                }}
                className={`min-h-[42px] px-4 rounded-token-full text-xs sm:text-sm font-semibold flex items-center gap-2 border ${
                  staffTab === 'IOT'
                    ? 'bg-accent text-textOnAccent border-accent font-bold'
                    : 'bg-panel text-textBody border-borderToken hover:text-textStrong'
                }`}
              >
                <Lightbulb className="w-4 h-4" />
                <span>
                  Tủ Đèn Sân IoT ({iotDevices.filter(d => d.last_error).length > 0 ? `${iotDevices.filter(d => d.last_error).length} Cảnh báo` : iotDevices.length})
                </span>
              </button>
              <button
                type="button"
                onClick={() => setStaffTab('PROFILE')}
                className={`min-h-[42px] px-4 rounded-token-full text-xs sm:text-sm font-semibold flex items-center gap-2 border ${
                  staffTab === 'PROFILE'
                    ? 'bg-accent text-textOnAccent border-accent font-bold'
                    : 'bg-panel text-textBody border-borderToken hover:text-textStrong'
                }`}
              >
                <User className="w-4 h-4" />
                <span>Hồ Sơ, PIN & Nghĩa Vụ</span>
              </button>
            </div>

            {staffTab === 'PROFILE' ? (
              <OperatorProfilePanel
                portal="staff"
                apiBase={staffApi}
                token={token}
                language={language}
                onProfileUpdated={(p) => {
                  const merged = { ...staffInfo, ...p };
                  setStaffInfo(merged);
                  localStorage.setItem('court_staff_user', JSON.stringify(merged));
                }}
              />
            ) : staffTab === 'IOT' ? (
              <div className="tab-panel-anim bg-panel rounded-token-lg border border-borderStrong p-6 space-y-4">
                <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-accent" />
                  <span>Điều Khiển Đèn Sân Thủ Công Tại Quầy & Cảnh Báo Lỗi Thiết Bị (IOT-03)</span>
                </h3>
                <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4 text-xs tabular-nums">
                  {iotDevices.map((d) => (
                    <div key={d.id} className="p-4 rounded-token-md bg-panel-2 border border-borderStrong space-y-3">
                      <div className="flex justify-between items-start">
                        <div>
                          <strong className="text-sm text-textStrong block">{d.device_name}</strong>
                          <span className="text-textMuted">{d.venue_name}</span>
                        </div>
                        <span
                          className={`px-2.5 py-0.5 rounded-token-full font-extrabold ${
                            d.power_state === 'ON' ? 'bg-accent text-textOnAccent' : 'bg-page text-textMuted'
                          }`}
                        >
                          {d.power_state}
                        </span>
                      </div>
                      {d.last_error && (
                        <p className="p-2 rounded bg-statusDanger-soft border border-statusDanger-border text-statusDanger font-semibold">
                          {d.last_error}
                        </p>
                      )}
                      <div className="flex gap-2">
                        <button
                          type="button"
                          onClick={() => handleManualIot(d.id, 'TURN_ON')}
                          className="flex-1 min-h-[38px] rounded-token-full bg-accent text-textOnAccent font-bold inline-flex items-center justify-center gap-1"
                        >
                          <Power className="w-3.5 h-3.5" />
                          <span>Bật tay</span>
                        </button>
                        <button
                          type="button"
                          onClick={() => handleManualIot(d.id, 'TURN_OFF')}
                          className="flex-1 min-h-[38px] rounded-token-full bg-page border border-borderStrong text-textStrong font-semibold"
                        >
                          Tắt tay
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
            <>
            {/* Shift Control Bar */}
            <div className="bg-panel p-5 rounded-token-lg border border-borderStrong flex flex-col md:flex-row md:items-center justify-between gap-4 shadow-token-card">
              <div className="flex items-start sm:items-center space-x-3">
                <span
                  className={`w-3 h-3 rounded-full shrink-0 mt-1.5 sm:mt-0 ${
                    activeShift ? 'bg-accent animate-pulse' : 'bg-statusWarning'
                  }`}
                />
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-bold text-textStrong text-base">
                      {activeShift ? 'Ca Trực Đang Mở' : 'Chưa Mở Ca Làm Việc'}
                    </span>
                    <span
                      className={`text-xs font-semibold px-2.5 py-0.5 rounded-token-full border ${
                        activeShift
                          ? 'bg-accent-soft border-accent-border text-accent'
                          : 'bg-statusWarning-soft border-statusWarning-border text-statusWarning'
                      }`}
                    >
                      {activeShift ? 'Sẵn sàng thu tiền mặt' : 'Cần mở ca trước khi thu tiền mặt'}
                    </span>
                  </div>
                  {activeShift && (
                    <div className="text-xs text-textBody mt-1.5 flex flex-wrap gap-x-4 gap-y-1 tabular-nums">
                      <span>
                        Đầu ca: <strong className="text-textStrong font-mono">{formatVnd(activeShift.opening_cash)}</strong>
                      </span>
                      <span>
                        Tiền mặt đã thu:{' '}
                        <strong className="text-accent font-mono">{formatVnd(activeShift.cash_collected || 0)}</strong>
                      </span>
                      <span>
                        Dự kiến trong két:{' '}
                        <strong className="text-textStrong font-mono">
                          {formatVnd(activeShift.expected_cash || activeShift.opening_cash)}
                        </strong>
                      </span>
                    </div>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2.5 shrink-0">
                <button
                  type="button"
                  onClick={() => setShowCounterModal(true)}
                  className="min-h-[42px] px-4 bg-accent hover:bg-accent-hover text-textOnAccent text-xs sm:text-sm font-bold rounded-token-full flex items-center gap-1.5 shadow-sm"
                >
                  <PlusCircle className="w-4 h-4" />
                  <span>Đặt Sân Tại Quầy</span>
                </button>

                {activeShift ? (
                  <button
                    type="button"
                    onClick={() => setShowShiftModal(true)}
                    className="min-h-[42px] px-4 bg-statusDanger-soft hover:opacity-90 text-statusDanger border border-statusDanger-border text-xs sm:text-sm font-bold rounded-token-full"
                  >
                    Đóng Ca & Đối Soát
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowShiftModal(true)}
                    className="min-h-[42px] px-4 bg-panel-2 hover:bg-surfaceHover text-textStrong border border-borderStrong text-xs sm:text-sm font-bold rounded-token-full"
                  >
                    Mở Ca Mới
                  </button>
                )}

                <button
                  type="button"
                  onClick={() => {
                    fetchBookings();
                    fetchCurrentShift();
                  }}
                  disabled={bookingsLoading}
                  className="min-h-[42px] min-w-[42px] bg-panel-2 hover:bg-surfaceHover text-textStrong rounded-token-md border border-borderStrong flex items-center justify-center"
                  title="Làm mới"
                >
                  <RefreshCw className={`w-4 h-4 text-accent ${bookingsLoading ? 'animate-spin' : ''}`} />
                </button>
              </div>
            </div>

            {/* Search & Venue Filter */}
            <div className="flex flex-col sm:flex-row gap-3">
              {venues.length > 1 && (
                <select
                  value={selectedVenueId}
                  onChange={e => setSelectedVenueId(e.target.value)}
                  className="min-h-[46px] px-4 bg-panel border border-borderStrong rounded-token-md text-textStrong text-sm outline-none focus:border-accent"
                >
                  {venues.map(v => (
                    <option key={v.id} value={v.id}>
                      {v.name}
                    </option>
                  ))}
                </select>
              )}
              <div className="relative flex-1">
                <Search className="absolute left-4 top-3.5 w-4 h-4 text-textMuted" />
                <input
                  type="search"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Tìm theo Mã đặt sân (DS-...), SĐT khách hàng, hoặc tên khách..."
                  className="w-full min-h-[46px] pl-11 pr-4 bg-panel border border-borderStrong rounded-token-md text-textStrong outline-none focus:border-accent text-sm"
                />
              </div>
            </div>

            {/* Bookings List */}
            <div className="bg-panel border border-borderStrong rounded-token-lg p-5 sm:p-6 space-y-4 shadow-token-card">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <h3 className="font-bold text-base text-textStrong flex items-center space-x-2">
                  <Calendar className="w-4 h-4 text-accent" />
                  <span>Lịch Đặt Sân Thực Tế ({bookings.length})</span>
                </h3>
                <span className="text-xs text-textMuted">
                  Đồng bộ trực tiếp với khách đặt online & tại quầy
                </span>
              </div>

              {bookingsLoading && bookings.length === 0 ? (
                <div className="py-12 text-center text-xs text-textMuted">
                  <RefreshCw className="w-6 h-6 animate-spin mx-auto mb-2 text-accent" />
                  <span>Đang tải danh sách đặt sân...</span>
                </div>
              ) : bookings.length === 0 ? (
                <div className="py-12 text-center text-sm text-textMuted">
                  Chưa có lịch đặt sân nào khớp bộ lọc.
                </div>
              ) : (
                <div className="space-y-3">
                  {bookings.map(b => (
                    <div
                      key={b.id}
                      className="bg-panel-2 border border-borderToken hover:border-borderStrong rounded-token-md p-4 sm:p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4"
                    >
                      <div className="space-y-1.5 min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono font-extrabold text-sm text-textStrong bg-panel px-2.5 py-0.5 rounded border border-borderStrong tabular-nums">
                            {b.booking_code}
                          </span>
                          <span
                            className={`px-2.5 py-0.5 rounded-token-full text-xs font-bold border ${
                              b.status === 'CONFIRMED'
                                ? 'bg-accent-soft border-accent-border text-accent'
                                : b.status === 'CHECKED_IN'
                                ? 'bg-accent-pressed border-accent-border text-textStrong'
                                : b.status === 'COMPLETED'
                                ? 'bg-panel border-borderStrong text-textBody'
                                : b.status === 'PENDING'
                                ? 'bg-statusWarning-soft border-statusWarning-border text-statusWarning'
                                : 'bg-statusDanger-soft border-statusDanger-border text-statusDanger'
                            }`}
                          >
                            {b.status === 'CONFIRMED'
                              ? 'Đã xác nhận'
                              : b.status === 'CHECKED_IN'
                              ? 'Đang trên sân'
                              : b.status === 'COMPLETED'
                              ? 'Hoàn tất'
                              : b.status === 'PENDING'
                              ? 'Đang giữ chỗ'
                              : b.status === 'CANCELLED'
                              ? 'Đã hủy'
                              : b.status}
                          </span>
                          {b.payment_review_reason && (
                            <span className="px-2 py-0.5 rounded text-xs font-semibold bg-statusWarning-soft text-statusWarning border border-statusWarning-border">
                              {b.payment_review_reason}
                            </span>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-textBody tabular-nums">
                          <span className="text-textStrong font-bold">{b.court_name}</span>
                          <span>·</span>
                          <span className="font-mono font-semibold text-textStrong">
                            {new Date(b.start_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} –{' '}
                            {new Date(b.end_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })}
                          </span>
                          <span>·</span>
                          <span>{new Date(b.start_at).toLocaleDateString('vi-VN')}</span>
                        </div>

                        <div className="flex flex-wrap items-center gap-4 text-xs text-textMuted">
                          <span className="flex items-center gap-1 text-textBody">
                            <User className="w-3.5 h-3.5 text-accent" />
                            <span>{b.customer_name}</span>
                          </span>
                          {b.customer_phone && (
                            <span className="flex items-center gap-1 font-mono tabular-nums">
                              <Phone className="w-3.5 h-3.5 text-statusInfo" />
                              <span>{b.customer_phone}</span>
                            </span>
                          )}
                        </div>
                      </div>

                      {/* Ledger Amounts & Actions */}
                      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4 shrink-0">
                        <div className="text-left sm:text-right text-xs space-y-0.5 tabular-nums bg-panel px-3.5 py-2.5 rounded-token-sm border border-borderToken">
                          <div>
                            Tổng sân: <strong className="text-textStrong font-mono">{formatVnd(b.total_amount)}</strong>
                          </div>
                          <div className="text-accent font-semibold">
                            Đã thu: <span className="font-mono">{formatVnd(b.paid_amount || 0)}</span>
                          </div>
                          {Number(b.due_at_venue) > 0 && !['CANCELLED', 'EXPIRED', 'NO_SHOW'].includes(b.status) && (
                            <div className="text-statusWarning font-bold">
                              Còn thu tại sân: <span className="font-mono">{formatVnd(b.due_at_venue)}</span>
                            </div>
                          )}
                        </div>

                        <div className="flex flex-wrap items-center gap-2">
                          {b.status === 'CONFIRMED' && (
                            <button
                              type="button"
                              onClick={() => handleBookingAction(b.id, 'check-in')}
                              disabled={actionLoading === b.id}
                              className="min-h-[40px] px-3.5 bg-accent hover:bg-accent-hover text-textOnAccent font-bold text-xs rounded-token-md flex items-center gap-1"
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              <span>Check-In</span>
                            </button>
                          )}

                          {Number(b.due_at_venue) > 0 && !['CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(b.status) && (
                            <button
                              type="button"
                              onClick={() => {
                                setSelectedBookingForPay(b);
                                setPayAmount(Number(b.due_at_venue));
                              }}
                              className="min-h-[40px] px-3.5 bg-accent-soft hover:bg-surfaceHover text-accent border border-accent-border text-xs font-bold rounded-token-md flex items-center gap-1"
                            >
                              <DollarSign className="w-3.5 h-3.5" />
                              <span>Thu Tiền</span>
                            </button>
                          )}

                          {b.status === 'CHECKED_IN' && Number(b.due_at_venue) === 0 && (
                            <button
                              type="button"
                              onClick={() => handleBookingAction(b.id, 'complete')}
                              disabled={actionLoading === b.id}
                              className="min-h-[40px] px-3.5 bg-panel hover:bg-surfaceHover text-textStrong border border-borderStrong text-xs font-bold rounded-token-md"
                            >
                              Hoàn tất ca
                            </button>
                          )}

                          {b.status === 'CONFIRMED' &&
                            (confirmNoShowId === b.id ? (
                              <button
                                type="button"
                                onClick={() => handleBookingAction(b.id, 'no-show')}
                                disabled={actionLoading === b.id}
                                className="min-h-[40px] px-3 bg-statusDanger text-textOnAccent font-bold text-xs rounded-token-md"
                              >
                                Xác nhận vắng?
                              </button>
                            ) : (
                              <button
                                type="button"
                                onClick={() => setConfirmNoShowId(b.id)}
                                className="min-h-[40px] px-3 bg-panel hover:bg-statusDanger-soft text-statusDanger border border-statusDanger-border text-xs rounded-token-md"
                              >
                                Vắng mặt
                              </button>
                            ))}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            </>
            )}
          </div>
        )}
      </main>

      {/* Counter Walk-in Booking Modal */}
      {showCounterModal && (
        <div className="modal-backdrop-anim fixed inset-0 z-50 bg-overlay flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="modal-panel-anim bg-panel border border-borderStrong rounded-t-token-lg sm:rounded-token-lg max-w-lg w-full p-6 space-y-4 shadow-token-elevated max-h-[92dvh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-borderToken pb-3">
              <h4 className="font-bold text-base text-textStrong">Đặt Sân Trực Tiếp Tại Quầy</h4>
              <button type="button" onClick={() => setShowCounterModal(false)} className="text-textMuted hover:text-textStrong">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCreateCounterBooking} className="space-y-4 text-sm">
              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1">Tên khách</label>
                  <input
                    type="text"
                    required
                    value={counterName}
                    onChange={e => setCounterName(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1">Số điện thoại khách</label>
                  <input
                    type="tel"
                    required
                    placeholder="0912345678"
                    value={counterPhone}
                    onChange={e => setCounterPhone(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-1">Chọn sân</label>
                <select
                  value={counterCourtId}
                  onChange={e => setCounterCourtId(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                >
                  {courts
                    .filter(c => !selectedVenueId || c.venue_id === selectedVenueId)
                    .map(c => (
                      <option key={c.id} value={c.id}>
                        {c.name} ({c.court_type})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1">Ngày chơi</label>
                  <input
                    type="date"
                    required
                    value={counterDate}
                    onChange={e => setCounterDate(e.target.value)}
                    className="w-full min-h-[44px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1">Giờ bắt đầu</label>
                  <select
                    value={counterTime}
                    onChange={e => setCounterTime(e.target.value)}
                    className="w-full min-h-[44px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  >
                    {Array.from({ length: 32 }, (_, idx) => {
                      const mins = 360 + idx * 30;
                      const label = `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
                      return (
                        <option key={label} value={label}>
                          {label}
                        </option>
                      );
                    })}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1">Thời lượng</label>
                  <select
                    value={counterDuration}
                    onChange={e => setCounterDuration(Number(e.target.value))}
                    className="w-full min-h-[44px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  >
                    <option value={60}>60 phút</option>
                    <option value={90}>90 phút</option>
                    <option value={120}>120 phút</option>
                  </select>
                </div>
              </div>

              <div className="grid sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1">Thu tiền ngay</label>
                  <select
                    value={collectMode}
                    onChange={e => setCollectMode(e.target.value as any)}
                    className="w-full min-h-[44px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  >
                    <option value="FULL">Thu đủ 100%</option>
                    <option value="DEPOSIT">Thu cọc 30%</option>
                    <option value="NONE">Thu sau khi chơi xong</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1">Hình thức</label>
                  <select
                    value={counterMethod}
                    onChange={e => setCounterMethod(e.target.value as any)}
                    disabled={collectMode === 'NONE'}
                    className="w-full min-h-[44px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong disabled:opacity-40"
                  >
                    <option value="CASH">Tiền mặt tại quầy</option>
                    <option value="VIETQR">Chuyển khoản QR</option>
                  </select>
                </div>
              </div>

              <div className="p-3.5 rounded-token-md bg-panel-2 border border-borderToken flex items-center justify-between tabular-nums">
                <span className="text-xs text-textMuted">Giá tính tự động theo bảng giá chung:</span>
                <span className="text-lg font-extrabold text-accent font-mono">{formatVnd(counterQuote)}</span>
              </div>

              <button
                type="submit"
                disabled={counterLoading || counterQuote <= 0}
                className="w-full min-h-[46px] bg-accent hover:bg-accent-hover text-textOnAccent font-bold rounded-token-full shadow-md disabled:opacity-50"
              >
                {counterLoading ? 'Đang ghi nhận...' : 'Tạo Lịch Đặt Sân Tại Quầy'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* Open/Close Shift Modal */}
      {showShiftModal && (
        <div className="modal-backdrop-anim fixed inset-0 z-50 bg-overlay flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="modal-panel-anim bg-panel border border-borderStrong rounded-t-token-lg sm:rounded-token-lg max-w-md w-full p-6 space-y-5 shadow-token-elevated">
            <div className="flex items-center justify-between border-b border-borderToken pb-3">
              <h4 className="font-bold text-base text-textStrong">
                {activeShift ? 'Đóng Ca & Đối Soát Tiền Mặt' : 'Mở Ca Làm Việc Mới'}
              </h4>
              <button type="button" onClick={() => setShowShiftModal(false)} className="text-textMuted hover:text-textStrong">
                <X className="w-5 h-5" />
              </button>
            </div>

            {!activeShift ? (
              <form onSubmit={handleOpenShift} className="space-y-4 text-sm">
                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5">
                    Tiền mặt đầu ca trong két (VND)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={openingCash}
                    onChange={e => setOpeningCash(e.target.value)}
                    className="w-full min-h-[44px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong font-mono"
                    required
                  />
                </div>
                <button
                  type="submit"
                  disabled={shiftLoading}
                  className="w-full min-h-[46px] bg-accent hover:bg-accent-hover text-textOnAccent font-bold rounded-token-full"
                >
                  {shiftLoading ? 'Đang mở ca...' : 'Xác Nhận Mở Ca'}
                </button>
              </form>
            ) : (
              <form onSubmit={handleCloseShift} className="space-y-4 text-sm">
                <div className="p-3.5 bg-panel-2 rounded-token-md border border-borderToken text-xs space-y-1 tabular-nums">
                  <div>
                    Tiền đầu ca: <strong className="text-textStrong font-mono">{formatVnd(activeShift.opening_cash)}</strong>
                  </div>
                  <div>
                    Tiền mặt thu trong ca:{' '}
                    <strong className="text-accent font-mono">{formatVnd(activeShift.cash_collected || 0)}</strong>
                  </div>
                  <div>
                    Tổng hệ thống tính:{' '}
                    <strong className="text-textStrong font-mono">
                      {formatVnd(activeShift.expected_cash || activeShift.opening_cash)}
                    </strong>
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5">
                    Tiền mặt đếm thực tế (VND)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={closingCash}
                    onChange={e => setClosingCash(e.target.value)}
                    className="w-full min-h-[44px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong font-mono"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5">
                    Giải trình chênh lệch (bắt buộc nếu lệch két)
                  </label>
                  <input
                    type="text"
                    value={closingNote}
                    onChange={e => setClosingNote(e.target.value)}
                    className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-textMuted mb-1.5">
                    Ghi chú bàn giao ca sau
                  </label>
                  <textarea
                    value={handoverNote}
                    onChange={e => setHandoverNote(e.target.value)}
                    className="w-full p-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong h-20 resize-none"
                  />
                </div>

                <button
                  type="submit"
                  disabled={shiftLoading}
                  className="w-full min-h-[46px] bg-statusDanger text-textOnAccent font-bold rounded-token-full"
                >
                  {shiftLoading ? 'Đang đóng ca...' : 'Xác Nhận Đóng Ca'}
                </button>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Counter Payment Collection Modal */}
      {selectedBookingForPay && (
        <div className="modal-backdrop-anim fixed inset-0 z-50 bg-overlay flex items-end sm:items-center justify-center p-0 sm:p-4">
          <div className="modal-panel-anim bg-panel border border-borderStrong rounded-t-token-lg sm:rounded-token-lg max-w-md w-full p-6 space-y-5 shadow-token-elevated">
            <div className="flex items-center justify-between border-b border-borderToken pb-3">
              <h4 className="font-bold text-base text-textStrong">Thu Tiền Tại Quầy</h4>
              <button
                type="button"
                onClick={() => setSelectedBookingForPay(null)}
                className="text-textMuted hover:text-textStrong"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-3.5 bg-panel-2 rounded-token-md border border-borderToken text-xs space-y-1 tabular-nums">
              <div>
                Mã đặt sân: <span className="font-mono font-bold text-textStrong">{selectedBookingForPay.booking_code}</span>
              </div>
              <div>
                Khách hàng: <span className="text-textStrong">{selectedBookingForPay.customer_name}</span>
              </div>
              <div>
                Còn phải thu:{' '}
                <strong className="text-statusWarning font-mono text-sm">
                  {formatVnd(selectedBookingForPay.due_at_venue)}
                </strong>
              </div>
            </div>

            <form onSubmit={handleCollectPayment} className="space-y-4 text-sm">
              <div className="grid grid-cols-2 gap-3">
                {(['CASH', 'VIETQR'] as const).map(m => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => setPayMethod(m)}
                    className={`min-h-[44px] rounded-token-md border font-semibold ${
                      payMethod === m
                        ? 'bg-accent-soft border-accent text-accent'
                        : 'bg-panel-2 border-borderToken text-textBody'
                    }`}
                  >
                    {m === 'CASH' ? 'Tiền Mặt (CASH)' : 'Chuyển Khoản QR'}
                  </button>
                ))}
              </div>

              <div>
                <label className="block text-xs font-semibold text-textMuted mb-1.5">Số tiền thu (VND)</label>
                <input
                  type="number"
                  min={1000}
                  max={selectedBookingForPay.due_at_venue}
                  value={payAmount}
                  onChange={e => setPayAmount(parseInt(e.target.value, 10) || 0)}
                  className="w-full min-h-[44px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong font-mono"
                  required
                />
              </div>

              <button
                type="submit"
                disabled={payLoading || payAmount <= 0}
                className="w-full min-h-[46px] bg-accent hover:bg-accent-hover text-textOnAccent font-bold rounded-token-full disabled:opacity-50"
              >
                {payLoading ? 'Đang lưu...' : `Xác Nhận Thu ${formatVnd(payAmount)}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

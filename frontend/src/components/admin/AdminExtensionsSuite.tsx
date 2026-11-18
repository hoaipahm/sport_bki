'use client';

import React, { useState, useEffect, useCallback } from 'react';
import {
  Wand2,
  FileSpreadsheet,
  Tag,
  Megaphone,
  CloudRain,
  Trophy,
  Lightbulb,
  Sliders,
  History,
  Plus,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Download,
  Send,
  Power,
  QrCode,
} from 'lucide-react';
import { adminApi } from '../../lib/api';

interface AdminExtensionsSuiteProps {
  token: string;
  language: 'vi' | 'en';
  venues: any[];
  courts: any[];
  initialModule?: string;
  onNotify: (ok: boolean, msg: string) => void;
  onRefreshVenuesAndCourts: () => void;
}

export function AdminExtensionsSuite({
  token,
  language,
  venues,
  courts,
  initialModule = 'CONFIG_PRICING',
  onNotify,
  onRefreshVenuesAndCourts,
}: AdminExtensionsSuiteProps) {
  const isEn = language === 'en';
  const [subTab, setSubTab] = useState(initialModule);

  useEffect(() => {
    if (initialModule) setSubTab(initialModule);
  }, [initialModule]);

  const headers = useCallback(
    () => ({
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      'Accept-Language': language,
    }),
    [token, language]
  );

  const selectedDefaultVenue = venues[0]?.id || '';

  // =========================================================================
  // 1. P1 VENUE HOURS, POLICIES & PRICE RULES STATE
  // =========================================================================
  const [cfgVenueId, setCfgVenueId] = useState(selectedDefaultVenue);
  const [openingHours, setOpeningHours] = useState<any[]>([]);
  const [priceRules, setPriceRules] = useState<any[]>([]);
  const [sports, setSports] = useState<any[]>([]);
  const [depPercent, setDepPercent] = useState(30);
  const [holdMins, setHoldMins] = useState(10);
  const [policyVi, setPolicyVi] = useState('');
  const [policyEn, setPolicyEn] = useState('');
  const [venueLat, setVenueLat] = useState('');
  const [venueLng, setVenueLng] = useState('');
  const [venueNameEdit, setVenueNameEdit] = useState('');
  const [venueStatusEdit, setVenueStatusEdit] = useState<'PUBLISHED' | 'DRAFT'>('PUBLISHED');

  // New court & price rule forms
  const [newCourtName, setNewCourtName] = useState('');
  const [newCourtType, setNewCourtType] = useState('5-a-side');
  const [newCourtSportId, setNewCourtSportId] = useState('');
  const [prCourtType, setPrCourtType] = useState('5-a-side');
  const [prStart, setPrStart] = useState('17:00');
  const [prEnd, setPrEnd] = useState('21:00');
  const [prPrice, setPrPrice] = useState('400000');
  const [prPeak, setPrPeak] = useState(true);
  const [prWeekend, setPrWeekend] = useState(false);
  const [editPriceInputs, setEditPriceInputs] = useState<Record<string, string>>({});

  // =========================================================================
  // 2. A-25 SETUP WIZARD STATE
  // =========================================================================
  const [wizVenueId, setWizVenueId] = useState('');
  const [wizState, setWizState] = useState<any>(null);
  const [wizStep, setWizStep] = useState(1);
  const [wizName, setWizName] = useState('');
  const [wizAddr, setWizAddr] = useState('');
  const [wizPhone, setWizPhone] = useState('');
  const [wizSport, setWizSport] = useState('pickleball');
  const [wizCourtCount, setWizCourtCount] = useState(3);
  const [wizOffpeak, setWizOffpeak] = useState(160000);
  const [wizPeak, setWizPeak] = useState(240000);
  const [wizPreset, setWizPreset] = useState<'FLEXIBLE' | 'MODERATE' | 'STRICT'>('MODERATE');

  // =========================================================================
  // 3. A-26 CSV IMPORT STATE
  // =========================================================================
  const [impVenueId, setImpVenueId] = useState(selectedDefaultVenue);
  const [csvText, setCsvText] = useState('');
  const [impJob, setImpJob] = useState<any>(null);
  const [impPreview, setImpPreview] = useState<any[]>([]);
  const [impBusy, setImpBusy] = useState(false);

  // =========================================================================
  // 4. A-27 DEALS STATE
  // =========================================================================
  const [deals, setDeals] = useState<any[]>([]);
  const [dealVenueId, setDealVenueId] = useState(selectedDefaultVenue);
  const [dealTitleVi, setDealTitleVi] = useState('');
  const [dealKind, setDealKind] = useState<'OFFPEAK' | 'LAST_MINUTE'>('OFFPEAK');
  const [dealFrom, setDealFrom] = useState('09:00');
  const [dealTo, setDealTo] = useState('15:00');
  const [dealVal, setDealVal] = useState(20);
  const [dealFloor, setDealFloor] = useState(140000);

  // =========================================================================
  // 5. A-29 CAMPAIGNS STATE
  // =========================================================================
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [optedInTotal, setOptedInTotal] = useState(0);
  const [campName, setCampName] = useState('');
  const [campSeg, setCampSeg] = useState('ALL_OPTED_IN');
  const [campSubjVi, setCampSubjVi] = useState('');
  const [campBodyVi, setCampBodyVi] = useState('');
  const [campPreviewCnt, setCampPreviewCnt] = useState<number | null>(null);

  // =========================================================================
  // 6. A-30 WEATHER / RAIN CLOSURE STATE
  // =========================================================================
  const [outdoorCourts, setOutdoorCourts] = useState<any[]>([]);
  const [weatherJobs, setWeatherJobs] = useState<any[]>([]);
  const [rainCourtIds, setRainCourtIds] = useState<string[]>([]);
  const [rainStart, setRainStart] = useState('');
  const [rainEnd, setRainEnd] = useState('');
  const [rainReason, setRainReason] = useState('Mưa lớn ngập sân ngoài trời');
  const [rainMode, setRainMode] = useState<'REFUND' | 'CREDIT_RESCHEDULE'>('REFUND');
  const [rainPreview, setRainPreview] = useState<any>(null);

  // =========================================================================
  // 7. A-31 TOURNAMENTS STATE
  // =========================================================================
  const [tournaments, setTournaments] = useState<any[]>([]);
  const [trnVenueId, setTrnVenueId] = useState(selectedDefaultVenue);
  const [trnNameVi, setTrnNameVi] = useState('');
  const [trnFormat, setTrnFormat] = useState<'ROUND_ROBIN' | 'KNOCKOUT'>('ROUND_ROBIN');
  const [newTeamName, setNewTeamName] = useState('');
  const [scoreInputs, setScoreInputs] = useState<Record<string, { h: string; a: string }>>({});

  // =========================================================================
  // 8. A-33 IOT & A-13 AUDIT LOGS STATE
  // =========================================================================
  const [iotDevices, setIotDevices] = useState<any[]>([]);
  const [iotLogs, setIotLogs] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);

  useEffect(() => {
    if (venues.length > 0) {
      setCfgVenueId((c) => c || venues[0].id);
      setImpVenueId((c) => c || venues[0].id);
      setDealVenueId((c) => c || venues[0].id);
      setTrnVenueId((c) => c || venues[0].id);
    }
  }, [venues]);

  useEffect(() => {
    const tmr = new Date(Date.now() + 86400000);
    tmr.setHours(17, 0, 0, 0);
    const tmrEnd = new Date(tmr);
    tmrEnd.setHours(21, 0, 0, 0);
    const pad = (n: number) => String(n).padStart(2, '0');
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
    setRainStart(fmt(tmr));
    setRainEnd(fmt(tmrEnd));
  }, []);

  const loadConfigModule = useCallback(async () => {
    if (!cfgVenueId) return;
    const [cfgRes, prRes, spRes] = await Promise.all([
      fetch(`${adminApi}/venues/${cfgVenueId}/config`, { headers: headers() }),
      fetch(`${adminApi}/price-rules`, { headers: headers() }),
      fetch(`${adminApi}/sports`, { headers: headers() }),
    ]);
    if (cfgRes.ok) {
      const d = await cfgRes.json();
      setOpeningHours(d.opening_hours || []);
      setVenueNameEdit(d.venue?.name || '');
      setVenueStatusEdit(d.venue?.status === 'DRAFT' ? 'DRAFT' : 'PUBLISHED');
      setVenueLat(d.venue?.latitude != null ? String(d.venue.latitude) : '');
      setVenueLng(d.venue?.longitude != null ? String(d.venue.longitude) : '');
      if (d.policy) {
        setDepPercent(d.policy.deposit_percent ?? 30);
        setHoldMins(d.policy.hold_duration_mins ?? 10);
        setPolicyVi(d.policy.policy_i18n?.vi || '');
        setPolicyEn(d.policy.policy_i18n?.en || '');
      }
    }
    if (prRes.ok) setPriceRules((await prRes.json()).price_rules || []);
    if (spRes.ok) {
      const sList = (await spRes.json()).sports || [];
      setSports(sList);
      if (sList[0]) setNewCourtSportId((c) => c || sList[0].id);
    }
  }, [cfgVenueId, headers]);

  const loadSubModuleData = useCallback(async () => {
    if (subTab === 'CONFIG_PRICING') await loadConfigModule();
    if (subTab === 'DEALS') {
      const r = await fetch(`${adminApi}/deals`, { headers: headers() });
      if (r.ok) setDeals((await r.json()).deals || []);
    }
    if (subTab === 'CAMPAIGNS') {
      const r = await fetch(`${adminApi}/campaigns`, { headers: headers() });
      if (r.ok) {
        const d = await r.json();
        setCampaigns(d.campaigns || []);
        setOptedInTotal(d.opted_in_total || 0);
      }
    }
    if (subTab === 'WEATHER') {
      const r = await fetch(`${adminApi}/weather/outdoor-courts`, { headers: headers() });
      if (r.ok) {
        const d = await r.json();
        setOutdoorCourts(d.outdoor_courts || []);
        setWeatherJobs(d.jobs || []);
        if (d.outdoor_courts?.length > 0 && rainCourtIds.length === 0) {
          setRainCourtIds([d.outdoor_courts[0].id]);
        }
      }
    }
    if (subTab === 'TOURNAMENTS') {
      const r = await fetch(`${adminApi}/tournaments`, { headers: headers() });
      if (r.ok) setTournaments((await r.json()).tournaments || []);
    }
    if (subTab === 'IOT') {
      const r = await fetch(`${adminApi}/iot/devices`, { headers: headers() });
      if (r.ok) {
        const d = await r.json();
        setIotDevices(d.devices || []);
        setIotLogs(d.recent_commands || []);
      }
    }
    if (subTab === 'AUDIT') {
      const r = await fetch(`${adminApi}/audit-logs`, { headers: headers() });
      if (r.ok) setAuditLogs((await r.json()).logs || []);
    }
  }, [subTab, headers, loadConfigModule, rainCourtIds.length]);

  useEffect(() => {
    void loadSubModuleData();
  }, [loadSubModuleData]);

  const formatVnd = (v: number) => new Intl.NumberFormat('vi-VN').format(Number(v || 0)) + ' ₫';

  // --- Handlers ---
  const saveVenueGeoAndMeta = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/venues/${cfgVenueId}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        name: venueNameEdit,
        latitude: venueLat,
        longitude: venueLng,
        status: venueStatusEdit,
      }),
    });
    if (res.ok) {
      onNotify(true, 'Đã cập nhật thông tin, tọa độ bản đồ & slug SEO cơ sở.');
      onRefreshVenuesAndCourts();
    }
  };

  const saveOpeningHours = async () => {
    const res = await fetch(`${adminApi}/venues/${cfgVenueId}/opening-hours`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ opening_hours: openingHours }),
    });
    if (res.ok) onNotify(true, 'Đã lưu giờ mở cửa các ngày trong tuần.');
  };

  const savePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/venues/${cfgVenueId}/policies`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({
        deposit_percent: depPercent,
        hold_duration_mins: holdMins,
        policy_vi: policyVi,
        policy_en: policyEn,
      }),
    });
    if (res.ok) onNotify(true, 'Đã lưu chính sách đặt cọc & hoàn hủy.');
  };

  const createCourt = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/courts`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        venue_id: cfgVenueId,
        sport_id: newCourtSportId,
        name: newCourtName,
        court_type: newCourtType,
      }),
    });
    if (res.ok) {
      setNewCourtName('');
      onNotify(true, 'Đã thêm sân mới thành công.');
      onRefreshVenuesAndCourts();
    }
  };

  const createPriceRule = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/price-rules`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        venue_id: cfgVenueId,
        court_type: prCourtType,
        start_time: prStart,
        end_time: prEnd,
        price_per_hour: Number(prPrice),
        is_peak_hour: prPeak,
        is_weekend: prWeekend,
      }),
    });
    if (res.ok) {
      onNotify(true, 'Đã thêm khung giá mới.');
      loadConfigModule();
    }
  };

  const deletePriceRule = async (id: string) => {
    await fetch(`${adminApi}/price-rules/${id}`, { method: 'DELETE', headers: headers() });
    loadConfigModule();
  };

  const updatePriceRule = async (id: string, currentPrice: number) => {
    const val = Number(editPriceInputs[id] ?? currentPrice);
    if (!val || val <= 0) return;
    const res = await fetch(`${adminApi}/price-rules/${id}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify({ price_per_hour: val }),
    });
    if (res.ok) {
      onNotify(true, 'Đã cập nhật đơn giá mới.');
      loadConfigModule();
      onRefreshVenuesAndCourts();
    }
  };

  const deleteCourtById = async (court: any) => {
    if (!window.confirm(`Xóa sân "${court.name}" khỏi cơ sở?`)) return;
    const res = await fetch(`${adminApi}/courts/${court.id}`, { method: 'DELETE', headers: headers() });
    const d = await res.json();
    if (res.ok) {
      onNotify(true, `Đã xóa sân "${court.name}".`);
      onRefreshVenuesAndCourts();
    } else {
      onNotify(false, d.message || 'Không thể xóa sân.');
    }
  };

  const deleteCurrentVenue = async () => {
    const v = venues.find((x) => x.id === cfgVenueId);
    if (!v) return;
    if (!window.confirm(`Xóa hoàn toàn cơ sở "${v.name}" cùng toàn bộ các sân trực thuộc?`)) return;
    const res = await fetch(`${adminApi}/venues/${v.id}`, { method: 'DELETE', headers: headers() });
    const d = await res.json();
    if (res.ok) {
      onNotify(true, `Đã xóa cơ sở "${v.name}".`);
      setCfgVenueId('');
      onRefreshVenuesAndCourts();
    } else {
      onNotify(false, d.message || 'Không thể xóa cơ sở.');
    }
  };

  // Wizard handlers
  const startNewWizardVenue = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/wizard/venues`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ name: wizName, address: wizAddr, phone: wizPhone }),
    });
    const d = await res.json();
    if (res.ok) {
      setWizVenueId(d.venue.id);
      setWizStep(2);
      onRefreshVenuesAndCourts();
      const sRes = await fetch(`${adminApi}/wizard/${d.venue.id}`, { headers: headers() });
      if (sRes.ok) setWizState(await sRes.json());
      onNotify(true, 'Bước 1 hoàn tất — Cơ sở đang ở trạng thái DRAFT riêng tư.');
    }
  };

  const submitWizardStep = async (step: number, skip = false) => {
    if (!wizVenueId) return;
    const payload: any = { skip };
    if (step === 2) Object.assign(payload, { sport_code: wizSport, court_type: `${wizSport}-standard`, court_count: wizCourtCount });
    if (step === 3) Object.assign(payload, { court_type: `${wizSport}-standard`, offpeak_price: wizOffpeak, peak_price: wizPeak, weekend_price: wizPeak });
    if (step === 4) Object.assign(payload, { preset: wizPreset, deposit_percent: 30 });

    const res = await fetch(`${adminApi}/wizard/${wizVenueId}/step/${step}`, {
      method: 'PUT',
      headers: headers(),
      body: JSON.stringify(payload),
    });
    const d = await res.json();
    if (res.ok) {
      const sRes = await fetch(`${adminApi}/wizard/${wizVenueId}`, { headers: headers() });
      if (sRes.ok) setWizState(await sRes.json());
      setWizStep(Math.min(7, step + 1));
      onRefreshVenuesAndCourts();
      onNotify(true, `Đã lưu tiến trình Bước ${step} (${skip ? 'Bỏ qua' : 'Hoàn tất'}).`);
    } else {
      onNotify(false, d.message || 'Chưa thể chuyển bước');
    }
  };

  // CSV Import handlers
  const handleCsvFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const txt = await file.text();
    setCsvText(txt);
  };

  const runImportDryRun = async () => {
    setImpBusy(true);
    try {
      const res = await fetch(`${adminApi}/imports`, {
        method: 'POST',
        headers: headers(),
        body: JSON.stringify({ venue_id: impVenueId, csv_content: csvText }),
      });
      const d = await res.json();
      if (res.ok) {
        setImpJob(d.job);
        setImpPreview(d.preview_rows || []);
        onNotify(true, d.already_imported ? 'File này đã được nhập trước đó (Idempotent).' : 'Đã chạy thử (Dry-run) kiểm tra trùng lịch.');
      } else {
        onNotify(false, d.message || 'Lỗi đọc file CSV');
      }
    } finally {
      setImpBusy(false);
    }
  };

  const confirmImport = async () => {
    if (!impJob) return;
    setImpBusy(true);
    try {
      const res = await fetch(`${adminApi}/imports/${impJob.id}/confirm`, {
        method: 'POST',
        headers: headers(),
      });
      const d = await res.json();
      if (res.ok) {
        setImpJob(d.job);
        onNotify(true, `Đã nhập thành công ${d.imported_rows} bản ghi vào hệ thống!`);
      } else {
        onNotify(false, d.message || 'Không thể xác nhận nhập');
      }
    } finally {
      setImpBusy(false);
    }
  };

  const downloadSampleCsv = async () => {
    const res = await fetch(`${adminApi}/imports/sample.csv`, { headers: { Authorization: `Bearer ${token}` } });
    if (!res.ok) return;
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'mau-nhap-khach-va-lich-dat.csv';
    a.click();
    URL.revokeObjectURL(url);
  };

  // Deals handlers
  const createDeal = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/deals`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        venue_id: dealVenueId,
        title_vi: dealTitleVi,
        title_en: dealTitleVi,
        kind: dealKind,
        time_from: dealFrom,
        time_to: dealTo,
        discount_type: 'PERCENT',
        discount_value: dealVal,
        floor_price_vnd: dealFloor,
        activate_immediately: true,
      }),
    });
    if (res.ok) {
      setDealTitleVi('');
      onNotify(true, 'Đã tạo và kích hoạt ưu đãi giờ trống.');
      loadSubModuleData();
    }
  };

  const toggleDealStatus = async (id: string, status: string) => {
    await fetch(`${adminApi}/deals/${id}/status`, {
      method: 'PATCH',
      headers: headers(),
      body: JSON.stringify({ status }),
    });
    loadSubModuleData();
  };

  const generateDraftSuggestion = async () => {
    const res = await fetch(`${adminApi}/deals/generate-suggestions`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ venue_id: dealVenueId }),
    });
    if (res.ok) {
      onNotify(true, 'Đã tạo đề xuất ưu đãi ở trạng thái NHÁP (chờ chủ sân duyệt).');
      loadSubModuleData();
    }
  };

  // Campaign handlers
  const previewCampaign = async () => {
    const res = await fetch(`${adminApi}/campaigns/preview`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ segment_type: campSeg }),
    });
    if (res.ok) {
      const d = await res.json();
      setCampPreviewCnt(d.recipient_count);
    }
  };

  const createAndQueueCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/campaigns`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        name: campName,
        segment_type: campSeg,
        subject_vi: campSubjVi,
        body_vi: campBodyVi,
      }),
    });
    if (res.ok) {
      setCampName('');
      setCampSubjVi('');
      setCampBodyVi('');
      onNotify(true, 'Đã tạo chiến dịch. Bấm Gửi ngay hoặc Hủy trước khi gửi.');
      loadSubModuleData();
    }
  };

  const sendCampaignNow = async (id: string) => {
    const res = await fetch(`${adminApi}/campaigns/${id}/send`, { method: 'POST', headers: headers() });
    if (res.ok) {
      const d = await res.json();
      onNotify(true, `Đã đưa vào hàng đợi gửi cho ${d.sent_count} khách hàng đã opt-in.`);
      loadSubModuleData();
    }
  };

  const cancelCampaign = async (id: string) => {
    await fetch(`${adminApi}/campaigns/${id}/cancel`, { method: 'POST', headers: headers() });
    loadSubModuleData();
  };

  // Weather closure handlers
  const previewWeatherClosure = async () => {
    if (rainCourtIds.length === 0) return;
    const vId = outdoorCourts.find((c) => c.id === rainCourtIds[0])?.venue_id || venues[0]?.id;
    const res = await fetch(`${adminApi}/weather/preview`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        venue_id: vId,
        court_ids: rainCourtIds,
        start_at: new Date(rainStart).toISOString(),
        end_at: new Date(rainEnd).toISOString(),
      }),
    });
    if (res.ok) setRainPreview(await res.json());
  };

  const executeWeatherClosure = async () => {
    if (rainCourtIds.length === 0) return;
    const vId = outdoorCourts.find((c) => c.id === rainCourtIds[0])?.venue_id || venues[0]?.id;
    const res = await fetch(`${adminApi}/weather/execute`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({
        venue_id: vId,
        court_ids: rainCourtIds,
        start_at: new Date(rainStart).toISOString(),
        end_at: new Date(rainEnd).toISOString(),
        resolution_mode: rainMode,
        reason: rainReason,
      }),
    });
    if (res.ok) {
      setRainPreview(null);
      onNotify(true, 'Đã đóng sân ngoài trời, tạo cảnh báo khách hàng và xử lý các đơn ảnh hưởng!');
      loadSubModuleData();
    }
  };

  // Tournament handlers
  const createTournament = async (e: React.FormEvent) => {
    e.preventDefault();
    const res = await fetch(`${adminApi}/tournaments`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ venue_id: trnVenueId, name_vi: trnNameVi, name_en: trnNameVi, format: trnFormat }),
    });
    if (res.ok) {
      setTrnNameVi('');
      onNotify(true, 'Đã tạo giải đấu mới.');
      loadSubModuleData();
    }
  };

  const addTeamToTournament = async (trnId: string) => {
    if (!newTeamName.trim()) return;
    const res = await fetch(`${adminApi}/tournaments/${trnId}/teams`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ team_name: newTeamName.trim() }),
    });
    if (res.ok) {
      setNewTeamName('');
      loadSubModuleData();
    }
  };

  const generateMatches = async (trnId: string) => {
    const res = await fetch(`${adminApi}/tournaments/${trnId}/generate-matches`, {
      method: 'POST',
      headers: headers(),
    });
    if (res.ok) {
      onNotify(true, 'Đã sinh cặp đấu tự động.');
      loadSubModuleData();
    }
  };

  const saveMatchScore = async (trnId: string, matchId: string) => {
    const inp = scoreInputs[matchId] || { h: '0', a: '0' };
    const res = await fetch(`${adminApi}/tournaments/${trnId}/matches/${matchId}/score`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ home_score: Number(inp.h), away_score: Number(inp.a) }),
    });
    if (res.ok) {
      onNotify(true, 'Đã cập nhật tỷ số, tính lại bảng xếp hạng & ghi Audit Log.');
      loadSubModuleData();
    }
  };

  // IoT command handler
  const sendIotCommand = async (devId: string, command: 'TURN_ON' | 'TURN_OFF', simulateUnreachable = false) => {
    const res = await fetch(`${adminApi}/iot/devices/${devId}/command`, {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ command, control_mode: 'MANUAL_OVERRIDE', simulate_unreachable: simulateUnreachable }),
    });
    const d = await res.json();
    if (res.ok) {
      onNotify(true, `Đã gửi lệnh ${command} tới tủ đèn sân.`);
    } else {
      onNotify(false, d.message || 'Thiết bị mất kết nối');
    }
    loadSubModuleData();
  };

  const navItems = [
    { id: 'CONFIG_PRICING', icon: Sliders, label: isEn ? 'Courts, Hours & Pricing' : 'Sân, Giờ Mở & Bảng Giá' },
    { id: 'WIZARD', icon: Wand2, label: 'Setup Wizard (A-25)' },
    { id: 'IMPORT', icon: FileSpreadsheet, label: 'Import CSV (A-26)' },
    { id: 'DEALS', icon: Tag, label: isEn ? 'Deals (A-27)' : 'Ưu Đãi Giờ Trống (A-27)' },
    { id: 'CAMPAIGNS', icon: Megaphone, label: 'Marketing (A-29)' },
    { id: 'WEATHER', icon: CloudRain, label: isEn ? 'Rain Policy (A-30)' : 'Chính Sách Mưa (A-30)' },
    { id: 'TOURNAMENTS', icon: Trophy, label: isEn ? 'Tournaments (A-31)' : 'Giải Đấu (A-31)' },
    { id: 'IOT', icon: Lightbulb, label: isEn ? 'Smart Lights IoT (A-33)' : 'Đèn & Cửa IoT (A-33)' },
    { id: 'AUDIT', icon: History, label: 'Audit Log (A-13)' },
  ];

  return (
    <div className="space-y-6">
      {/* Sub-module Pills */}
      <div className="flex flex-wrap gap-2 bg-panel p-3 rounded-token-lg border border-borderStrong">
        {navItems.map((it) => {
          const Icon = it.icon;
          const active = subTab === it.id;
          return (
            <button
              key={it.id}
              type="button"
              onClick={() => setSubTab(it.id)}
              className={`min-h-[38px] px-3.5 rounded-token-full text-xs font-semibold inline-flex items-center gap-1.5 border ${
                active
                  ? 'bg-accent text-textOnAccent border-accent font-bold'
                  : 'bg-panel-2 text-textBody border-borderToken hover:text-textStrong hover:bg-surfaceHover'
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span>{it.label}</span>
            </button>
          );
        })}
      </div>

      {/* 1. P1 COURTS, HOURS, POLICIES & PRICING */}
      {subTab === 'CONFIG_PRICING' && (
        <div className="tab-panel-anim space-y-6">
          <div className="bg-panel p-5 rounded-token-lg border border-borderStrong flex flex-wrap items-center justify-between gap-3">
            <label htmlFor="cfg-venue-select" className="text-sm font-bold text-textStrong">
              {isEn ? 'Configure Venue:' : 'Chọn cơ sở cấu hình:'}
            </label>
            <div className="flex flex-wrap items-center gap-2">
              <select
                id="cfg-venue-select"
                value={cfgVenueId}
                onChange={(e) => setCfgVenueId(e.target.value)}
                className="min-h-[42px] px-4 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name} ({v.status || 'PUBLISHED'})
                  </option>
                ))}
              </select>
              {cfgVenueId && (
                <button
                  type="button"
                  onClick={deleteCurrentVenue}
                  className="min-h-[42px] px-3.5 rounded-token-md bg-statusDanger-soft border border-statusDanger-border text-statusDanger text-xs font-bold inline-flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" />
                  <span>Xóa Cơ Sở Này</span>
                </button>
              )}
            </div>
          </div>

          <div className="grid lg:grid-cols-2 gap-6">
            {/* Venue SEO, Status & Map Coordinates */}
            <form onSubmit={saveVenueGeoAndMeta} className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4">
              <h3 className="font-bold text-base text-textStrong">
                {isEn ? 'Venue Identity, SEO Status & Map Coordinates' : 'Định Danh Cơ Sở, Trạng Thái Xuất Bản & Tọa Độ Bản Đồ'}
              </h3>
              <div>
                <label htmlFor="v-name-edit" className="block text-xs text-textMuted mb-1">
                  Tên cơ sở (Đổi tên tự động lưu lịch sử slug 301 SEO-02)
                </label>
                <input
                  id="v-name-edit"
                  type="text"
                  value={venueNameEdit}
                  onChange={(e) => setVenueNameEdit(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                />
              </div>
              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label htmlFor="v-lat" className="block text-xs text-textMuted mb-1">Latitude</label>
                  <input
                    id="v-lat"
                    type="text"
                    value={venueLat}
                    onChange={(e) => setVenueLat(e.target.value)}
                    className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="v-lng" className="block text-xs text-textMuted mb-1">Longitude</label>
                  <input
                    id="v-lng"
                    type="text"
                    value={venueLng}
                    onChange={(e) => setVenueLng(e.target.value)}
                    className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs font-mono"
                  />
                </div>
                <div>
                  <label htmlFor="v-stat" className="block text-xs text-textMuted mb-1">Trạng thái</label>
                  <select
                    id="v-stat"
                    value={venueStatusEdit}
                    onChange={(e) => setVenueStatusEdit(e.target.value as any)}
                    className="w-full min-h-[42px] px-2 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
                  >
                    <option value="PUBLISHED">PUBLISHED</option>
                    <option value="DRAFT">DRAFT (Ẩn)</option>
                  </select>
                </div>
              </div>
              <button type="submit" className="w-full min-h-[42px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs">
                Lưu Thông Tin & Tọa Độ Cơ Sở
              </button>
            </form>

            {/* Deposit & Cancellation Policy */}
            <form onSubmit={savePolicy} className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4">
              <h3 className="font-bold text-base text-textStrong">Chính Sách Đặt Cọc & Hoàn Hủy (A-05)</h3>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label htmlFor="pol-dep" className="block text-xs text-textMuted mb-1">Tỷ lệ đặt cọc (%)</label>
                  <input
                    id="pol-dep"
                    type="number"
                    min={0}
                    max={100}
                    value={depPercent}
                    onChange={(e) => setDepPercent(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm tabular-nums"
                  />
                </div>
                <div>
                  <label htmlFor="pol-hold" className="block text-xs text-textMuted mb-1">Thời gian giữ chỗ (phút)</label>
                  <input
                    id="pol-hold"
                    type="number"
                    min={5}
                    max={60}
                    value={holdMins}
                    onChange={(e) => setHoldMins(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm tabular-nums"
                  />
                </div>
              </div>
              <div>
                <label htmlFor="pol-vi" className="block text-xs text-textMuted mb-1">Mô tả chính sách (Tiếng Việt)</label>
                <input
                  id="pol-vi"
                  type="text"
                  value={policyVi}
                  onChange={(e) => setPolicyVi(e.target.value)}
                  className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
                />
              </div>
              <button type="submit" className="w-full min-h-[42px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs">
                Lưu Chính Sách Cơ Sở
              </button>
            </form>
          </div>

          {/* Opening Hours Editor (A-03) */}
          <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="font-bold text-base text-textStrong">Giờ Mở Cửa Theo Thứ (A-03)</h3>
              <button
                type="button"
                onClick={saveOpeningHours}
                className="min-h-[38px] px-4 rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
              >
                Lưu Giờ Mở Cửa
              </button>
            </div>
            <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs tabular-nums">
              {openingHours.map((h, idx) => (
                <div key={h.day_of_week} className="p-3 rounded-token-md bg-panel-2 border border-borderToken space-y-2">
                  <div className="flex items-center justify-between">
                    <strong className="text-textStrong">
                      {h.day_of_week === 0 ? 'Chủ Nhật' : `Thứ ${h.day_of_week + 1}`}
                    </strong>
                    <label className="inline-flex items-center gap-1 cursor-pointer text-textMuted">
                      <input
                        type="checkbox"
                        checked={Boolean(h.is_closed)}
                        onChange={(e) => {
                          const next = [...openingHours];
                          next[idx] = { ...next[idx], is_closed: e.target.checked };
                          setOpeningHours(next);
                        }}
                        className="accent-[var(--accent)]"
                      />
                      <span>Đóng</span>
                    </label>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <input
                      type="time"
                      value={String(h.open_time || '06:00').slice(0, 5)}
                      onChange={(e) => {
                        const next = [...openingHours];
                        next[idx] = { ...next[idx], open_time: e.target.value };
                        setOpeningHours(next);
                      }}
                      className="w-full px-2 py-1.5 bg-page border border-borderStrong rounded text-textStrong"
                    />
                    <span>–</span>
                    <input
                      type="time"
                      value={String(h.close_time || '22:30').slice(0, 5)}
                      onChange={(e) => {
                        const next = [...openingHours];
                        next[idx] = { ...next[idx], close_time: e.target.value };
                        setOpeningHours(next);
                      }}
                      className="w-full px-2 py-1.5 bg-page border border-borderStrong rounded text-textStrong"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Add Court & Price Rules Table (A-01, A-04) */}
          <div className="grid lg:grid-cols-[1fr_1.4fr] gap-6">
            <form onSubmit={createCourt} className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-3.5">
              <h3 className="font-bold text-base text-textStrong">Thêm Sân Thi Đấu Mới (A-01)</h3>
              <div>
                <label htmlFor="nc-sport" className="block text-xs text-textMuted mb-1">Môn thể thao</label>
                <select
                  id="nc-sport"
                  value={newCourtSportId}
                  onChange={(e) => setNewCourtSportId(e.target.value)}
                  className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                >
                  {sports.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name_i18n?.vi || s.code}
                    </option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-2.5">
                <div>
                  <label htmlFor="nc-name" className="block text-xs text-textMuted mb-1">Tên sân</label>
                  <input
                    id="nc-name"
                    type="text"
                    required
                    value={newCourtName}
                    onChange={(e) => setNewCourtName(e.target.value)}
                    className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                  />
                </div>
                <div>
                  <label htmlFor="nc-type" className="block text-xs text-textMuted mb-1">Loại sân (court_type)</label>
                  <input
                    id="nc-type"
                    type="text"
                    required
                    value={newCourtType}
                    onChange={(e) => setNewCourtType(e.target.value)}
                    className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
                  />
                </div>
              </div>
              <button type="submit" className="w-full min-h-[42px] rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-textStrong font-bold text-xs flex items-center justify-center gap-1.5">
                <Plus className="w-4 h-4 text-accent" />
                <span>Tạo Sân Mới</span>
              </button>

              <div className="pt-3 border-t border-borderToken space-y-1.5 max-h-[165px] overflow-y-auto text-xs">
                <p className="font-bold text-textMuted">Các sân thuộc cơ sở ({courts.filter((c) => c.venue_id === cfgVenueId).length}):</p>
                {courts
                  .filter((c) => c.venue_id === cfgVenueId)
                  .map((c) => (
                    <div key={c.id} className="p-2 rounded bg-panel-2 border border-borderToken flex items-center justify-between gap-2">
                      <span className="text-textStrong font-semibold truncate">
                        {c.name} <span className="text-textMuted font-normal">({c.court_type})</span>
                      </span>
                      <button
                        type="button"
                        onClick={() => deleteCourtById(c)}
                        title="Xóa sân"
                        className="text-textMuted hover:text-statusDanger p-1 shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
              </div>
            </form>

            <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4">
              <h3 className="font-bold text-base text-textStrong">Bảng Giá Theo Khung Giờ & Giờ Vàng (A-04)</h3>
              <form onSubmit={createPriceRule} className="grid sm:grid-cols-5 gap-2 items-end text-xs">
                <input
                  type="text"
                  value={prCourtType}
                  onChange={(e) => setPrCourtType(e.target.value)}
                  aria-label="Loại sân"
                  className="min-h-[38px] px-2.5 bg-panel-2 border border-borderStrong rounded text-textStrong"
                />
                <input
                  type="time"
                  value={prStart}
                  onChange={(e) => setPrStart(e.target.value)}
                  aria-label="Bắt đầu"
                  className="min-h-[38px] px-2 bg-panel-2 border border-borderStrong rounded text-textStrong"
                />
                <input
                  type="time"
                  value={prEnd}
                  onChange={(e) => setPrEnd(e.target.value)}
                  aria-label="Kết thúc"
                  className="min-h-[38px] px-2 bg-panel-2 border border-borderStrong rounded text-textStrong"
                />
                <input
                  type="number"
                  value={prPrice}
                  onChange={(e) => setPrPrice(e.target.value)}
                  aria-label="Giá / giờ"
                  className="min-h-[38px] px-2.5 bg-panel-2 border border-borderStrong rounded text-textStrong font-mono"
                />
                <button type="submit" className="min-h-[38px] px-3 rounded bg-accent text-textOnAccent font-bold">
                  + Thêm Giá
                </button>
              </form>
              <div className="flex gap-4 text-xs">
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={prPeak} onChange={(e) => setPrPeak(e.target.checked)} className="accent-[var(--accent)]" />
                  <span>Giờ vàng</span>
                </label>
                <label className="inline-flex items-center gap-1.5 cursor-pointer">
                  <input type="checkbox" checked={prWeekend} onChange={(e) => setPrWeekend(e.target.checked)} className="accent-[var(--accent)]" />
                  <span>Cuối tuần</span>
                </label>
              </div>

              <div className="max-h-[210px] overflow-y-auto space-y-1.5 pr-1 text-xs tabular-nums">
                {priceRules
                  .filter((r) => !cfgVenueId || r.venue_id === cfgVenueId)
                  .map((r) => (
                    <div key={r.id} className="p-2.5 rounded bg-panel-2 border border-borderToken flex items-center justify-between gap-2">
                      <div>
                        <strong className="text-textStrong">{r.court_type}</strong> ·{' '}
                        <span>
                          {String(r.start_time).slice(0, 5)}–{String(r.end_time).slice(0, 5)}
                        </span>
                        {r.is_weekend && <span className="ml-1.5 text-statusInfo">[Cuối tuần]</span>}
                        {r.is_peak_hour && <span className="ml-1.5 text-statusWarning">[Giờ vàng]</span>}
                      </div>
                      <div className="flex items-center gap-1.5">
                        <input
                          type="number"
                          aria-label="Sửa đơn giá"
                          value={editPriceInputs[r.id] ?? String(r.price_per_hour)}
                          onChange={(e) =>
                            setEditPriceInputs((prev) => ({ ...prev, [r.id]: e.target.value }))
                          }
                          className="w-28 min-h-[32px] px-2 bg-page border border-borderStrong rounded text-accent font-bold text-right"
                        />
                        <span className="text-textMuted">₫/h</span>
                        <button
                          type="button"
                          onClick={() => updatePriceRule(r.id, Number(r.price_per_hour))}
                          className="px-2 py-1 rounded bg-accent-soft text-accent border border-accent-border font-bold"
                        >
                          Lưu
                        </button>
                        <button
                          type="button"
                          onClick={() => deletePriceRule(r.id)}
                          aria-label="Xóa khung giá"
                          className="text-textMuted hover:text-statusDanger p-1"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 2. A-25 SETUP WIZARD */}
      {subTab === 'WIZARD' && (
        <div className="tab-panel-anim bg-panel rounded-token-lg border border-borderStrong p-6 sm:p-8 space-y-6">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-lg text-textStrong">Trình Hướng Dẫn Khởi Tạo Cơ Sở 7 Bước (A-25)</h3>
              <p className="text-xs text-textMuted mt-1">
                Cơ sở mới giữ trạng thái DRAFT riêng tư cho tới khi hoàn tất Bước 1–3 và bấm Xuất bản ở Bước 6.
              </p>
            </div>
            {wizVenueId && (
              <span className="px-3 py-1 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold">
                Đang thiết lập Bước {wizStep}/7
              </span>
            )}
          </div>

          {!wizVenueId ? (
            <form onSubmit={startNewWizardVenue} className="max-w-lg space-y-4">
              <div>
                <label htmlFor="wz-name" className="block text-xs text-textBody mb-1">Bước 1: Tên cơ sở mới (Bắt buộc)</label>
                <input
                  id="wz-name"
                  type="text"
                  required
                  value={wizName}
                  onChange={(e) => setWizName(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                />
              </div>
              <div>
                <label htmlFor="wz-addr" className="block text-xs text-textBody mb-1">Địa chỉ chi tiết</label>
                <input
                  id="wz-addr"
                  type="text"
                  required
                  value={wizAddr}
                  onChange={(e) => setWizAddr(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                />
              </div>
              <div>
                <label htmlFor="wz-phone" className="block text-xs text-textBody mb-1">Số điện thoại hotline</label>
                <input
                  id="wz-phone"
                  type="tel"
                  required
                  value={wizPhone}
                  onChange={(e) => setWizPhone(e.target.value)}
                  className="w-full min-h-[44px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong"
                />
              </div>
              <button type="submit" className="min-h-[46px] px-6 rounded-token-full bg-accent text-textOnAccent font-bold text-sm">
                Lưu Bước 1 & Chuyển Sang Bước 2 →
              </button>
            </form>
          ) : (
            <div className="space-y-5">
              <div className="flex flex-wrap gap-2">
                {[1, 2, 3, 4, 5, 6, 7].map((s) => (
                  <button
                    key={s}
                    type="button"
                    onClick={() => setWizStep(s)}
                    className={`min-h-[36px] px-3 rounded-token-full text-xs font-bold border ${
                      wizStep === s
                        ? 'bg-accent text-textOnAccent border-accent'
                        : 'bg-panel-2 text-textBody border-borderToken'
                    }`}
                  >
                    Bước {s}
                  </button>
                ))}
              </div>

              {wizStep === 2 && (
                <div className="max-w-md space-y-3 bg-panel-2 p-5 rounded-token-md border border-borderToken">
                  <h4 className="font-bold text-textStrong">Bước 2: Chọn Môn & Số Lượng Sân (Bắt buộc)</h4>
                  <select
                    value={wizSport}
                    onChange={(e) => setWizSport(e.target.value)}
                    className="w-full min-h-[42px] px-3 bg-page border border-borderStrong rounded text-textStrong text-sm"
                  >
                    <option value="pickleball">Pickleball</option>
                    <option value="badminton">Cầu lông</option>
                    <option value="football">Bóng đá mini</option>
                  </select>
                  <input
                    type="number"
                    min={1}
                    max={12}
                    value={wizCourtCount}
                    onChange={(e) => setWizCourtCount(Number(e.target.value))}
                    className="w-full min-h-[42px] px-3 bg-page border border-borderStrong rounded text-textStrong text-sm"
                  />
                  <button
                    type="button"
                    onClick={() => submitWizardStep(2, false)}
                    className="w-full min-h-[42px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
                  >
                    Tạo Sân & Sang Bước 3
                  </button>
                </div>
              )}

              {wizStep === 3 && (
                <div className="max-w-md space-y-3 bg-panel-2 p-5 rounded-token-md border border-borderToken">
                  <h4 className="font-bold text-textStrong">Bước 3: Mẫu Giá Đề Xuất (Gợi ý — sửa tùy ý, Bắt buộc)</h4>
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div>
                      <label className="block text-textMuted mb-1">Giờ thường (VND/h)</label>
                      <input
                        type="number"
                        value={wizOffpeak}
                        onChange={(e) => setWizOffpeak(Number(e.target.value))}
                        className="w-full min-h-[40px] px-3 bg-page border border-borderStrong rounded text-textStrong font-mono"
                      />
                    </div>
                    <div>
                      <label className="block text-textMuted mb-1">Giờ vàng 17–21h (VND/h)</label>
                      <input
                        type="number"
                        value={wizPeak}
                        onChange={(e) => setWizPeak(Number(e.target.value))}
                        className="w-full min-h-[40px] px-3 bg-page border border-borderStrong rounded text-textStrong font-mono"
                      />
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => submitWizardStep(3, false)}
                    className="w-full min-h-[42px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
                  >
                    Áp Dụng Bảng Giá & Sang Bước 4
                  </button>
                </div>
              )}

              {wizStep === 4 && (
                <div className="max-w-md space-y-3 bg-panel-2 p-5 rounded-token-md border border-borderToken">
                  <h4 className="font-bold text-textStrong">Bước 4: Mẫu Chính Sách Hoàn Cọc (Gợi ý đề xuất)</h4>
                  <select
                    value={wizPreset}
                    onChange={(e) => setWizPreset(e.target.value as any)}
                    className="w-full min-h-[42px] px-3 bg-page border border-borderStrong rounded text-textStrong text-sm"
                  >
                    <option value="FLEXIBLE">Linh hoạt (Hủy trước 12h hoàn 100%)</option>
                    <option value="MODERATE">Cân bằng (Hủy trước 24h hoàn 100%, 12h hoàn 50%)</option>
                    <option value="STRICT">Chặt chẽ (Hủy trước 48h hoàn 100%)</option>
                  </select>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => submitWizardStep(4, false)}
                      className="flex-1 min-h-[42px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
                    >
                      Lưu Chính Sách
                    </button>
                    <button
                      type="button"
                      onClick={() => submitWizardStep(4, true)}
                      className="min-h-[42px] px-4 rounded-token-full bg-panel border border-borderStrong text-xs"
                    >
                      Bỏ qua, làm sau
                    </button>
                  </div>
                </div>
              )}

              {wizStep === 5 && (
                <div className="max-w-md space-y-3 bg-panel-2 p-5 rounded-token-md border border-borderToken">
                  <h4 className="font-bold text-textStrong">Bước 5: Tài Khoản Nhận Tiền VietQR</h4>
                  <p className="text-xs text-textBody">
                    Bạn có thể thiết lập chi tiết tại tab VietQR hoặc bấm Bỏ qua để mở đặt tại quầy trước (SET-02).
                  </p>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      onClick={() => submitWizardStep(5, false)}
                      className="flex-1 min-h-[42px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
                    >
                      Xác nhận & Tiếp tục
                    </button>
                    <button
                      type="button"
                      onClick={() => submitWizardStep(5, true)}
                      className="min-h-[42px] px-4 rounded-token-full bg-panel border border-borderStrong text-xs"
                    >
                      Bỏ qua, làm sau
                    </button>
                  </div>
                </div>
              )}

              {wizStep >= 6 && (
                <div className="max-w-xl space-y-4 bg-panel-2 p-6 rounded-token-md border border-borderStrong">
                  <h4 className="font-bold text-base text-textStrong flex items-center gap-2">
                    <QrCode className="w-5 h-5 text-accent" />
                    <span>Bước 6 & 7: Xuất Bản Cơ Sở & Link Đặt Sân Dán Tại Sân (A-10)</span>
                  </h4>
                  {wizState?.counter_only_warning && (
                    <div className="p-3 rounded bg-statusWarning-soft border border-statusWarning-border text-statusWarning text-xs">
                      Lưu ý: Chưa bật tài khoản ngân hàng nhận tiền thật — khách hiện đặt ở chế độ Sandbox / Tại quầy.
                    </div>
                  )}
                  {wizState?.booking_link && (
                    <code className="block p-3 rounded bg-page text-accent font-mono text-xs break-all">
                      {wizState.booking_link}
                    </code>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      onClick={() => submitWizardStep(6, false)}
                      className="min-h-[42px] px-5 rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
                    >
                      Xuất Bản Cơ Sở Lên Trang Công Khai
                    </button>
                    <button
                      type="button"
                      onClick={() => setWizVenueId('')}
                      className="min-h-[42px] px-4 rounded-token-full bg-panel border border-borderStrong text-xs"
                    >
                      Hoàn tất Wizard
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 3. A-26 CSV / EXCEL IMPORT */}
      {subTab === 'IMPORT' && (
        <div className="tab-panel-anim bg-panel rounded-token-lg border border-borderStrong p-6 space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="font-bold text-lg text-textStrong">Nhập Dữ Liệu Khách Hàng & Lịch Sắp Tới Từ CSV (A-26)</h3>
              <p className="text-xs text-textMuted mt-1">
                Tự động chuẩn hóa & gộp SĐT trùng, chống công thức độc hại CSV Injection, kiểm tra trùng lịch qua Booking Core trước khi lưu.
              </p>
            </div>
            <button
              type="button"
              onClick={downloadSampleCsv}
              className="min-h-[38px] px-4 rounded-token-full bg-panel-2 border border-borderStrong text-xs font-bold text-accent inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Tải File CSV Mẫu (UTF-8)</span>
            </button>
          </div>

          <div className="grid sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs text-textMuted mb-1">Cơ sở nhập lịch</label>
              <select
                value={impVenueId}
                onChange={(e) => setImpVenueId(e.target.value)}
                className="w-full min-h-[42px] px-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-textMuted mb-1">Chọn tệp .CSV từ máy</label>
              <input
                type="file"
                accept=".csv,text/csv"
                onChange={handleCsvFileSelect}
                className="w-full text-xs text-textBody file:mr-3 file:py-2 file:px-4 file:rounded-token-full file:border-0 file:bg-accent-soft file:text-accent file:font-bold"
              />
            </div>
          </div>

          <textarea
            rows={5}
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            aria-label="Nội dung CSV"
            className="w-full p-3.5 bg-panel-2 border border-borderStrong rounded-token-md text-xs font-mono text-textStrong"
          />

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              disabled={!csvText.trim() || impBusy}
              onClick={runImportDryRun}
              className="min-h-[42px] px-5 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-textStrong font-bold text-xs disabled:opacity-50"
            >
              1. Chạy Thử & Kiểm Tra Trùng Lịch (Dry-Run)
            </button>

            {impJob && impJob.status === 'DRY_RUN' && impJob.ok_rows > 0 && (
              <button
                type="button"
                disabled={impBusy}
                onClick={confirmImport}
                className="min-h-[42px] px-5 rounded-token-full bg-accent text-textOnAccent font-bold text-xs"
              >
                2. Xác Nhận Ghi {impJob.ok_rows} Dòng Hợp Lệ Vào Hệ Thống
              </button>
            )}
          </div>

          {impJob && (
            <div className="p-4 rounded-token-md bg-panel-2 border border-borderToken space-y-3 text-xs tabular-nums">
              <div className="flex flex-wrap gap-4 font-bold">
                <span>Tổng dòng: {impJob.total_rows}</span>
                <span className="text-accent">Hợp lệ: {impJob.ok_rows}</span>
                <span className="text-statusWarning">Trùng lịch: {impJob.conflict_rows}</span>
                <span className="text-statusDanger">Lỗi dữ liệu: {impJob.error_rows}</span>
                <span>Trạng thái: {impJob.status}</span>
              </div>

              {impPreview.length > 0 && (
                <div className="max-h-[200px] overflow-y-auto space-y-1.5">
                  {impPreview.map((r) => (
                    <div key={r.row_no} className="p-2 rounded bg-page flex items-center justify-between gap-2">
                      <span>
                        Dòng #{r.row_no}: <strong>{r.payload_json?.full_name}</strong> ({r.payload_json?.phone_e164 || r.payload_json?.phone})
                        {r.payload_json?.court_name ? ` · ${r.payload_json.court_name}` : ''}
                      </span>
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          r.status === 'OK' || r.status === 'IMPORTED'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-statusDanger-soft text-statusDanger'
                        }`}
                      >
                        {r.status} {r.error_code ? `(${r.error_code})` : ''}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* 4. A-27 OFF-PEAK & LAST-MINUTE DEALS */}
      {subTab === 'DEALS' && (
        <div className="tab-panel-anim grid lg:grid-cols-[1fr_1.35fr] gap-6">
          <form onSubmit={createDeal} className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-3.5">
            <h3 className="font-bold text-base text-textStrong">Tạo Quy Tắc Ưu Đãi Giờ Vắng / Phút Chót (A-27)</h3>
            <select
              value={dealVenueId}
              onChange={(e) => setDealVenueId(e.target.value)}
              className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
            >
              {venues.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </select>
            <div>
              <label className="block text-xs text-textMuted mb-1">Tên chương trình ưu đãi</label>
              <input
                type="text"
                required
                value={dealTitleVi}
                onChange={(e) => setDealTitleVi(e.target.value)}
                className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
              />
            </div>
            <div className="grid grid-cols-3 gap-2 text-xs">
              <select
                value={dealKind}
                onChange={(e) => setDealKind(e.target.value as any)}
                className="min-h-[40px] px-2 bg-panel-2 border border-borderStrong rounded text-textStrong"
              >
                <option value="OFFPEAK">OFFPEAK</option>
                <option value="LAST_MINUTE">LAST_MINUTE</option>
              </select>
              <input
                type="time"
                value={dealFrom}
                onChange={(e) => setDealFrom(e.target.value)}
                className="min-h-[40px] px-2 bg-panel-2 border border-borderStrong rounded text-textStrong"
              />
              <input
                type="time"
                value={dealTo}
                onChange={(e) => setDealTo(e.target.value)}
                className="min-h-[40px] px-2 bg-panel-2 border border-borderStrong rounded text-textStrong"
              />
            </div>
            <div className="grid grid-cols-2 gap-2.5 text-xs">
              <div>
                <label className="block text-textMuted mb-1">Giảm (%)</label>
                <input
                  type="number"
                  min={5}
                  max={70}
                  value={dealVal}
                  onChange={(e) => setDealVal(Number(e.target.value))}
                  className="w-full min-h-[40px] px-3 bg-panel-2 border border-borderStrong rounded text-textStrong font-mono"
                />
              </div>
              <div>
                <label className="block text-textMuted mb-1">Giá sàn bảo vệ (VND/h)</label>
                <input
                  type="number"
                  value={dealFloor}
                  onChange={(e) => setDealFloor(Number(e.target.value))}
                  className="w-full min-h-[40px] px-3 bg-panel-2 border border-borderStrong rounded text-textStrong font-mono"
                />
              </div>
            </div>
            <button type="submit" className="w-full min-h-[44px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs">
              Duyệt & Bật Ưu Đãi Ngay
            </button>
            <button
              type="button"
              onClick={generateDraftSuggestion}
              className="w-full min-h-[40px] rounded-token-full bg-panel-2 border border-borderStrong text-textStrong text-xs font-semibold"
            >
              Quét Khung Giờ &lt;30% & Sinh Gợi Ý Nháp (DEAL-06)
            </button>
          </form>

          <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-3">
            <h3 className="font-bold text-base text-textStrong">Danh Sách Quy Tắc Ưu Đãi ({deals.length})</h3>
            <div className="space-y-2.5 max-h-[380px] overflow-y-auto pr-1 text-xs tabular-nums">
              {deals.map((d) => (
                <div key={d.id} className="p-3.5 rounded-token-md bg-panel-2 border border-borderToken flex items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2">
                      <strong className="text-textStrong text-sm">{d.title_vi}</strong>
                      <span
                        className={`px-2 py-0.5 rounded font-bold ${
                          d.status === 'ACTIVE'
                            ? 'bg-accent-soft text-accent'
                            : 'bg-statusWarning-soft text-statusWarning'
                        }`}
                      >
                        {d.status}
                      </span>
                    </div>
                    <p className="text-textMuted">
                      {d.venue_name} · {d.kind} · {String(d.time_from).slice(0, 5)}–{String(d.time_to).slice(0, 5)} · Giảm{' '}
                      {d.discount_value}% (Sàn: {formatVnd(d.floor_price_vnd)})
                    </p>
                  </div>
                  {d.status !== 'ACTIVE' ? (
                    <button
                      type="button"
                      onClick={() => toggleDealStatus(d.id, 'ACTIVE')}
                      className="min-h-[36px] px-3 rounded-token-full bg-accent text-textOnAccent font-bold shrink-0"
                    >
                      Chủ sân Duyệt
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => toggleDealStatus(d.id, 'PAUSED')}
                      className="min-h-[36px] px-3 rounded-token-full bg-panel border border-borderStrong text-textBody shrink-0"
                    >
                      Tạm dừng
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 5. A-29 SEGMENTED CAMPAIGNS */}
      {subTab === 'CAMPAIGNS' && (
        <div className="tab-panel-anim grid lg:grid-cols-2 gap-6">
          <form onSubmit={createAndQueueCampaign} className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-3.5">
            <h3 className="font-bold text-base text-textStrong">Chiến Dịch Email Theo Nhóm Khách Đã Opt-in (A-29)</h3>
            <p className="text-xs text-textMuted">
              Tổng khách đã đồng ý nhận tin (marketing_opt_in): <strong className="text-accent">{optedInTotal}</strong> · Giới hạn tối đa 1 tin/tuần/khách.
            </p>
            <div>
              <label className="block text-xs text-textMuted mb-1">Tên chiến dịch</label>
              <input
                type="text"
                required
                value={campName}
                onChange={(e) => setCampName(e.target.value)}
                className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
              />
            </div>
            <div className="flex gap-2">
              <select
                value={campSeg}
                onChange={(e) => setCampSeg(e.target.value)}
                className="flex-1 min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
              >
                <option value="ALL_OPTED_IN">Tất cả khách đã đồng ý nhận tin</option>
                <option value="CHURN_RISK">Khách có nguy cơ rời bỏ (≥3 lần, vắng 45 ngày)</option>
                <option value="WEEKEND_PLAYERS">Nhóm khách hay chơi cuối tuần</option>
              </select>
              <button
                type="button"
                onClick={previewCampaign}
                className="min-h-[42px] px-3.5 rounded-token-md bg-panel-2 border border-borderStrong text-accent text-xs font-bold"
              >
                Đếm người nhận
              </button>
            </div>
            {campPreviewCnt !== null && (
              <p className="text-xs text-accent font-bold">Số người nhận hợp lệ dự kiến: {campPreviewCnt} người</p>
            )}
            <div>
              <label className="block text-xs text-textMuted mb-1">Tiêu đề Email</label>
              <input
                type="text"
                required
                value={campSubjVi}
                onChange={(e) => setCampSubjVi(e.target.value)}
                className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-sm"
              />
            </div>
            <div>
              <label className="block text-xs text-textMuted mb-1">Nội dung tin ưu đãi (kèm link hủy nhận tin tự động)</label>
              <textarea
                rows={3}
                required
                value={campBodyVi}
                onChange={(e) => setCampBodyVi(e.target.value)}
                className="w-full p-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
              />
            </div>
            <button type="submit" className="w-full min-h-[44px] rounded-token-full bg-accent text-textOnAccent font-bold text-xs">
              Lưu Bản Nháp Chiến Dịch
            </button>
          </form>

          <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-3">
            <h3 className="font-bold text-base text-textStrong">Lịch Sử Chiến Dịch ({campaigns.length})</h3>
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto text-xs tabular-nums">
              {campaigns.map((c) => (
                <div key={c.id} className="p-3.5 rounded-token-md bg-panel-2 border border-borderToken flex items-center justify-between gap-3">
                  <div>
                    <strong className="text-textStrong text-sm">{c.name}</strong>
                    <p className="text-textMuted mt-0.5">
                      {c.segment_type} · Trạng thái: <strong className="text-accent">{c.status}</strong> · Đã gửi: {c.sent_count}
                    </p>
                  </div>
                  {c.status === 'DRAFT' || c.status === 'SCHEDULED' ? (
                    <div className="flex gap-1.5 shrink-0">
                      <button
                        type="button"
                        onClick={() => sendCampaignNow(c.id)}
                        className="min-h-[34px] px-3 rounded-token-full bg-accent text-textOnAccent font-bold inline-flex items-center gap-1"
                      >
                        <Send className="w-3 h-3" />
                        <span>Gửi</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => cancelCampaign(c.id)}
                        className="min-h-[34px] px-2.5 rounded-token-full bg-statusDanger-soft text-statusDanger font-bold"
                      >
                        Hủy
                      </button>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 6. A-30 WEATHER / RAIN POLICY */}
      {subTab === 'WEATHER' && (
        <div className="tab-panel-anim grid lg:grid-cols-2 gap-6">
          <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4">
            <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
              <CloudRain className="w-5 h-5 text-statusWarning" />
              <span>Đóng Sân Ngoài Trời Hàng Loạt Do Thời Tiết (A-30)</span>
            </h3>
            <p className="text-xs text-textMuted">
              Chỉ liệt kê các sân ngoài trời (is_outdoor = true). Các sân trong nhà không bị ảnh hưởng (RAIN-07).
            </p>

            <div className="space-y-1.5 max-h-[140px] overflow-y-auto p-3 rounded-token-md bg-panel-2 border border-borderToken text-xs">
              {outdoorCourts.map((c) => (
                <label key={c.id} className="flex items-center gap-2.5 cursor-pointer py-1">
                  <input
                    type="checkbox"
                    checked={rainCourtIds.includes(c.id)}
                    onChange={(e) =>
                      setRainCourtIds((prev) =>
                        e.target.checked ? [...prev, c.id] : prev.filter((x) => x !== c.id)
                      )
                    }
                    className="accent-[var(--accent)]"
                  />
                  <span className="font-semibold text-textStrong">{c.name}</span>
                  <span className="text-textMuted">({c.venue_name})</span>
                </label>
              ))}
            </div>

            <div className="grid sm:grid-cols-2 gap-3 text-xs">
              <div>
                <label className="block text-textMuted mb-1">Từ thời điểm</label>
                <input
                  type="datetime-local"
                  value={rainStart}
                  onChange={(e) => setRainStart(e.target.value)}
                  className="w-full min-h-[40px] px-3 bg-panel-2 border border-borderStrong rounded text-textStrong"
                />
              </div>
              <div>
                <label className="block text-textMuted mb-1">Đến thời điểm</label>
                <input
                  type="datetime-local"
                  value={rainEnd}
                  onChange={(e) => setRainEnd(e.target.value)}
                  className="w-full min-h-[40px] px-3 bg-panel-2 border border-borderStrong rounded text-textStrong"
                />
              </div>
            </div>

            <select
              value={rainMode}
              onChange={(e) => setRainMode(e.target.value as any)}
              className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
            >
              <option value="REFUND">Hoàn 100% tiền cọc đã nhận qua hàng đợi hoàn tiền (A-09)</option>
              <option value="CREDIT_RESCHEDULE">Bảo lưu cọc & cho khách tự chọn giờ mới trong 14 ngày</option>
            </select>

            <input
              type="text"
              value={rainReason}
              onChange={(e) => setRainReason(e.target.value)}
              aria-label="Lý do thời tiết"
              className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
            />

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={previewWeatherClosure}
                className="min-h-[42px] px-4 rounded-token-full bg-panel-2 border border-borderStrong text-textStrong font-bold text-xs"
              >
                Xem Trước Đơn Bị Ảnh Hưởng
              </button>
              <button
                type="button"
                onClick={executeWeatherClosure}
                className="min-h-[42px] px-5 rounded-token-full bg-statusWarning text-textOnAccent font-extrabold text-xs"
              >
                Xác Nhận Đóng Sân & Thông Báo Khách
              </button>
            </div>

            {rainPreview && (
              <div className="p-3.5 rounded-token-md bg-statusWarning-soft border border-statusWarning-border text-xs space-y-1 tabular-nums">
                <p className="font-bold text-statusWarning">
                  Số booking bị ảnh hưởng: {rainPreview.affected_count} · Tổng cọc đã thu:{' '}
                  {formatVnd(rainPreview.total_paid_deposit_vnd)}
                </p>
              </div>
            )}
          </div>

          <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-3">
            <h3 className="font-bold text-base text-textStrong">Lịch Sử Đóng Sân Do Thời Tiết ({weatherJobs.length})</h3>
            <div className="space-y-2.5 max-h-[360px] overflow-y-auto text-xs tabular-nums">
              {weatherJobs.map((j) => (
                <div key={j.id} className="p-3.5 rounded-token-md bg-panel-2 border border-borderToken space-y-1">
                  <div className="flex justify-between">
                    <strong className="text-textStrong">{j.venue_name}</strong>
                    <span className="text-accent font-bold">{j.status}</span>
                  </div>
                  <p className="text-textBody">{j.reason}</p>
                  <p className="text-textMuted">
                    Đã xử lý: {j.processed_count} đơn · Phương án: {j.resolution_mode}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 7. A-31 TOURNAMENTS */}
      {subTab === 'TOURNAMENTS' && (
        <div className="tab-panel-anim space-y-6">
          <form onSubmit={createTournament} className="bg-panel p-6 rounded-token-lg border border-borderStrong grid sm:grid-cols-4 gap-3 items-end">
            <div>
              <label className="block text-xs text-textMuted mb-1">Cơ sở đăng cai</label>
              <select
                value={trnVenueId}
                onChange={(e) => setTrnVenueId(e.target.value)}
                className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
              >
                {venues.map((v) => (
                  <option key={v.id} value={v.id}>{v.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs text-textMuted mb-1">Tên giải đấu</label>
              <input
                type="text"
                required
                value={trnNameVi}
                onChange={(e) => setTrnNameVi(e.target.value)}
                className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
              />
            </div>
            <div>
              <label className="block text-xs text-textMuted mb-1">Thể thức</label>
              <select
                value={trnFormat}
                onChange={(e) => setTrnFormat(e.target.value as any)}
                className="w-full min-h-[42px] px-3 bg-panel-2 border border-borderStrong rounded-token-md text-textStrong text-xs"
              >
                <option value="ROUND_ROBIN">Vòng tròn tính điểm</option>
                <option value="KNOCKOUT">Loại trực tiếp</option>
              </select>
            </div>
            <button type="submit" className="min-h-[42px] px-4 rounded-token-full bg-accent text-textOnAccent font-bold text-xs">
              + Mở Giải Đấu Mới
            </button>
          </form>

          <div className="grid lg:grid-cols-2 gap-6">
            {tournaments.map((tr) => (
              <div key={tr.id} className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4 text-xs tabular-nums">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-base text-textStrong">{tr.name_vi}</h4>
                    <p className="text-textMuted">{tr.venue_name} · {tr.format}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => generateMatches(tr.id)}
                    className="min-h-[34px] px-3 rounded-token-full bg-accent-soft border border-accent-border text-accent font-bold"
                  >
                    Xếp cặp đấu
                  </button>
                </div>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={newTeamName}
                    onChange={(e) => setNewTeamName(e.target.value)}
                    aria-label="Tên đội đăng ký"
                    className="flex-1 min-h-[38px] px-3 bg-panel-2 border border-borderStrong rounded text-textStrong"
                  />
                  <button
                    type="button"
                    onClick={() => addTeamToTournament(tr.id)}
                    className="min-h-[38px] px-3 rounded bg-panel-2 border border-borderStrong font-bold text-textStrong"
                  >
                    + Thêm Đội ({tr.teams?.length || 0})
                  </button>
                </div>

                {(tr.matches || []).length > 0 && (
                  <div className="space-y-2 pt-2 border-t border-borderToken">
                    {tr.matches.map((m: any) => {
                      const val = scoreInputs[m.id] || {
                        h: String(m.home_score ?? 0),
                        a: String(m.away_score ?? 0),
                      };
                      return (
                        <div key={m.id} className="p-2.5 rounded bg-panel-2 flex items-center justify-between gap-2">
                          <span className="font-semibold text-textStrong">
                            {m.home_team_name} vs {m.away_team_name}
                          </span>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="number"
                              min={0}
                              value={val.h}
                              onChange={(e) =>
                                setScoreInputs((s) => ({ ...s, [m.id]: { ...val, h: e.target.value } }))
                              }
                              className="w-12 py-1 text-center bg-page border border-borderStrong rounded text-textStrong font-mono"
                            />
                            <span>-</span>
                            <input
                              type="number"
                              min={0}
                              value={val.a}
                              onChange={(e) =>
                                setScoreInputs((s) => ({ ...s, [m.id]: { ...val, a: e.target.value } }))
                              }
                              className="w-12 py-1 text-center bg-page border border-borderStrong rounded text-textStrong font-mono"
                            />
                            <button
                              type="button"
                              onClick={() => saveMatchScore(tr.id, m.id)}
                              className="px-2.5 py-1 rounded bg-accent text-textOnAccent font-bold"
                            >
                              Lưu
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* 8. A-33 SMART LIGHTS & GATE IOT */}
      {subTab === 'IOT' && (
        <div className="tab-panel-anim grid lg:grid-cols-[1.35fr_1fr] gap-6">
          <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4">
            <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
              <Lightbulb className="w-5 h-5 text-accent" />
              <span>Tủ Điều Khiển Đèn LED & Cửa Tự Động IoT (A-33)</span>
            </h3>
            <p className="text-xs text-textMuted">
              Quy tắc tự động: Bật trước giờ chơi 10 phút, tắt sau 5 phút; hai ca liền kề tự động gộp liền mạch không tắt đèn giữa chừng (IOT-01, IOT-02).
            </p>

            <div className="grid sm:grid-cols-2 gap-3.5 text-xs tabular-nums">
              {iotDevices.map((dev) => (
                <div key={dev.id} className="p-4 rounded-token-md bg-panel-2 border border-borderStrong space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <strong className="text-sm text-textStrong block">{dev.device_name}</strong>
                      <span className="text-textMuted">{dev.venue_name} · {dev.adapter_protocol}</span>
                    </div>
                    <span
                      className={`px-2.5 py-0.5 rounded-token-full font-extrabold ${
                        dev.power_state === 'ON'
                          ? 'bg-accent text-textOnAccent'
                          : 'bg-page text-textMuted border border-borderToken'
                      }`}
                    >
                      {dev.power_state}
                    </span>
                  </div>

                  {dev.last_error && (
                    <p className="p-2 rounded bg-statusDanger-soft border border-statusDanger-border text-statusDanger flex items-center gap-1.5">
                      <AlertTriangle className="w-3.5 h-3.5 shrink-0" />
                      <span>{dev.last_error}</span>
                    </p>
                  )}

                  {Array.isArray(dev.scheduled_windows) && dev.scheduled_windows.length > 0 && (
                    <div className="text-[11px] text-accent space-y-0.5">
                      {dev.scheduled_windows.slice(0, 2).map((w: any, i: number) => (
                        <p key={i}>
                          Lịch bật tự động: {new Date(w.light_on_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} –{' '}
                          {new Date(w.light_off_at).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })} (Gộp {w.merged_sessions} ca)
                        </p>
                      ))}
                    </div>
                  )}

                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button
                      type="button"
                      onClick={() => sendIotCommand(dev.id, 'TURN_ON', false)}
                      className="min-h-[34px] px-3 rounded-token-full bg-accent text-textOnAccent font-bold inline-flex items-center gap-1"
                    >
                      <Power className="w-3.5 h-3.5" />
                      <span>Bật đèn</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => sendIotCommand(dev.id, 'TURN_OFF', false)}
                      className="min-h-[34px] px-3 rounded-token-full bg-page border border-borderStrong text-textStrong font-semibold"
                    >
                      Tắt đèn
                    </button>
                    <button
                      type="button"
                      onClick={() => sendIotCommand(dev.id, 'TURN_ON', true)}
                      className="min-h-[34px] px-2.5 rounded-token-full bg-statusWarning-soft text-statusWarning font-semibold"
                    >
                      Test mất kết nối
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="bg-panel p-6 rounded-token-lg border border-borderStrong space-y-3">
            <h3 className="font-bold text-base text-textStrong">Nhật Ký Lệnh Thiết Bị ({iotLogs.length})</h3>
            <div className="space-y-2 max-h-[380px] overflow-y-auto text-xs tabular-nums">
              {iotLogs.map((l) => (
                <div key={l.id} className="p-3 rounded bg-panel-2 border border-borderToken space-y-1">
                  <div className="flex justify-between">
                    <strong className="text-textStrong">{l.device_name}</strong>
                    <span className={l.status === 'ACKED' ? 'text-accent font-bold' : 'text-statusDanger font-bold'}>
                      {l.command} ({l.status})
                    </span>
                  </div>
                  <p className="text-textMuted">{l.detail}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* 9. A-13 IMMUTABLE AUDIT LOG */}
      {subTab === 'AUDIT' && (
        <div className="tab-panel-anim bg-panel p-6 rounded-token-lg border border-borderStrong space-y-4">
          <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
            <History className="w-5 h-5 text-accent" />
            <span>Nhật Ký Kiểm Toán Toàn Đơn Vị (Audit Logs — A-13)</span>
          </h3>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs tabular-nums min-w-[640px]">
              <thead>
                <tr className="border-b border-borderToken text-textMuted">
                  <th className="py-2 pr-3">Thời gian</th>
                  <th className="py-2 px-3">Cổng</th>
                  <th className="py-2 px-3">Hành động</th>
                  <th className="py-2 px-3">Bảng dữ liệu</th>
                  <th className="py-2 pl-3">IP</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-borderToken/50">
                {auditLogs.map((log) => (
                  <tr key={log.id}>
                    <td className="py-2 pr-3 text-textMuted">
                      {new Date(log.created_at).toLocaleString('vi-VN')}
                    </td>
                    <td className="py-2 px-3 font-semibold text-textStrong uppercase">{log.actor_portal}</td>
                    <td className="py-2 px-3 font-mono font-bold text-accent">{log.action}</td>
                    <td className="py-2 px-3 text-textBody">{log.target_table}</td>
                    <td className="py-2 pl-3 text-textMuted">{log.ip_address || 'local'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}

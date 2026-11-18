'use client';

import React, { useState, useMemo } from 'react';
import {
  DollarSign,
  Percent,
  Calendar,
  CreditCard,
  TrendingUp,
  Download,
  Flame,
  CheckCircle2,
  AlertTriangle,
  Users,
  BarChart3,
} from 'lucide-react';

interface AdminExecutiveChartsProps {
  reportData: any;
  language: 'vi' | 'en';
  onQuickSuggestDeal?: () => void;
}

function escapeCsvCell(val: unknown): string {
  const s = String(val ?? '');
  const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

export function AdminExecutiveCharts({
  reportData,
  language,
  onQuickSuggestDeal,
}: AdminExecutiveChartsProps) {
  const isEn = language === 'en';
  const [hoveredDayIdx, setHoveredDayIdx] = useState<number | null>(null);

  const formatVnd = (amount: number) =>
    isEn
      ? `${new Intl.NumberFormat('en-US').format(Math.round(Number(amount || 0)))} VND`
      : `${new Intl.NumberFormat('vi-VN').format(Math.round(Number(amount || 0)))} ₫`;

  const dailySeries: Array<{
    date: string;
    gross_revenue_vnd: number;
    refunded_vnd: number;
    net_revenue_vnd: number;
    booking_count: number;
    booked_minutes: number;
  }> = useMemo(() => reportData?.daily_series || [], [reportData]);

  const maxDailyNet = useMemo(
    () => Math.max(100000, ...dailySeries.map((d) => Number(d.net_revenue_vnd || 0))),
    [dailySeries]
  );
  const maxDailyBookings = useMemo(
    () => Math.max(3, ...dailySeries.map((d) => Number(d.booking_count || 0))),
    [dailySeries]
  );

  const courtPerf: any[] = reportData?.court_performance || [];
  const maxCourtRev = Math.max(100000, ...courtPerf.map((c) => Number(c.revenue_vnd || 0)));

  const heatmap: any[] = reportData?.hourly_heatmap || [];
  const weekdayLabels = isEn
    ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
    : ['T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'CN'];

  const totalBookingsCount = useMemo(
    () => (reportData?.bookings_summary || []).reduce((acc: number, r: any) => acc + Number(r.count || 0), 0),
    [reportData]
  );

  const exportCsvReport = () => {
    if (!reportData) return;
    const headers = isEn
      ? ['Date', 'Gross Revenue (VND)', 'Refunded (VND)', 'Net Revenue (VND)', 'Valid Bookings', 'Booked Minutes']
      : ['Ngày', 'Doanh thu gộp (VND)', 'Hoàn cọc (VND)', 'Doanh thu thuần (VND)', 'Số lượt đặt', 'Số phút đặt'];
    const lines = ['\uFEFF' + headers.map(escapeCsvCell).join(',')];
    for (const d of dailySeries) {
      lines.push(
        [
          d.date,
          d.gross_revenue_vnd,
          d.refunded_vnd,
          d.net_revenue_vnd,
          d.booking_count,
          d.booked_minutes,
        ]
          .map(escapeCsvCell)
          .join(',')
      );
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `revenue-report-${reportData.period?.start_date || 'export'}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!reportData) {
    return (
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {[1, 2, 3, 4].map((n) => (
          <div key={n} className="h-32 rounded-token-lg skeleton-shimmer border border-borderToken" />
        ))}
      </div>
    );
  }

  const activeDay =
    hoveredDayIdx !== null && dailySeries[hoveredDayIdx]
      ? dailySeries[hoveredDayIdx]
      : dailySeries[dailySeries.length - 1] || null;

  return (
    <div className="space-y-6 tabular-nums">
      {/* Row 1: 4 Executive KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-panel border border-borderStrong rounded-token-lg p-5 space-y-2 shadow-token-card">
          <div className="flex items-center justify-between text-xs font-semibold text-textMuted">
            <span>{isEn ? 'Net Revenue (Confirmed - Refunds)' : 'Doanh Thu Thuần (Đã trừ hoàn cọc)'}</span>
            <span className="w-8 h-8 rounded-token-sm bg-accent-soft border border-accent-border flex items-center justify-center text-accent">
              <DollarSign className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-textStrong font-mono">
            {formatVnd(reportData.revenue?.total_revenue_vnd || 0)}
          </p>
          <p className="text-xs text-accent font-medium">
            {reportData.revenue?.transaction_count || 0} {isEn ? 'txns' : 'giao dịch'} ·{' '}
            {isEn ? 'Refunded:' : 'Đã hoàn:'} {formatVnd(reportData.revenue?.refunded_vnd || 0)}
          </p>
        </div>

        <div className="bg-panel border border-borderStrong rounded-token-lg p-5 space-y-2 shadow-token-card">
          <div className="flex items-center justify-between text-xs font-semibold text-textMuted">
            <span>{isEn ? 'Real Configured Court Occupancy' : 'Tỷ Lệ Lấp Đầy Cấu Hình Thực'}</span>
            <span className="w-8 h-8 rounded-token-sm bg-statusWarning-soft border border-statusWarning-border flex items-center justify-center text-statusWarning">
              <Percent className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-statusWarning font-mono">
            {reportData.occupancy_rate || 0}%
          </p>
          <p className="text-xs text-textMuted">
            {reportData.booked_minutes || 0} / {reportData.available_minutes || 0}{' '}
            {isEn ? 'physical open mins' : 'phút sân vật lý mở cửa'}
          </p>
        </div>

        <div className="bg-panel border border-borderStrong rounded-token-lg p-5 space-y-2 shadow-token-card">
          <div className="flex items-center justify-between text-xs font-semibold text-textMuted">
            <span>{isEn ? 'Valid Bookings & Unique Players' : 'Lượt Đặt Hợp Lệ & Khách Chơi'}</span>
            <span className="w-8 h-8 rounded-token-sm bg-statusInfo-soft flex items-center justify-center text-statusInfo">
              <Calendar className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-statusInfo font-mono">{totalBookingsCount}</p>
          <p className="text-xs text-textMuted inline-flex items-center gap-1.5">
            <Users className="w-3.5 h-3.5 text-accent" />
            <span>
              {reportData.kpis?.unique_customers || 0} {isEn ? 'customers' : 'khách'} ·{' '}
              {isEn ? 'Avg:' : 'TB đơn:'} {formatVnd(reportData.kpis?.avg_booking_value_vnd || 0)}
            </span>
          </p>
        </div>

        <div className="bg-panel border border-borderStrong rounded-token-lg p-5 space-y-2 shadow-token-card">
          <div className="flex items-center justify-between text-xs font-semibold text-textMuted">
            <span>{isEn ? 'Receivables Due at Venue' : 'Còn Chờ Thu Tại Quầy'}</span>
            <span className="w-8 h-8 rounded-token-sm bg-panel-2 border border-borderStrong flex items-center justify-center text-accent">
              <CreditCard className="w-4 h-4" />
            </span>
          </div>
          <p className="text-2xl sm:text-3xl font-extrabold text-accent font-mono">
            {formatVnd(reportData.kpis?.receivables_vnd || 0)}
          </p>
          <p className="text-xs text-textMuted">
            {isEn ? 'No-show:' : 'Vắng mặt:'} {reportData.no_show_rate || 0}% ·{' '}
            {isEn ? 'Cancel:' : 'Hủy:'} {reportData.kpis?.cancellation_rate || 0}%
          </p>
        </div>
      </div>

      {/* Row 2: Daily Revenue & Bookings Interactive Combo Chart + Payment/Status Breakdown */}
      <div className="grid lg:grid-cols-[1.55fr_1fr] gap-6">
        <section className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-bold text-base sm:text-lg text-textStrong flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-accent" />
                <span>
                  {isEn ? 'Daily Net Revenue & Booking Volume Trend' : 'Biểu Đồ Xu Hướng Doanh Thu Thuần & Lượt Đặt Theo Ngày'}
                </span>
              </h3>
              <div className="flex flex-wrap items-center gap-4 text-xs text-textMuted mt-1.5">
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-3 rounded-sm bg-accent inline-block" />
                  <span>{isEn ? 'Net Revenue (VND)' : 'Doanh thu thuần (VND)'}</span>
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="w-3 h-0.5 bg-statusInfo inline-block" />
                  <span>{isEn ? 'Bookings (dashed line)' : 'Số lượt đặt (đường nét đứt)'}</span>
                </span>
              </div>
            </div>

            <button
              type="button"
              onClick={exportCsvReport}
              className="min-h-[38px] px-3.5 rounded-token-full bg-panel-2 hover:bg-surfaceHover border border-borderStrong text-xs font-bold text-textStrong inline-flex items-center gap-1.5"
            >
              <Download className="w-3.5 h-3.5 text-accent" />
              <span>{isEn ? 'Export CSV' : 'Xuất CSV (UTF-8)'}</span>
            </button>
          </div>

          {/* Interactive Tooltip Readout Bar */}
          {activeDay && (
            <div className="p-3 rounded-token-md bg-panel-2 border border-borderToken flex flex-wrap items-center justify-between gap-3 text-xs">
              <span className="font-bold text-textStrong">{activeDay.date}</span>
              <div className="flex flex-wrap items-center gap-4">
                <span className="text-accent font-bold">
                  {isEn ? 'Net:' : 'Thuần:'} {formatVnd(activeDay.net_revenue_vnd)}
                </span>
                {activeDay.refunded_vnd > 0 && (
                  <span className="text-statusDanger">
                    {isEn ? 'Refund:' : 'Hoàn:'} {formatVnd(activeDay.refunded_vnd)}
                  </span>
                )}
                <span className="text-statusInfo font-bold">
                  {activeDay.booking_count} {isEn ? 'bookings' : 'lượt đặt'} ({activeDay.booked_minutes}p)
                </span>
              </div>
            </div>
          )}

          {/* Responsive SVG Combo Chart (Zero raw hex — uses CSS variables!) */}
          <div className="w-full overflow-x-auto">
            {dailySeries.length === 0 ? (
              <p className="text-xs text-textMuted py-12 text-center">
                {isEn ? 'No daily series in selected range.' : 'Chưa có dữ liệu theo ngày trong khoảng đã chọn.'}
              </p>
            ) : (
              <svg
                viewBox="0 0 680 220"
                role="img"
                aria-label={isEn ? 'Daily revenue and bookings chart' : 'Biểu đồ doanh thu và lượt đặt theo ngày'}
                fontFamily="var(--font-sans)"
                className="w-full min-w-[480px] h-[220px]"
              >
                {/* Horizontal Y Gridlines */}
                {[30, 80, 130, 180].map((y) => (
                  <line
                    key={y}
                    x1="20"
                    y1={y}
                    x2="660"
                    y2={y}
                    stroke="var(--border-strong)"
                    strokeWidth="1"
                    strokeDasharray="3 5"
                  />
                ))}

                {/* Revenue Bars */}
                {dailySeries.map((d, idx) => {
                  const count = dailySeries.length;
                  const slotW = 620 / Math.max(1, count);
                  const barW = Math.max(6, Math.min(24, slotW * 0.62));
                  const x = 30 + idx * slotW + (slotW - barW) / 2;
                  const ratio = d.net_revenue_vnd / maxDailyNet;
                  const barH = Math.max(d.net_revenue_vnd > 0 ? 6 : 2, Math.round(ratio * 145));
                  const y = 180 - barH;
                  const isActive = hoveredDayIdx === idx;

                  return (
                    <g
                      key={d.date}
                      onMouseEnter={() => setHoveredDayIdx(idx)}
                      onFocus={() => setHoveredDayIdx(idx)}
                      tabIndex={0}
                      role="button"
                      aria-label={`${d.date}: ${formatVnd(d.net_revenue_vnd)}`}
                      className="cursor-pointer focus:outline-none"
                    >
                      <rect
                        x={x - 2}
                        y={24}
                        width={barW + 4}
                        height={160}
                        fill={isActive ? 'var(--accent-soft)' : 'transparent'}
                        rx="4"
                      />
                      <rect
                        x={x}
                        y={y}
                        width={barW}
                        height={barH}
                        rx="4"
                        fill={isActive ? 'var(--accent-hover)' : d.net_revenue_vnd > 0 ? 'var(--accent)' : 'var(--bg-panel-3)'}
                        className="chart-bar-rise"
                      />
                      {(count <= 10 || idx % Math.ceil(count / 7) === 0 || idx === count - 1) && (
                        <text
                          x={x + barW / 2}
                          y={202}
                          textAnchor="middle"
                          fill="var(--text-muted)"
                          fontSize="10"
                        >
                          {d.date.slice(5)}
                        </text>
                      )}
                    </g>
                  );
                })}

                {/* Booking Count Overlay Line (distinct dashed stroke per Spec 21.4) */}
                {dailySeries.length > 1 && (
                  <polyline
                    fill="none"
                    stroke="var(--info)"
                    strokeWidth="2.2"
                    strokeDasharray="5 3"
                    points={dailySeries
                      .map((d, idx) => {
                        const slotW = 620 / dailySeries.length;
                        const cx = 30 + idx * slotW + slotW / 2;
                        const cy = 176 - (d.booking_count / maxDailyBookings) * 136;
                        return `${cx.toFixed(1)},${cy.toFixed(1)}`;
                      })
                      .join(' ')}
                  />
                )}
                {dailySeries.map((d, idx) => {
                  if (d.booking_count === 0) return null;
                  const slotW = 620 / dailySeries.length;
                  const cx = 30 + idx * slotW + slotW / 2;
                  const cy = 176 - (d.booking_count / maxDailyBookings) * 136;
                  return (
                    <circle
                      key={`pt-${d.date}`}
                      cx={cx}
                      cy={cy}
                      r="3.5"
                      fill="var(--info)"
                      stroke="var(--bg-panel)"
                      strokeWidth="1.5"
                    />
                  );
                })}
              </svg>
            )}
          </div>
        </section>

        {/* Payment Methods & Booking Lifecycle Breakdown */}
        <section className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-5 flex flex-col justify-between">
          <div className="space-y-3">
            <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
              <BarChart3 className="w-5 h-5 text-accent" />
              <span>{isEn ? 'Payment Channels & Lifecycle' : 'Cơ Cấu Kênh Thu & Trạng Thái Đặt Sân'}</span>
            </h3>

            {(reportData.payment_methods || []).length === 0 ? (
              <p className="text-xs text-textMuted py-4">
                {isEn ? 'No confirmed payments in this window.' : 'Chưa phát sinh giao dịch thu tiền trong kỳ này.'}
              </p>
            ) : (
              <div className="space-y-3">
                {(reportData.payment_methods || []).map((m: any) => (
                  <div key={m.method} className="space-y-1">
                    <div className="flex justify-between text-xs">
                      <span className="font-bold text-textStrong">
                        {m.method} ({m.count})
                      </span>
                      <span className="text-accent font-bold">
                        {formatVnd(m.amount)} ({m.percentage}%)
                      </span>
                    </div>
                    <div className="h-2.5 rounded-token-full bg-panel-2 overflow-hidden">
                      <div
                        className="h-full rounded-token-full bg-accent"
                        style={{ width: `${Math.max(4, m.percentage)}%` }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="pt-4 border-t border-borderToken space-y-2.5">
            <p className="text-xs font-bold text-textMuted">
              {isEn ? 'Bookings by Lifecycle State' : 'Phân Bổ Trạng Thái Lịch Đặt'}
            </p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              {(reportData.bookings_summary || []).map((st: any) => (
                <div
                  key={st.status}
                  className="p-2.5 rounded-token-sm bg-panel-2 border border-borderToken flex items-center justify-between"
                >
                  <span className="inline-flex items-center gap-1.5 font-medium text-textBody">
                    {['CONFIRMED', 'COMPLETED', 'CHECKED_IN'].includes(st.status) ? (
                      <CheckCircle2 className="w-3.5 h-3.5 text-accent shrink-0" />
                    ) : (
                      <AlertTriangle className="w-3.5 h-3.5 text-statusWarning shrink-0" />
                    )}
                    <span>{st.status}</span>
                  </span>
                  <strong className="font-extrabold text-textStrong">{st.count}</strong>
                </div>
              ))}
            </div>
          </div>
        </section>
      </div>

      {/* Row 3: Occupancy Heatmap (Weekday x Time Band, A-12 / A-28) & Per-Court Revenue Ranking */}
      <div className="grid lg:grid-cols-[1.2fr_1fr] gap-6">
        <section className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="font-bold text-base text-textStrong flex items-center gap-2">
                <Flame className="w-5 h-5 text-statusWarning" />
                <span>
                  {isEn ? 'Weekday × Time-Band Occupancy Heatmap (%)' : 'Bản Đồ Nhiệt Tỷ Lệ Lấp Đầy (Thứ × Khung Giờ)'}
                </span>
              </h3>
              <p className="text-xs text-textMuted mt-0.5">
                {isEn
                  ? 'Exact % shown in every cell (grayscale accessible). Slots <30% are candidates for off-peak deals.'
                  : 'Hiển thị rõ con số % từng ô. Các khung dưới 30% phù hợp tạo Ưu đãi giờ trống (A-27).'}
              </p>
            </div>
            {onQuickSuggestDeal && (
              <button
                type="button"
                onClick={onQuickSuggestDeal}
                className="min-h-[36px] px-3 rounded-token-full bg-accent-soft border border-accent-border text-accent text-xs font-bold"
              >
                {isEn ? '+ Draft Deal' : '+ Tạo ưu đãi giờ vắng'}
              </button>
            )}
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs border-separate border-spacing-1.5 min-w-[440px]">
              <thead>
                <tr>
                  <th className="text-left text-textMuted py-1 pr-2">{isEn ? 'Time Band' : 'Khung giờ'}</th>
                  {weekdayLabels.map((lbl) => (
                    <th key={lbl} className="text-center text-textMuted py-1 px-1">
                      {lbl}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {heatmap.map((row: any) => (
                  <tr key={row.band_id}>
                    <td className="font-mono font-semibold text-textStrong pr-2 whitespace-nowrap">
                      {row.label}
                    </td>
                    {(row.days || []).map((cell: any) => {
                      const pct = Number(cell.occupancy_pct || 0);
                      const cellStyle =
                        pct >= 65
                          ? 'bg-accent text-textOnAccent font-extrabold'
                          : pct >= 30
                            ? 'bg-accent-soft text-accent border border-accent-border font-bold'
                            : 'bg-panel-2 text-textMuted border border-borderToken';
                      return (
                        <td
                          key={`${row.band_id}-${cell.dow}`}
                          title={`${row.label}: ${pct}% (${cell.booking_count} bookings)`}
                          className={`h-10 rounded-token-sm text-center align-middle ${cellStyle}`}
                        >
                          {pct}%
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        {/* Court Revenue & Utilization Ranking */}
        <section className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4">
          <h3 className="font-bold text-base text-textStrong">
            {isEn ? 'Performance by Court' : 'Hiệu Suất Khai Thác Từng Sân'}
          </h3>

          <div className="space-y-3.5 max-h-[280px] overflow-y-auto pr-1">
            {courtPerf.map((c) => {
              const widthPct = Math.max(4, Math.round((Number(c.revenue_vnd || 0) / maxCourtRev) * 100));
              return (
                <div key={c.court_id} className="space-y-1.5">
                  <div className="flex items-baseline justify-between gap-2 text-xs">
                    <div className="min-w-0">
                      <strong className="text-textStrong font-bold">{c.court_name}</strong>
                      <span className="text-textMuted ml-1.5">({c.venue_name})</span>
                    </div>
                    <span className="font-mono font-bold text-accent shrink-0">
                      {formatVnd(c.revenue_vnd)} · {c.booked_hours}h ({c.booking_count})
                    </span>
                  </div>
                  <div className="h-2.5 rounded-token-full bg-panel-2 overflow-hidden">
                    <div
                      className="h-full rounded-token-full bg-accent"
                      style={{ width: `${widthPct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </section>
      </div>

      {/* Row 4: Recent Bookings Ledger Table */}
      <section className="bg-panel border border-borderStrong rounded-token-lg p-6 space-y-4">
        <h3 className="font-bold text-base text-textStrong">
          {isEn ? 'Latest Bookings Ledger' : 'Sổ Giao Dịch Đặt Sân Gần Nhất'}
        </h3>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs sm:text-sm min-w-[680px]">
            <thead>
              <tr className="border-b border-borderToken text-textMuted">
                <th className="py-2.5 pr-3">{isEn ? 'Code' : 'Mã đơn'}</th>
                <th className="py-2.5 px-3">{isEn ? 'Customer' : 'Khách hàng'}</th>
                <th className="py-2.5 px-3">{isEn ? 'Court & Venue' : 'Sân & Cơ sở'}</th>
                <th className="py-2.5 px-3">{isEn ? 'Status' : 'Trạng thái'}</th>
                <th className="py-2.5 px-3 text-right">{isEn ? 'Paid' : 'Đã thu'}</th>
                <th className="py-2.5 pl-3 text-right">{isEn ? 'Due' : 'Còn lại'}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-borderToken/50">
              {(reportData.recent_bookings || []).map((b: any) => (
                <tr key={b.id} className="hover:bg-panel-2/60">
                  <td className="py-2.5 pr-3 font-mono font-bold text-accent">{b.booking_code}</td>
                  <td className="py-2.5 px-3 text-textStrong font-medium">{b.customer_name}</td>
                  <td className="py-2.5 px-3 text-textBody">
                    {b.court_name} · <span className="text-textMuted text-xs">{b.venue_name}</span>
                  </td>
                  <td className="py-2.5 px-3">
                    <span className="px-2 py-0.5 rounded-token-full bg-panel-2 border border-borderToken text-xs font-semibold text-textStrong">
                      {b.status}
                    </span>
                  </td>
                  <td className="py-2.5 px-3 text-right font-mono font-bold text-accent">
                    {formatVnd(b.paid_amount)}
                  </td>
                  <td className="py-2.5 pl-3 text-right font-mono text-textBody">
                    {formatVnd(b.due_at_venue)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

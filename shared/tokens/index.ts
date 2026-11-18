/**
 * Sports Court Booking Platform - Design Tokens (Section 21)
 * Brand: Green Theme with WCAG 2.1 AA Contrast Ratios
 */

export const colors = {
  // Brand Green Palette
  primaryGreen: '#15803D',      // Customer portal header, primary buttons (contrast ~5:1 on white)
  brightGreen: '#22C55E',       // Icons, accents, charts
  lightGreen: '#DCFCE7',        // Card backgrounds, selected items
  pageBackground: '#F0FDF4',    // Light general background
  darkGreen: '#166534',         // Staff portal header bar
  veryDarkGreen: '#14532D',     // Admin portal header bar
  nearBlackGreen: '#052E16',    // Super Admin console header bar, dark mode bg

  // Neutral Colors
  textPrimary: '#111827',
  textSecondary: '#4B5563',
  border: '#D1D5DB',
  white: '#FFFFFF',
  surfaceCard: '#FFFFFF',

  // Semantic Status Colors
  warning: '#B45309',
  error: '#B91C1C',
  info: '#1D4ED8',

  // Booking State Colors (Section 21.3)
  bookingStates: {
    free: {
      background: '#FFFFFF',
      border: '#15803D',
      textColor: '#15803D',
      labelVi: 'Trống',
      labelEn: 'Free',
      icon: 'empty',
    },
    holding: {
      background: '#FEF3C7',
      textColor: '#92400E',
      labelVi: 'Đang giữ chỗ',
      labelEn: 'Holding',
      icon: 'clock',
    },
    confirmed: {
      background: '#15803D',
      textColor: '#FFFFFF',
      labelVi: 'Đã xác nhận',
      labelEn: 'Confirmed',
      icon: 'check',
    },
    checkedIn: {
      background: '#14532D',
      textColor: '#FFFFFF',
      labelVi: 'Đã check-in',
      labelEn: 'Checked In',
      icon: 'user-check',
    },
    completed: {
      background: '#F3F4F6',
      textColor: '#6B7280',
      labelVi: 'Hoàn thành',
      labelEn: 'Completed',
      icon: 'check-circle',
    },
    cancelled: {
      background: '#FEE2E2',
      textColor: '#991B1B',
      labelVi: 'Đã hủy',
      labelEn: 'Cancelled',
      icon: 'x-circle',
    },
    noShow: {
      background: '#FEE2E2',
      textColor: '#991B1B',
      labelVi: 'Vắng mặt',
      labelEn: 'No-show',
      icon: 'user-x',
    },
    blocked: {
      background: '#E5E7EB',
      textColor: '#374151',
      labelVi: 'Khóa / Bảo trì',
      labelEn: 'Blocked / Maintenance',
      icon: 'tool',
    },
    peakHour: {
      badgeColor: '#EA580C',
      labelVi: 'Giờ vàng',
      labelEn: 'Peak hour',
    },
  },
};

export const portalThemes = {
  customer: {
    portalCode: 'customer',
    headerBg: colors.primaryGreen,
    labelVi: 'ĐẶT SÂN THỂ THAO',
    labelEn: 'SPORTS BOOKING',
    domain: 'app.tenmien.vn',
  },
  staff: {
    portalCode: 'staff',
    headerBg: colors.darkGreen,
    labelVi: 'NHÂN VIÊN CƠ SỞ',
    labelEn: 'VENUE STAFF',
    domain: 'staff.tenmien.vn',
  },
  admin: {
    portalCode: 'admin',
    headerBg: colors.veryDarkGreen,
    labelVi: 'QUẢN TRỊ CHỦ SÂN',
    labelEn: 'TENANT ADMIN',
    domain: 'admin.tenmien.vn',
  },
  platform: {
    portalCode: 'platform',
    headerBg: colors.nearBlackGreen,
    labelVi: 'SUPER ADMIN CONSOLE',
    labelEn: 'SUPER ADMIN CONSOLE',
    domain: 'console.tenmien.vn',
  },
};

export const typography = {
  fontFamily: "'Inter', 'Be Vietnam Pro', sans-serif",
  minTouchTargetSize: 44, // px (WCAG mobile touch target requirement)
};

'use client';

import React from 'react';

export interface BadgeProps {
  variant?: 'accent' | 'neutral';
  icon?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export function Badge({
  variant = 'accent',
  icon,
  children,
  className = '',
}: BadgeProps) {
  const baseStyle = 'inline-flex items-center space-x-1.5 px-3 py-1 rounded-token-full text-xs font-semibold tracking-wide';
  
  const variantStyle = variant === 'accent'
    ? 'bg-accent-soft text-accent'
    : 'bg-panel-2 text-textBody border border-borderToken';

  return (
    <span className={`${baseStyle} ${variantStyle} ${className}`}>
      {icon && <span className="w-3.5 h-3.5 flex items-center justify-center">{icon}</span>}
      <span>{children}</span>
    </span>
  );
}

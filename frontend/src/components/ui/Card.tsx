'use client';

import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: 'panel' | 'nested';
  children: React.ReactNode;
}

export function Card({
  variant = 'panel',
  className = '',
  children,
  ...props
}: CardProps) {
  const baseStyle = variant === 'panel'
    ? 'bg-panel rounded-token-lg p-5 sm:p-8 md:p-12 shadow-token-card border border-borderToken'
    : 'bg-panel-2 rounded-token-md p-4 sm:p-6 border border-borderToken';

  return (
    <div className={`${baseStyle} ${className}`} {...props}>
      {children}
    </div>
  );
}

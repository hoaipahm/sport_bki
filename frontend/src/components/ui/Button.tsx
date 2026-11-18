'use client';

import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'md' | 'sm' | 'lg';
  children: React.ReactNode;
}

export function Button({
  variant = 'primary',
  size = 'md',
  className = '',
  disabled,
  children,
  ...props
}: ButtonProps) {
  const baseStyle =
    'inline-flex items-center justify-center font-semibold transition-[transform,background-color,border-color,box-shadow] duration-150 focus:outline-none focus:ring-2 focus:ring-accent/50 disabled:opacity-50 disabled:cursor-not-allowed select-none active:scale-[0.98]';

  const sizeStyle =
    size === 'sm'
      ? 'min-h-[44px] px-3.5 py-1.5 text-sm rounded-token-md'
      : size === 'lg'
      ? 'min-h-[50px] px-7 py-3 text-base rounded-token-full font-bold'
      : 'min-h-[44px] px-6 py-2.5 text-sm sm:text-base rounded-token-full';

  let variantStyle = '';
  if (disabled) {
    variantStyle = 'bg-panel-2 text-textMuted border border-transparent shadow-none';
  } else if (variant === 'primary') {
    variantStyle = 'bg-accent text-textOnAccent hover:bg-accent-hover active:bg-accent-pressed shadow-md shadow-accent/20';
  } else if (variant === 'secondary') {
    variantStyle = 'bg-transparent border border-borderStrong text-textStrong hover:bg-surfaceHover hover:border-accent-border';
  } else if (variant === 'ghost') {
    variantStyle = 'bg-transparent text-textBody hover:text-textStrong hover:bg-surfaceHover';
  } else if (variant === 'danger') {
    variantStyle = 'bg-statusDanger text-textOnAccent hover:opacity-90 shadow-sm';
  }

  return (
    <button
      className={`${baseStyle} ${sizeStyle} ${variantStyle} ${className}`}
      disabled={disabled}
      {...props}
    >
      {children}
    </button>
  );
}

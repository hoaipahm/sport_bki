'use client';
import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { CalendarDays, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { vietnamDate } from '../../../shared/booking';
const parse = (value: string) => new Date(`${value}T12:00:00Z`);
const key = (date: Date) => date.toISOString().slice(0,10);
const add = (date: Date, days: number) => new Date(date.getTime() + days * 86400000);
export function DatePicker({ value, onChange }: { value: string; onChange: (date: string) => void }) {
  const {language,t} = useLanguage();
  const locale = language === 'vi' ? 'vi-VN' : 'en-GB';
  const today = vietnamDate();
  const [open,setOpen] = useState(false);
  const [month,setMonth] = useState(value.slice(0,7));
  const [focused,setFocused] = useState(value);
  const [position,setPosition] = useState({top:0,left:0});
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const heading = useId();
  const dayRefs = useRef(new Map<string,HTMLButtonElement>());
  const close = () => { setOpen(false); trigger.current?.focus(); };
  const focusDay = (date: Date) => {
    const next = key(date) < today ? today : key(date);
    setMonth(next.slice(0,7)); setFocused(next);
    requestAnimationFrame(() => dayRefs.current.get(next)?.focus({preventScroll:true}));
  };
  const moveMonth = (amount: number) => {
    const next = new Date(`${month}-01T12:00:00Z`); next.setUTCMonth(next.getUTCMonth()+amount);
    setMonth(key(next).slice(0,7));
  };
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect=trigger.current?.getBoundingClientRect();if(!rect)return;
      const width=Math.min(344,window.innerWidth-24);
      const height = panel.current?.getBoundingClientRect().height || 440;
      const below = rect.bottom + 10;
      const top = below + height <= window.innerHeight - 12 ? below : Math.max(12, rect.top - height - 10);
      setPosition({left:Math.max(12,Math.min(rect.right-width,window.innerWidth-width-12)),top});
    };
    place();
    const click=(event:PointerEvent)=>{if(!panel.current?.contains(event.target as Node)&&!trigger.current?.contains(event.target as Node))setOpen(false)};
    const escape=(event:KeyboardEvent)=>{if(event.key==='Escape'){event.preventDefault();close()}};
    const scroll=(event:Event)=>{ if (!panel.current?.contains(event.target as Node)) place(); };
    document.addEventListener('pointerdown',click);document.addEventListener('keydown',escape);window.addEventListener('resize',place);window.addEventListener('scroll',scroll,true);
    requestAnimationFrame(()=>dayRefs.current.get(value)?.focus({preventScroll:true}));
    return()=>{document.removeEventListener('pointerdown',click);document.removeEventListener('keydown',escape);window.removeEventListener('resize',place);window.removeEventListener('scroll',scroll,true)};
  },[open,value]);
  const first = parse(`${month}-01`);
  const offset = (first.getUTCDay()+6)%7;
  const days = Array.from({length:42},(_,index)=>add(first,index-offset));
  const format = (date: Date, options: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale,{timeZone:'UTC',...options}).format(date);
  return <>
    <button ref={trigger} type="button" aria-haspopup="dialog" aria-expanded={open} onClick={()=>{setMonth(value.slice(0,7));setFocused(value);setOpen(!open)}} className="date-picker-trigger">
      <CalendarDays className="w-5 h-5 text-accent"/><span>{format(parse(value),{day:'2-digit',month:'short',year:'numeric'})}</span><ChevronRight className={`w-4 h-4 text-textMuted transition-transform ${open?'rotate-90':''}`}/>
      <span className="sr-only">{t('web.date')}</span>
    </button>
    {open && createPortal(<div ref={panel} role="dialog" aria-labelledby={heading} className="booking-date-popover" style={{top:position.top,left:position.left}} onKeyDown={event=>{
      if(event.key==='Tab') { const items=Array.from(panel.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')||[]);const first=items[0],last=items[items.length-1];if(event.shiftKey&&document.activeElement===first){event.preventDefault();last?.focus()}else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first?.focus()}}
    }}>
      <div className="flex items-center justify-between mb-5"><h3 id={heading} className="text-base font-semibold text-textStrong capitalize">{format(first,{month:'long',year:'numeric'})}</h3><div className="flex gap-1"><button type="button" aria-label={t('datePicker.previous')} disabled={month<=today.slice(0,7)} onClick={()=>moveMonth(-1)} className="calendar-nav"><ChevronLeft size={19}/></button><button type="button" aria-label={t('datePicker.next')} onClick={()=>moveMonth(1)} className="calendar-nav"><ChevronRight size={19}/></button><button type="button" aria-label={t('web.close')} onClick={close} className="calendar-nav"><X size={17}/></button></div></div>
      <div className="grid grid-cols-7 mb-2">{Array.from({length:7},(_,index)=><span key={index} className="text-center text-xs font-medium text-textMuted py-2">{format(add(parse('2026-11-16'),index),{weekday:'short'})}</span>)}</div>
      <div className="grid grid-cols-7 gap-1" role="group" aria-label={t('web.date')}>
        {days.map(date=>{const day=key(date),selected=day===value,outside=day.slice(0,7)!==month;return <button key={day} ref={el=>{if(el)dayRefs.current.set(day,el);else dayRefs.current.delete(day)}} type="button" disabled={day<today} tabIndex={day===focused?0:-1} aria-label={format(date,{weekday:'long',day:'numeric',month:'long',year:'numeric'})} aria-pressed={selected} aria-current={day===today?'date':undefined} className={`calendar-day ${selected?'is-selected':''} ${outside?'is-outside':''}`} onClick={()=>{onChange(day);close()}} onKeyDown={event=>{
          const movement:Record<string,number>={ArrowLeft:-1,ArrowRight:1,ArrowUp:-7,ArrowDown:7,Home:-((date.getUTCDay()+6)%7),End:6-((date.getUTCDay()+6)%7)};
          if(event.key in movement){event.preventDefault();focusDay(add(date,movement[event.key]))}
          if(event.key==='PageUp'||event.key==='PageDown'){event.preventDefault();const next=new Date(date);const targetMonth=next.getUTCMonth()+(event.key==='PageUp'?-1:1);next.setUTCDate(1);next.setUTCMonth(targetMonth);next.setUTCDate(Math.min(date.getUTCDate(),new Date(Date.UTC(next.getUTCFullYear(),next.getUTCMonth()+1,0)).getUTCDate()));focusDay(next)}
        }}>{date.getUTCDate()}<span className={`calendar-today-dot ${day!==today?'invisible':''}`}/></button>})}
      </div>
      <div className="flex items-center justify-between border-t border-borderToken mt-4 pt-4"><span className="text-xs text-textMuted">{t('datePicker.timezone')}</span><button type="button" className="min-h-[44px] px-3 text-sm font-semibold text-accent rounded-token-sm hover:bg-surfaceHover" onClick={()=>{onChange(today);close()}}>{t('web.today')}</button></div>
    </div>,document.body)}
  </>;
}

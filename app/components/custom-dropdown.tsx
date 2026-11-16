"use client";

import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown, FiChevronUp } from "react-icons/fi";
import "./custom-dropdown.css";

export type CustomDropdownOption = { value: string; label: string; disabled?: boolean; selected?: boolean; content?: ReactNode };

function DropdownScrollButton({ direction, disabled, listId, onStart, onStop, onStep }: {
  direction: number; disabled: boolean; listId: string;
  onStart: (direction: number) => void; onStop: () => void; onStep: (direction: number) => void;
}) {
  return <button type="button" className="custom-dropdown-scroll" tabIndex={-1}
    aria-label={direction < 0 ? "Scroll options up" : "Scroll options down"} aria-controls={listId} disabled={disabled}
    onPointerEnter={event => { if (event.pointerType === "mouse") onStart(direction); }}
    onPointerLeave={onStop} onPointerCancel={onStop}
    onPointerDown={event => { event.preventDefault(); onStart(direction); }} onPointerUp={onStop}
    onClick={() => onStep(direction)}>{direction < 0 ? <FiChevronUp/> : <FiChevronDown/>}</button>;
}

export function CustomDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select an option",
  disabled = false,
  className = "",
  multiple = false,
  triggerContent,
  menuClassName = "",
  triggerClassName = "",
}: {
  value: string;
  options: CustomDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  multiple?: boolean;
  triggerContent?: ReactNode;
  menuClassName?: string;
  triggerClassName?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number; maxHeight: number } | null>(null);
  const [scrollState, setScrollState] = useState({ overflow: false, up: false, down: false });
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const optionsList = useRef<HTMLDivElement>(null);
  const scrolling = useRef<{ frame: number; direction: number; time: number }>({ frame: 0, direction: 0, time: 0 });
  const listId = useId();
  const labelId = useId();
  const selected = options.find(option => option.value === value);

  const optionCount = options.length;
  const positionMenu = useCallback(() => {
    const box = root.current?.getBoundingClientRect();
    if (box) {
      const width = Math.min(box.width, window.innerWidth - 16);
      const wanted = Math.min(window.innerWidth <= 620 ? 180 : 220, optionCount * 44 + 12);
      const below = window.innerHeight - box.bottom - 14, above = box.top - 14;
      const placeAbove = below < wanted && above > below;
      const height = Math.min(wanted, Math.max(64, placeAbove ? above : below));
      const next = { top: Math.max(8, Math.min(window.innerHeight - height - 8, placeAbove ? box.top - height - 6 : box.bottom + 6)), left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)), width, maxHeight: height };
      setMenuPosition(prior => prior && Object.keys(next).every(key => prior[key as keyof typeof next] === next[key as keyof typeof next]) ? prior : next);
    }
  }, [optionCount]);

  const updateScroll = useCallback(() => {
    const list = optionsList.current; if (!list) return;
    const capacity = menu.current ? parseFloat(menu.current.style.maxHeight) - 12 : list.clientHeight;
    const overflow = (list.firstElementChild?.scrollHeight || list.scrollHeight) > capacity + 1;
    const next = { overflow, up: overflow && list.scrollTop > 1, down: overflow && list.scrollTop + list.clientHeight < list.scrollHeight - 1 };
    setScrollState(prior => prior.overflow === next.overflow && prior.up === next.up && prior.down === next.down ? prior : next);
  }, []);
  const stopScrolling = useCallback(() => {
    cancelAnimationFrame(scrolling.current.frame);
    scrolling.current = { frame: 0, direction: 0, time: 0 };
  }, []);
  const startScrolling = (direction: number) => {
    if (scrolling.current.direction === direction) return;
    stopScrolling(); scrolling.current.direction = direction;
    const step = (time: number) => {
      const list = optionsList.current; if (!list) { stopScrolling(); return; }
      const before = list.scrollTop;
      list.scrollTop += direction * Math.min(32, scrolling.current.time ? time - scrolling.current.time : 16) * .24;
      scrolling.current.time = time; updateScroll();
      if (list.scrollTop === before) { stopScrolling(); return; }
      scrolling.current.frame = requestAnimationFrame(step);
    };
    scrolling.current.frame = requestAnimationFrame(step);
  };
  const focusOption = useCallback((option?: HTMLButtonElement | null) => {
    const list = optionsList.current; if (!option || !list) return;
    option.focus({ preventScroll: true });
    const item = option.getBoundingClientRect(), bounds = list.getBoundingClientRect();
    if (item.top < bounds.top) list.scrollTop += item.top - bounds.top;
    else if (item.bottom > bounds.bottom) list.scrollTop += item.bottom - bounds.bottom;
    updateScroll();
  }, [updateScroll]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    setScrollState({ overflow: false, up: false, down: false });
    positionMenu();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)');
      focusOption(selected || menu.current?.querySelector<HTMLButtonElement>('[role="option"]:not(:disabled)'));
      updateScroll();
    });
    const observer = new ResizeObserver(() => {
      updateScroll();
      // Adding the arrow rows reduces list height; retain visibility of the
      // selected/focused option without moving the document or modal.
      if (optionsList.current?.contains(document.activeElement)) focusOption(document.activeElement as HTMLButtonElement);
    });
    if (optionsList.current) {
      observer.observe(optionsList.current);
      if (optionsList.current.firstElementChild) observer.observe(optionsList.current.firstElementChild);
    }
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); } };
    const reposition = (event: Event) => {
      if (event.target instanceof Node && menu.current?.contains(event.target)) return;
      positionMenu();
    };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    window.addEventListener("pointerup", stopScrolling);
    window.addEventListener("pointercancel", stopScrolling);
    window.addEventListener("blur", stopScrolling);
    return () => {
      cancelAnimationFrame(focusFrame);
      stopScrolling(); observer.disconnect();
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
      window.removeEventListener("pointerup", stopScrolling);
      window.removeEventListener("pointercancel", stopScrolling);
      window.removeEventListener("blur", stopScrolling);
    };
  }, [open, positionMenu, focusOption, updateScroll, stopScrolling]);

  const scrollOnce = (direction: number) => {
    optionsList.current?.scrollBy({ top: direction * 90, behavior: "instant" }); updateScroll();
  };

  const dropdownMenu = open && menuPosition && <div className={`custom-dropdown-menu ${menuClassName}`} ref={menu} style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width, maxHeight: menuPosition.maxHeight }} onKeyDown={event => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('[role="option"]:not(:disabled)') || []);
    if (!items.length) return;
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = items[(current + 1) % items.length];
    else if (event.key === 'ArrowUp') next = items[current < 0 ? items.length - 1 : (current - 1 + items.length) % items.length];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'Tab') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    else if (event.key.length === 1 && event.key !== ' ') next = [...items.slice(current + 1), ...items.slice(0, current + 1)].find(item => item.textContent?.toLowerCase().startsWith(event.key.toLowerCase()));
    if (next) { event.preventDefault(); focusOption(next); }
  }}>
    {scrollState.overflow && <DropdownScrollButton direction={-1} disabled={!scrollState.up} listId={listId} onStart={startScrolling} onStop={stopScrolling} onStep={scrollOnce}/>}
    <div className="custom-dropdown-options" ref={optionsList} id={listId} role="listbox" aria-multiselectable={multiple || undefined} aria-labelledby={labelId} onScroll={updateScroll}>
    <div className="custom-dropdown-options-content">
    {options.map(option => <button
      type="button"
      role="option"
      aria-selected={multiple ? Boolean(option.selected) : option.value === value}
      disabled={option.disabled}
      className={(multiple ? option.selected : option.value === value) ? "selected" : ""}
      key={option.value}
      onClick={() => { onChange(option.value); if (!multiple) { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); } }}
    >{option.content ?? option.label}</button>)}
    </div></div>
    {scrollState.overflow && <DropdownScrollButton direction={1} disabled={!scrollState.down} listId={listId} onStart={startScrolling} onStop={stopScrolling} onStep={scrollOnce}/>}
  </div>;

  return <div className={`custom-dropdown ${open ? "is-open" : ""} ${className}`} ref={root}>
    <span className="custom-dropdown-sr-label" id={labelId}>{ariaLabel}</span>
    <button
      type="button"
      className={`custom-dropdown-trigger ${triggerClassName}`}
      aria-labelledby={labelId}
      aria-haspopup="listbox"
      aria-controls={listId}
      aria-expanded={open}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) toggle(); } }}
    >
      <span>{triggerContent ?? (selected?.label || placeholder)}</span><FiChevronDown />
    </button>
    {dropdownMenu && createPortal(dropdownMenu, document.body)}
  </div>;
}

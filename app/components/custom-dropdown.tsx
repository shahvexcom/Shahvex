"use client";

import { useCallback, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { FiChevronDown } from "react-icons/fi";
import "./custom-dropdown.css";

export type CustomDropdownOption = { value: string; label: string; disabled?: boolean };

export function CustomDropdown({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = "Select an option",
  disabled = false,
  className = "",
}: {
  value: string;
  options: CustomDropdownOption[];
  onChange: (value: string) => void;
  ariaLabel: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ top: number; left: number; width: number } | null>(null);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const listId = useId();
  const labelId = useId();
  const selected = options.find(option => option.value === value);

  const optionCount = options.length;
  const positionMenu = useCallback(() => {
    const box = root.current?.getBoundingClientRect();
    if (box) {
      const width = Math.min(box.width, window.innerWidth - 16);
      const height = Math.min(220, optionCount * 44 + 12);
      setMenuPosition({ top: box.bottom + height + 6 > window.innerHeight && box.top > height ? box.top - height - 6 : box.bottom + 6, left: Math.max(8, Math.min(box.left, window.innerWidth - width - 8)), width });
    }
  }, [optionCount]);

  const toggle = () => {
    if (open) { setOpen(false); return; }
    positionMenu();
    setOpen(true);
  };

  useEffect(() => {
    if (!open) return;
    const focusFrame = requestAnimationFrame(() => {
      const selected = menu.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]:not(:disabled)');
      (selected || menu.current?.querySelector<HTMLButtonElement>('button:not(:disabled)'))?.focus();
    });
    const closeOnOutsideClick = (event: MouseEvent) => {
      if (root.current && !root.current.contains(event.target as Node) && !menu.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); } };
    document.addEventListener("pointerdown", closeOnOutsideClick);
    document.addEventListener("keydown", closeOnEscape);
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      cancelAnimationFrame(focusFrame);
      document.removeEventListener("pointerdown", closeOnOutsideClick);
      document.removeEventListener("keydown", closeOnEscape);
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [open, positionMenu]);

  const dropdownMenu = open && menuPosition && <div className="custom-dropdown-menu" id={listId} role="listbox" aria-labelledby={labelId} ref={menu} style={{ top: menuPosition.top, left: menuPosition.left, width: menuPosition.width }} onKeyDown={event => {
    const items = Array.from(menu.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') || []);
    const current = items.indexOf(document.activeElement as HTMLButtonElement);
    let next: HTMLButtonElement | undefined;
    if (event.key === 'ArrowDown') next = items[(current + 1) % items.length];
    else if (event.key === 'ArrowUp') next = items[(current - 1 + items.length) % items.length];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'Tab') { setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }
    else if (event.key.length === 1 && event.key !== ' ') next = [...items.slice(current + 1), ...items.slice(0, current + 1)].find(item => item.textContent?.toLowerCase().startsWith(event.key.toLowerCase()));
    if (next) { event.preventDefault(); next.focus(); }
  }}>
    {options.map(option => <button
      type="button"
      role="option"
      aria-selected={option.value === value}
      disabled={option.disabled}
      className={option.value === value ? "selected" : ""}
      key={option.value}
      onClick={() => { onChange(option.value); setOpen(false); root.current?.querySelector<HTMLButtonElement>('button')?.focus(); }}
    >{option.label}</button>)}
  </div>;

  return <div className={`custom-dropdown ${open ? "is-open" : ""} ${className}`} ref={root}>
    <span className="custom-dropdown-sr-label" id={labelId}>{ariaLabel}</span>
    <button
      type="button"
      className="custom-dropdown-trigger"
      aria-labelledby={labelId}
      aria-haspopup="listbox"
      aria-controls={listId}
      aria-expanded={open}
      disabled={disabled}
      onClick={toggle}
      onKeyDown={event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); if (!open) toggle(); } }}
    >
      <span>{selected?.label || placeholder}</span><FiChevronDown />
    </button>
    {dropdownMenu && createPortal(dropdownMenu, document.body)}
  </div>;
}

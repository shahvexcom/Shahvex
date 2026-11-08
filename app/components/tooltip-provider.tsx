"use client";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export function TooltipProvider() {
  const id = useId();
  const [active, setActive] = useState<{ target: HTMLElement; text: string } | null>(null);
  const [position, setPosition] = useState({ left: 0, top: 0 });
  const tooltip = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const find = (target: EventTarget | null) => target instanceof Element ? target.closest<HTMLElement>("[data-tooltip]") : null;
    const show = (target: HTMLElement | null) => { const text = target?.dataset.tooltip?.trim(); setActive(target && text ? { target, text } : null); };
    const over = (event: PointerEvent) => { if (event.pointerType !== 'touch') show(find(event.target)); };
    const out = (event: PointerEvent) => { const target = find(event.target); if (target && !(event.relatedTarget instanceof Node && target.contains(event.relatedTarget))) setActive(null); };
    const focus = (event: FocusEvent) => show(find(event.target));
    const close = () => setActive(null);
    const press = (event: PointerEvent) => { if (event.pointerType === 'touch') show(find(event.target)); else close(); };
    const key = (event: KeyboardEvent) => { if (event.key === 'Escape') close(); };
    document.addEventListener('pointerover', over);
    document.addEventListener('pointerout', out);
    document.addEventListener('focusin', focus);
    document.addEventListener('focusout', close);
    document.addEventListener('pointerdown', press, true);
    document.addEventListener('keydown', key);
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    return () => {
      document.removeEventListener('pointerover', over); document.removeEventListener('pointerout', out);
      document.removeEventListener('focusin', focus); document.removeEventListener('focusout', close);
      document.removeEventListener('pointerdown', press, true); document.removeEventListener('keydown', key);
      window.removeEventListener('scroll', close, true); window.removeEventListener('resize', close);
    };
  }, []);
  useLayoutEffect(() => {
    if (!active || !tooltip.current) return;
    const rect = active.target.getBoundingClientRect(), box = tooltip.current.getBoundingClientRect();
    setPosition({ left: Math.max(8, Math.min(rect.left + rect.width / 2 - box.width / 2, window.innerWidth - box.width - 8)), top: Math.max(8, rect.top >= box.height + 12 ? rect.top - box.height - 8 : Math.min(rect.bottom + 8, window.innerHeight - box.height - 8)) });
    const existing = active.target.getAttribute('aria-describedby');
    active.target.setAttribute('aria-describedby', [existing, id].filter(Boolean).join(' '));
    return () => { if (existing) active.target.setAttribute('aria-describedby', existing); else active.target.removeAttribute('aria-describedby'); };
  }, [active, id]);
  return active ? createPortal(<div id={id} role="tooltip" ref={tooltip} className="shahvex-tooltip" style={position}>{active.text}</div>, document.body) : null;
}

"use client";
import { useEffect, useRef, useState } from "react";
import { FiDownload } from "react-icons/fi";

export function ExportMenu({ onExport, disabled=false }: { disabled?:boolean; onExport: (format: "csv" | "xls" | "doc" | "pdf") => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (!open) return;
    const outside = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") { setOpen(false); trigger.current?.focus(); } };
    document.addEventListener("pointerdown", outside, true);
    document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", outside, true); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="shahvex-export" ref={root} onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false); }}>
    <button ref={trigger} disabled={disabled} type="button" aria-expanded={open} aria-haspopup="true" onClick={() => setOpen(!open)}><FiDownload /> Export</button>
    {open && <div className="shahvex-export-options" aria-label="Export formats">
      {([['csv', 'CSV spreadsheet'], ['xls', 'Excel workbook'], ['doc', 'Word document'], ['pdf', 'Print / PDF']] as const).map(([format, label]) => <button key={format} type="button" onClick={() => { setOpen(false); trigger.current?.focus(); onExport(format); }}>{label}</button>)}
    </div>}
  </div>;
}

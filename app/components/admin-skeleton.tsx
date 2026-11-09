import "./admin-skeleton.css";
export function AdminSkeleton({ rows = 4, label = "Loading content", compact = false }: { rows?: number; label?: string; compact?: boolean }) {
  return <div className={`sv-admin-skeleton ${compact ? "is-compact" : ""}`} role="status" aria-label={label} aria-busy="true"><span className="sv-skeleton-heading"/>{Array.from({length:rows},(_,i)=><div key={i}><i/><span/><span/></div>)}</div>;
}

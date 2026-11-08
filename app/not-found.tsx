import Link from "next/link";
import { FiArrowLeft, FiHome, FiSearch } from "react-icons/fi";

export default function NotFound() {
  return (
    <main className="not-found-page">
      <div className="not-found-orbit not-found-orbit-one" />
      <div className="not-found-orbit not-found-orbit-two" />
      <section className="not-found-content" aria-labelledby="not-found-title">
        <div className="not-found-mark" aria-hidden="true">
          <span>4</span>
          <FiSearch />
          <span>4</span>
        </div>
        <p className="not-found-eyebrow">Shahvex · SIGNAL LOST</p>
        <h1 id="not-found-title">This page took a wrong turn.</h1>
        <p className="not-found-copy">
          The page you are looking for does not exist, or it may have moved to a different workspace.
        </p>
        <div className="not-found-actions">
          <Link className="not-found-primary" href="/">
            <FiHome /> Back to workspace
          </Link>
          <Link className="not-found-secondary" href="/login">
            <FiArrowLeft /> Agent login
          </Link>
        </div>
      </section>
    </main>
  );
}

import Link from "next/link";
import { FiArrowUpRight, FiMail, FiPhoneCall } from "react-icons/fi";
import styles from "./public-footer.module.css";

type PublicFooterProps = {
  onLegal: (page: "privacy" | "terms") => void;
  bpoLoggedIn?: boolean;
  authLoading: boolean;
};

export function PublicFooter({ onLegal, bpoLoggedIn = false, authLoading }: PublicFooterProps) {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.main}>
          <div className={styles.brand}>
            <Link href="/" className={styles.logo}>
              <img src="/img/logo.png.png" width="170" height="76" alt="Shahvex"  data-tooltip="" />
            </Link>
            <p>Better conversations.<br />More connected teams.</p>
            <span className={styles.description}>Your people, calls and insights. One workspace.</span>
          </div>
          <nav className={styles.group} aria-label="Footer platform navigation">
            <h2>Platform</h2>
            <a href="#platform">Overview</a>
            <a href="#workflow">How it works</a>
            <a href="#security-overview">Security</a>
            <a href="#about">About us</a>
            <a href="#contact">Contact</a>
          </nav>
          <nav className={styles.group} aria-label="Footer workspace navigation">
            <h2>Your workspace</h2>
            {authLoading ? <div className={styles.workspaceLoading} aria-busy="true"><i /><i /><i /></div> : <>{bpoLoggedIn ? <Link href="/bpo">BPO workspace</Link> : <Link href="/bpo/login">BPO login</Link>}<a href="#bpo">BPO operations</a>{!bpoLoggedIn && <Link href="/bpo/register" className={styles.create}>Create an account <FiArrowUpRight aria-hidden="true" /></Link>}</>}
          </nav>
          <nav className={styles.group} aria-label="Contact information">
            <h2>Contact</h2>
            <a href="mailto:support@Shahvex.com"><FiMail aria-hidden="true" /> support@Shahvex.com</a>
            <a href="tel:+923029333326"><FiPhoneCall aria-hidden="true" /> +92 302 9333326</a>
          </nav>
        </div>
        <div className={styles.bottom}>
          <p>© 2026 Shahvex. All rights reserved.</p>
          <div className={styles.legal}>
            <button type="button" onClick={() => onLegal("privacy")}>Privacy Policy</button>
            <button type="button" onClick={() => onLegal("terms")}>Terms &amp; Conditions</button>
          </div>
          <p className={styles.credit}>Developed by <span className={styles.creditLink}><a href="https://hasaanmumtaz.pro" target="_blank" rel="noopener noreferrer" aria-describedby="developer-preview">Hasaan Mumtaz <FiArrowUpRight aria-hidden="true" /></a><span id="developer-preview" className={styles.preview} role="tooltip"><span className={styles.previewImage}><img src="https://www.hasaanmumtaz.pro/opengraph-image/20261012-photo" width="1200" height="630" loading="lazy" alt="Hasaan Mumtaz portfolio Open Graph image" /></span><b>Hasaan Mumtaz | Full Stack Developer, AI Bots &amp; Modern Web Apps</b><small>Hasaan Mumtaz is a Full Stack Developer working professionally since May 2018, building MERN and MEAN applications, Laravel and Django platforms, AI bots, chat systems, Three.js experiences, Kotlin solutions, Unity VR projects, and SEO-friendly responsive web apps.</small><em>Visit hasaanmumtaz.pro</em></span></span></p>
        </div>
      </div>
    </footer>
  );
}




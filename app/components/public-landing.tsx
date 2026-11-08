"use client";

import { CustomSelect } from "@/app/components/custom-select";
import Link from "next/link";
import { PublicFooter } from "./public-footer";
import { useEffect, useState, type FormEvent } from "react";
import { FiArrowRight, FiBarChart2, FiCheckCircle, FiChevronUp, FiGlobe, FiLock, FiMenu, FiPhoneCall, FiX, FiUsers, FiFileText, FiShield, FiDatabase, FiKey, FiEye, FiMail, FiMessageSquare, FiSend } from "react-icons/fi";


export function PublicLanding() {
  const [showScrollTop, setShowScrollTop] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [legal, setLegal] = useState<"privacy" | "terms" | null>(null);
  const [bpoLoggedIn, setBpoLoggedIn] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const jumpTo = (id: string) => { setMobileNavOpen(false); document.getElementById(id)?.scrollIntoView({ behavior: "smooth" }); };
  useEffect(() => {
    let mounted = true;
    Promise.all([
      fetch("/api/auth/me?portal=bpo").then(response => response.ok ? response.json() : null),
    ])
      .then(([bpo]) => {
        if (!mounted) return;
        setBpoLoggedIn(bpo?.agent?.role === "BPO" && bpo?.agent?.status === "APPROVED");
      })
      .catch(() => undefined)
      .finally(() => { if (mounted) setAuthLoading(false); });
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 280);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <main className="public-landing landing-redesign">
      <header className="public-header-wrap"><div className="public-header">
        <Link href="/" className="public-brand"><img src="/img/logo.png.png" width="170" height="40" alt="Shahvex"  data-tooltip="" /></Link>
        <nav aria-label="Primary navigation">{[["platform", "Platform"], ["workflow", "Workflow"], ["security-overview", "Security"], ["bpo", "BPO"], ["about", "About us"], ["contact", "Contact"]].map(([id, label]) => <a key={id} href={`#${id}`}>{label}</a>)}</nav>
        <button className="public-mobile-menu-toggle" type="button" aria-expanded={mobileNavOpen} onClick={() => setMobileNavOpen(!mobileNavOpen)}>{mobileNavOpen ? <FiX aria-hidden="true" /> : <FiMenu aria-hidden="true" />}</button>
        <div className="public-actions">{bpoLoggedIn ? <Link className="public-register" href="/bpo">Open workspace <FiArrowRight /></Link> : <><Link className="public-login" href="/bpo/login">Log in</Link><Link className="public-register" href="/bpo/register">Create account <FiArrowRight /></Link></>}</div>
      </div>{mobileNavOpen && <nav className="public-mobile-nav" aria-label="Mobile navigation">{[["platform", "Platform"], ["workflow", "Workflow"], ["security-overview", "Security"], ["bpo", "BPO"], ["about", "About us"], ["contact", "Contact"]].map(([id, label]) => <a key={id} href={`#${id}`} onClick={() => jumpTo(id)}>{label}</a>)}<div className="public-mobile-divider" /><div className="public-mobile-actions">{authLoading ? <AuthActionsSkeleton area="mobile" /> : bpoLoggedIn ? <>{bpoLoggedIn && <Link className="public-mobile-workspace" href="/bpo" onClick={() => setMobileNavOpen(false)}>Go to BPO workspace</Link>}</> : <><div className="public-mobile-action-group"><b>Log in</b><Link href="/bpo/login" onClick={() => setMobileNavOpen(false)}>BPO</Link></div><div className="public-mobile-action-group public-mobile-action-primary"><b>Create account</b><Link href="/bpo/register" onClick={() => setMobileNavOpen(false)}>BPO</Link></div></>}</div><div className="public-mobile-legal"><button type="button" onClick={() => { setLegal("terms"); setMobileNavOpen(false); }}>Terms &amp; Conditions</button><button type="button" onClick={() => { setLegal("privacy"); setMobileNavOpen(false); }}>Privacy Policy</button></div></nav>}</header>

      <section className="public-hero">
        <div>
          <p className="public-eyebrow">VOICE OPERATIONS, ORGANISED</p>
          <h1>Better conversations.<br /><span>Bigger possibilities.</span></h1>
          <p className="public-lead">Shahvex brings agent scripts, customer data, live calling, transcripts and follow-up intelligence into one secure operating workspace.</p>
          <div className="public-hero-actions">{authLoading ? <AuthActionsSkeleton area="hero" /> : bpoLoggedIn ? <Link className="public-register" href="/bpo">Go to BPO workspace <FiArrowRight /></Link> : <><Link className="public-register" href="/bpo/register">Create BPO account <FiArrowRight /></Link><Link className="public-text-link" href="/bpo/login">BPO login</Link></>}</div>
          <div className="public-trust"><FiCheckCircle /> Built for structured outbound calling workflows</div>
        </div>
        <div className="hero-workspace" aria-label="Illustrative workspace preview"><div className="hero-workspace-top"><span><img src="/img/icon.png" alt="" /> Your calling workspace</span><small>WORKSPACE PREVIEW</small></div><div className="hero-workspace-body"><div className="hero-preview-sidebar"><FiBarChart2 /><FiPhoneCall /><FiUsers /><FiFileText /><FiShield /></div><div className="hero-preview-content"><div className="hero-preview-heading"><div><small>ONE TEAM. ONE WORKSPACE.</small><h3>Every call, connected.</h3></div><span><i /> Ready to connect</span></div><div className="hero-preview-metrics"><div><FiUsers /><b>Your team</b><small>Voices working together</small></div><div><FiPhoneCall /><b>Your campaigns</b><small>Context for every call</small></div></div><div className="hero-conversation"><div><span className="hero-voice-avatar"><FiPhoneCall /></span><div><strong>A more natural conversation</strong><small>Voice, script and customer context in sync</small></div></div><div className="hero-audio-bars">{Array.from({length:28},(_,i)=><i key={i} style={{height:12+((i*17+11)%46)}} />)}</div><div className="hero-conversation-bottom"><span><FiCheckCircle /> Script connected</span><span><FiFileText /> Transcript ready</span></div></div></div></div><div className="hero-workspace-bottom"><FiShield /><span>Organised. Connected. In your control.</span><FiArrowRight /></div></div>
      </section>

      <section className="public-section public-platform-section" id="platform">
        <div className="platform-heading"><div><p className="public-eyebrow">ONE CONNECTED PLATFORM</p><h2>Everything your calling team needs, in one operational view.</h2></div><p className="public-section-lead">From the first lead import to the final follow-up, every interaction stays connected to the right agent, customer and outcome.</p></div>
        <div className="public-feature-grid"><Feature icon={<FiPhoneCall />} kicker="01 / ENGAGE" title="Real-time calling" text="Run outbound conversations with an AI agent that listens, responds naturally and handles interruptions without losing the script." /><Feature icon={<FiGlobe />} kicker="02 / PERSONALISE" title="Voice-aware conversations" text="Match each campaign with the right voice, language and customer context for a more consistent experience at scale." /><Feature icon={<FiBarChart2 />} kicker="03 / UNDERSTAND" title="Call intelligence" text="Turn every completed call into a usable record with transcripts, summaries, outcomes and recordings ready for follow-up." /></div>
        <div className="platform-proof"><div><span><FiUsers /></span><div><b>Built for shared ownership</b><small>Keep agents, leads and call history aligned across the team.</small></div></div><div><span><FiFileText /></span><div><b>Structured by default</b><small>Scripts, data and outcomes follow the same repeatable process.</small></div></div><div><span><FiShield /></span><div><b>Ready for responsible operations</b><small>Access the information your authorised team members need.</small></div></div><Link className="public-text-link" href="/bpo/register">Explore the workspace <FiArrowRight /></Link></div>
      </section>

      <section className="public-new-section public-security-details" id="security-overview"><div className="new-section-heading"><p className="public-eyebrow">SECURITY YOU CAN OPERATE WITH</p><h2>Built to keep every conversation protected.</h2><p>Security is part of the calling workflow from sign-in to stored call records, so your team can move quickly without losing control of sensitive information.</p></div><div className="security-card-grid"><SecurityCard icon={<FiDatabase />} title="Data encryption" text="Protect account, lead and call information with encrypted data handling across the platform." /><SecurityCard icon={<FiLock />} title="Secure calls" text="Keep live voice operations inside an authenticated workspace with controlled provider access." /><SecurityCard icon={<FiEye />} title="Privacy controls" text="Give authorised team members access to the call information they need for their role." /><SecurityCard icon={<FiKey />} title="Authentication" text="Secure sign-in and role-based access keep your operations and administration organised." /><SecurityCard icon={<FiCheckCircle />} title="Compliance-ready" text="Maintain consistent scripts, records and operational history to support responsible processes." /></div></section>


      <section className="public-workflow" id="workflow"><div className="workflow-intro"><p className="public-eyebrow">A CLEAR OPERATIONAL FLOW</p><h2>Turn every campaign into a repeatable calling system.</h2><p>Prepare the right context, run conversations with confidence, and give your team a complete record to act on after every call.</p>{authLoading ? <span className="workflow-cta public-auth-skeleton public-auth-skeleton-workflow" aria-hidden="true" /> : <Link className="workflow-cta" href={bpoLoggedIn ? "/bpo" : "/bpo/register"}>{bpoLoggedIn ? "Go to BPO workspace" : "Create BPO account"}</Link>}</div><ol><li><span>01</span><div><b>Prepare the calling context</b><p>Bring together the approved lead list, agent script, voice profile and campaign rules before a call begins.</p></div><strong>Ready</strong></li><li><span>02</span><div><b>Run and monitor calls</b><p>Follow live call state, customer speech and AI responses from one focused workspace.</p></div><strong>Live</strong></li><li><span>03</span><div><b>Keep the full record</b><p>Review the transcript, summary, outcome and recording so follow-up is always informed.</p></div><strong>Review</strong></li></ol></section>

      <section className="public-security" id="security-legacy"><div className="security-icon"><FiLock /></div><div><p className="public-eyebrow">SECURE BY DESIGN</p><h2>Your calling credentials stay on the server.</h2><p>Provider credentials are handled server-side, while authorised team members access the call information they need through their workspace.</p></div><Link className="public-register" href="/bpo/register">Get started <FiArrowRight /></Link></section>
      <section className="public-anchor-section public-bpo-section" id="bpo"><div className="bpo-copy"><p className="public-eyebrow">BPO OPERATIONS</p><h2>One command centre for every client campaign.</h2><p>Coordinate agents, lead lists and live outbound activity from a workspace designed for high-volume BPO operations. Keep delivery visible, consistent and accountable from first call to final outcome.</p><div className="bpo-points"><span>Organise multiple client campaigns</span><span>Monitor agent activity in real time</span><span>Keep call records ready for follow-up</span></div><div className="bpo-actions">{authLoading ? <AuthActionsSkeleton area="bpo" /> : bpoLoggedIn ? <Link className="bpo-login-btn" href="/bpo">BPO workspace <FiArrowRight /></Link> : <><Link className="bpo-login-btn" href="/bpo/login">Log in to BPO</Link><Link className="bpo-register-btn" href="/bpo/register">Create BPO account</Link></>}</div></div><div className="bpo-visual"><div className="bpo-visual-head"><span><i /> BPO workspace</span><b>LIVE</b></div><div className="bpo-metric"><strong>24</strong><span>Active agents</span><em>+12%</em></div><div className="bpo-progress"><div><span>Campaign delivery</span><b>86%</b></div><i><span /></i></div><div className="bpo-mini-row"><span>Client operations</span><b>12 running</b></div><div className="bpo-mini-row"><span>Calls completed today</span><b>1,248</b></div></div></section>
      <section className="public-anchor-section public-about-section" id="about"><div className="about-heading"><p className="public-eyebrow">ABOUT Shahvex</p><h2>Making outbound conversations easier to run, measure and improve.</h2><p>Shahvex is a voice operations platform for teams that want the speed of AI with the structure of a dependable workflow. We connect the people, data and conversations behind every campaign.</p></div><div className="about-values"><article><span>01</span><h3>Clarity over complexity</h3><p>Every call should have a clear purpose, context and next step.</p></article><article><span>02</span><h3>Built for real teams</h3><p>Give agents and operators a shared view of the work that matters.</p></article><article><span>03</span><h3>Progress you can see</h3><p>Turn conversations into records your team can learn from and act on.</p></article></div></section>
      <ContactSection />
      <PublicFooter onLegal={setLegal} bpoLoggedIn={bpoLoggedIn} authLoading={authLoading} />
      <div className="public-floating-tools" aria-label="Quick actions"><button type="button" className={`public-scroll-top ${showScrollTop ? "visible" : ""}`} aria-label="Scroll to top" onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}><FiChevronUp /></button></div>
      {legal && <LegalModal legal={legal} onClose={() => setLegal(null)} />}
      {legal && <div className="legal-modal-backdrop" role="presentation" onClick={() => setLegal(null)}><section className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="landing-legal-title" onClick={(event) => event.stopPropagation()}><button className="legal-modal-close" type="button" onClick={() => setLegal(null)} aria-label="Close">×</button><p className="public-eyebrow">Shahvex</p><h2 id="landing-legal-title">{legal === "privacy" ? "Privacy Policy" : "Terms & Conditions"}</h2>{legal === "privacy" ? <><p>Shahvex collects the information you provide, such as your name, email, phone number and account details, to create and secure your workspace.</p><p>Your information is used to provide voice operations, protect accounts and improve the service. We do not sell personal information.</p></> : <><p>By using Shahvex, you agree to provide accurate account information and keep your login credentials secure.</p><p>Use the platform lawfully and only for authorised calling operations. Shahvex may review or suspend accounts that misuse the service.</p></>}</section></div>}
    </main>
  );
}

function AuthActionsSkeleton({ area }: { area: "header" | "hero" | "bpo" | "mobile" }) {
  if (area === "mobile") return <div className="public-mobile-auth-skeleton" aria-busy="true"><span /><span /></div>;
  return <div className={`public-auth-skeleton-group public-auth-skeleton-${area}`} aria-busy="true"><span /><span /></div>;
}


function LegalModal({ legal, onClose }: { legal: "privacy" | "terms"; onClose: () => void }) {
  const terms = legal === "terms";
  return <div className="legal-modal-backdrop" role="presentation" onClick={onClose}><section className="legal-modal" role="dialog" aria-modal="true" aria-labelledby="enhanced-legal-title" onClick={event => event.stopPropagation()}><div className="legal-modal-head"><div><p className="public-eyebrow">Shahvex · POLICY CENTRE</p><h2 id="enhanced-legal-title">{terms ? "Terms & Conditions" : "Privacy Policy"}</h2><span>Last updated September 2026</span></div><button className="legal-modal-close" type="button" onClick={onClose} aria-label="Close policy">×</button></div><div className="legal-modal-body"><div className="legal-highlight"><b>{terms ? "Use the platform responsibly" : "Your privacy, clearly explained"}</b><span>{terms ? "These guidelines keep calling operations safe and clear for every team." : "We protect your account and calling data while operating your workspace."}</span></div>{terms ? <><h3>1. Your account</h3><p>Provide accurate information and keep your login credentials secure. You are responsible for activity in your workspace.</p><h3>2. Calling operations</h3><p>Use Shahvex only for lawful, authorised communications and follow applicable consent, privacy and recording requirements.</p><h3>3. Your content</h3><p>You remain responsible for scripts, lead lists and instructions. Only upload information you are permitted to use.</p><h3>4. Platform access</h3><p>We may review or suspend access when an account is misused or violates these terms.</p><h3>5. Need help?</h3><p>Contact your workspace administrator for questions about these terms.</p></> : <><h3>Information we collect</h3><p>We collect details you provide, including your name, email, phone number, scripts, leads and call records.</p><h3>How we use information</h3><p>We use information to provide voice operations, secure accounts, connect authorised agents and improve the service. We do not sell personal information.</p><h3>Your choices</h3><p>Keep your details accurate and contact your workspace administrator if you need help accessing or correcting information.</p></>}</div><div className="legal-modal-foot"><span>Use Shahvex responsibly and keep your workspace secure.</span><button type="button" onClick={onClose}>Got it</button></div></section></div>;
}

function Feature({ icon, kicker, title, text }: { icon: React.ReactNode; kicker: string; title: string; text: string }) { return <article className="feature-card"><span>{icon}</span><small className="feature-kicker">{kicker}</small><h3>{title}</h3><p>{text}</p></article>; }
function SecurityCard({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) { return <article className="security-detail-card"><span>{icon}</span><div><h3>{title}</h3><p>{text}</p></div></article>; }

function ContactSection() {
  const [status, setStatus] = useState<"idle" | "sending" | "success" | "error">("idle");
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("sending");
    setMessage("");
    const form = event.currentTarget;
    const data = Object.fromEntries(new FormData(form));
    try {
      const response = await fetch("/api/contact", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.message || "Unable to send your message.");
      form.reset();
      setStatus("success");
      setMessage("Thanks — your message has been sent. Check your inbox for confirmation.");
    } catch (error) {
      setStatus("error");
      setMessage(error instanceof Error ? error.message : "Unable to send your message. Please try again.");
    }
  }

  return <section className="public-contact-section" id="contact">
    <div className="public-contact-copy"><p className="public-eyebrow">LET&apos;S TALK</p><h2>Ready to improve your calling operation?</h2><p>Tell us what your team needs. We&apos;ll help you understand how Shahvex can fit your agents, campaigns and workflow.</p><div className="public-contact-direct"><a href="mailto:support@Shahvex.com"><FiMail /><span><small>Email us</small><b>support@Shahvex.com</b></span></a><a href="tel:+923029333326"><FiPhoneCall /><span><small>Call us</small><b>+92 302 9333326</b></span></a></div><div className="public-contact-points"><span><FiMessageSquare /><b>Talk to a real person</b><small>Get practical answers for your use case.</small></span><span><FiUsers /><b>Built around your team</b><small>Discuss agents, campaigns and BPO requirements.</small></span><span><FiMail /><b>Fast follow-up</b><small>We&apos;ll reply to the email address you provide.</small></span></div></div>
    <form className="public-contact-form" onSubmit={submit}>
      <div className="public-contact-form-head"><span>Contact our team</span><small>All fields marked * are required</small></div>
      <div className="public-contact-grid"><label>Full name *<input name="name" type="text" autoComplete="name" placeholder="Your name" minLength={2} maxLength={80} required /></label><label>Work email *<input name="email" type="email" autoComplete="email" placeholder="you@company.com" maxLength={160} required /></label><label>Company<input name="company" type="text" autoComplete="organization" placeholder="Company name" maxLength={120} /></label><label>Phone number<input name="phone" type="tel" autoComplete="tel" placeholder="+92 300 0000000" maxLength={40} /></label></div>
      <label>How can we help? *<CustomSelect name="subject" defaultValue="" required><option value="" disabled>Select an enquiry</option><option value="Product demo">Book a product demo</option><option value="BPO operations">BPO operations</option><option value="Pricing and plans">Pricing and plans</option><option value="Technical question">Technical question</option><option value="Other enquiry">Other enquiry</option></CustomSelect></label>
      <label>Message *<textarea name="message" placeholder="Tell us about your team and what you would like to achieve..." minLength={10} maxLength={2000} rows={5} required /></label>
      <label className="public-contact-honeypot" aria-hidden="true">Website<input name="website" type="text" tabIndex={-1} autoComplete="off" /></label>
      <button type="submit" disabled={status === "sending"}>{status === "sending" ? "Sending..." : <>Send message <FiSend /></>}</button>
      {message && <p className={`public-contact-status ${status}`} role="status">{status === "success" && <FiCheckCircle />}{message}</p>}
      <small className="public-contact-privacy">By submitting this form, you agree that we may contact you about your enquiry.</small>
    </form>
  </section>;
}






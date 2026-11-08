import { SignOutButton } from "@/app/components/sign-out-button";
import { FiSlash } from "react-icons/fi";

export const metadata = { title: "BPO access unavailable", robots: { index: false, follow: false } };

export default function BpoBlockedPage() {
  return <main className="controller-login">
    <section className="controller-login-card">
      <div className="controller-lock"><FiSlash /></div>
      <p>Shahvex · BPO ACCESS</p>
      <h1>Account access unavailable</h1>
      <span>Your account has been blocked or removed. Check your email for details, or contact support if you believe this is a mistake.</span>
      <SignOutButton portal="bpo" className="controller-submit">Return to sign in</SignOutButton>
    </section>
  </main>;
}

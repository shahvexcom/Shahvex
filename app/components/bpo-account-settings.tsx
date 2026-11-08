"use client";

import { useState } from "react";
import { FiCamera, FiEye, FiEyeOff, FiKey, FiUser } from "react-icons/fi";
import toast from "react-hot-toast";
import BpoTwoFactorCard from "./bpo-two-factor-card";

type Profile = {
  name: string;
  email: string;
  username: string;
  avatar_url: string;
  two_factor_enabled: boolean;
};

export default function BpoAccountSettings({ initial, onUserUpdated }: { initial: Profile; onUserUpdated?: (profile: Profile) => void }) {
  const [profile, setProfile] = useState(initial);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showCurrentPassword, setShowCurrentPassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const updateProfile = (next: Profile) => {
    setProfile(next);
    onUserUpdated?.(next);
  };

  const upload = async (file?: File) => {
    if (!file) return;
    if (file.size > 5_242_880) {
      toast.error("Avatar must be 5 MB or smaller.");
      return;
    }

    setUploading(true);
    try {
      const body = new FormData();
      body.append("avatar", file);
      const response = await fetch("/api/upload/avatar", { method: "POST", body });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      const saved = await fetch("/api/bpo/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "profile", avatar_url: data.url }),
      });
      if (!saved.ok) throw new Error((await saved.json()).message);

      updateProfile({ ...profile, avatar_url: data.url });
      toast.success("Avatar updated successfully.");
    } catch (error) {
      toast.error((error as Error).message);
    } finally {
      setUploading(false);
    }
  };

  const changePassword = async () => {
    setSaving(true);
    try {
      const response = await fetch("/api/bpo/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "profile", currentPassword, newPassword }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      toast.success("Password changed. Please sign in again.");
      await fetch("/api/auth/logout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ portal: "bpo" }),
      });
      window.location.assign("/bpo/login");
    } catch (error) {
      toast.error((error as Error).message);
      setSaving(false);
    }
  };

  const updateTwoFactor = (twoFactorEnabled: boolean) => {
    updateProfile({ ...profile, two_factor_enabled: twoFactorEnabled });
  };

  return (
    <main className="bpo-account">
      <div className="bpo-heading">
        <div>
          <p className="bpo-eyebrow">ACCOUNT SETTINGS</p>
          <h1>Your account</h1>
          <p>Manage your profile, password and sign-in security.</p>
        </div>
      </div>

      <section className="bpo-account-grid">
        <article className="bpo-account-card profile-card">
          <div className="bpo-account-avatar">
            {profile.avatar_url ? <img src={profile.avatar_url} alt="" /> : <span>{profile.name.slice(0, 2).toUpperCase()}</span>}
          </div>
          <label className={uploading ? "bpo-avatar-button is-disabled" : "bpo-avatar-button"}>
            <FiCamera /> {uploading ? "Uploading avatar…" : "Change avatar"}
            <input type="file" accept="image/*" disabled={uploading} onChange={(event) => upload(event.target.files?.[0])} />
          </label>
          <small>{uploading ? "Saving avatar…" : "JPG, PNG or WebP · max 5 MB"}</small>
          <h2>{profile.name}</h2>
          <span className="bpo-account-role">BPO account</span>
        </article>

        <article className="bpo-account-card">
          <h2><FiUser /> Profile information</h2>
          <p className="bpo-card-note">These details are managed by your workspace administrator.</p>
          <label>Full name<input value={profile.name} readOnly /></label>
          <label>Email<input value={profile.email || "Not provided"} readOnly /></label>
          <label>Username<input value={`@${profile.username}`} readOnly /></label>
        </article>

        <article className="bpo-account-card">
          <h2><FiKey /> Change password</h2>
          <p className="bpo-card-note">Your current password is required.</p>
          <label>Current password
            <span className="bpo-password-wrap">
              <input type={showCurrentPassword ? "text" : "password"} value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} />
              <button type="button" onClick={() => setShowCurrentPassword(!showCurrentPassword)}>{showCurrentPassword ? <FiEyeOff /> : <FiEye />}</button>
            </span>
          </label>
          <label>New password
            <span className="bpo-password-wrap">
              <input type={showNewPassword ? "text" : "password"} value={newPassword} onChange={(event) => setNewPassword(event.target.value)} />
              <button type="button" onClick={() => setShowNewPassword(!showNewPassword)}>{showNewPassword ? <FiEyeOff /> : <FiEye />}</button>
            </span>
          </label>
          <button className="bpo-settings-primary" type="button" disabled={saving || !currentPassword || !newPassword} onClick={changePassword}>
            {saving ? "Updating password…" : "Update password"}
          </button>
        </article>

        <BpoTwoFactorCard enabled={profile.two_factor_enabled} onStatusChange={updateTwoFactor} />
      </section>
    </main>
  );
}

"use client";
import { useEffect, useState } from "react";
import {
  FiArchive,
  FiCamera,
  FiChevronDown,
  FiEdit2,
  FiEye,
  FiEyeOff,
  FiImage,
  FiShield,
  FiTrash2,
  FiUserPlus,
  FiUsers,
} from "react-icons/fi";
type Profile = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar_url: string;
  admin_role: string;
};
type Role = { id: string; name: string; permissions: string[] };
type Admin = {
  id: string;
  name: string;
  username: string;
  email: string;
  avatar_url: string;
  admin_role: string;
};
type Data = {
  profile: Profile;
  isSuperAdmin: boolean;
  roles: Role[];
  admins: Admin[];
  preferences: {
    notifications_enabled: boolean;
    interface_sounds_enabled: boolean;
    background_sound_enabled: boolean;
  };
  kpis: {
    roles: number;
    sub_admins: number;
    avatars: number;
    created_this_month: number;
  } | null;
};
const pages = ["dashboard", "quickdial", "agents", "scripts", "documents", "credentials", "queue", "reports", "live", "settings"],
  blank = {
    name: "",
    username: "",
    email: "",
    avatar_url: "",
    password: "",
    roleName: "",
  };
export function AdminSettings({ onAction }: { onAction: (m: string) => void }) {
  const [data, setData] = useState<Data | null>(null),
    [profile, setProfile] = useState({ name: "", username: "", email: "", avatar_url: "" }),
    [tab, setTab] = useState<"profile" | "rabc" | "preferences">("profile"),
    [busy, setBusy] = useState(false),
    [role, setRole] = useState({
      id: "",
      name: "",
      permissions: [] as string[],
    }),
    [admin, setAdmin] = useState({ ...blank, id: "" }),
    [edit, setEdit] = useState(false),
    [roleOpen, setRoleOpen] = useState(false),
    [confirm, setConfirm] = useState<{
      type: "role" | "admin";
      id: string;
      name: string;
    } | null>(null);
  const load = () =>
    fetch("/api/admin/settings")
      .then((r) => (r.ok ? r.json() : Promise.reject()))
      .then((next: Data) => { setData(next); window.dispatchEvent(new CustomEvent("admin-profile-updated", { detail: next.profile })); setProfile({ name: next.profile.name ?? "", username: next.profile.username ?? "", email: next.profile.email ?? "", avatar_url: next.profile.avatar_url ?? "" }); })
      .catch(() => onAction("Unable to load settings."));
  useEffect(() => {
    load();
  }, []);
  const send = async (body: object, method = "POST") => {
    let url = "/api/admin/settings";
    if (method.startsWith("DELETE?")) {
      url += method.slice(6);
      method = "DELETE";
    }
    setBusy(true);
    try {
      const r = await fetch(url, {
          method,
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        }),
        d = await r.json();
      if (!r.ok) throw Error(d.message);
      onAction(d.message);
      await load();
      return true;
    } catch (e) {
      onAction(e instanceof Error ? e.message : "Unable to save changes.");
      return false;
    } finally {
      setBusy(false);
    }
  };
  const upload = async (file?: File) => {
    if (!file) return;
    const previous = admin.avatar_url;
    setAdmin((a) => ({ ...a, avatar_url: URL.createObjectURL(file) }));
    setBusy(true);
    const f = new FormData();
    f.append("avatar", file);
    try {
      const r = await fetch("/api/upload/avatar", { method: "POST", body: f }),
        d = await r.json();
      if (!r.ok) throw Error(d.message);
      setAdmin((a) => ({ ...a, avatar_url: d.url }));
      onAction("Avatar uploaded.");
    } catch (e) {
      setAdmin((a) => ({ ...a, avatar_url: previous }));
      onAction(e instanceof Error ? e.message : "Avatar upload failed.");
    } finally {
      setBusy(false);
    }
  };
  const uploadProfile = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    const f = new FormData();
    f.append("avatar", file);
    try {
      const r = await fetch("/api/upload/avatar", { method: "POST", body: f });
      const d = await r.json();
      if (!r.ok) throw Error(d.message);
      setProfile((current) => ({ ...current, avatar_url: d.url }));
      onAction("Avatar uploaded. Save changes to update your profile.");
    } catch (e) { onAction(e instanceof Error ? e.message : "Avatar upload failed."); }
    finally { setBusy(false); }
  };
  if (!data)
    return (
      <>
        <div className="settings-skeleton heading" />
        <div className="settings-kpis skeleton-kpis">
          {[1, 2, 3, 4].map((x) => (
            <div className="settings-skeleton" key={x} />
          ))}
        </div>
        <div className="settings-skeleton settings-page-skeleton" />
      </>
    );
  const p = data.profile,
    superAdmin = data.isSuperAdmin,
    toggle = (x: string) =>
      setRole((r) => ({
        ...r,
        permissions: r.permissions.includes(x)
          ? r.permissions.filter((y) => y !== x)
          : [...r.permissions, x],
      }));
  return (
    <>
      <div className="admin-page-head">
        <div>
          <p>CONTROL CENTER</p>
          <h1>Settings</h1>
        </div>
      </div>
      {superAdmin && (
        <div className="settings-kpis">
          <Kpi
            icon={<FiShield />}
            label="Created roles"
            value={data.kpis?.roles ?? 0}
          />
          <Kpi
            icon={<FiUsers />}
            label="Sub-admins"
            value={data.kpis?.sub_admins ?? 0}
          />
          <Kpi
            icon={<FiImage />}
            label="Avatar profiles"
            value={data.kpis?.avatars ?? 0}
          />
          <Kpi
            icon={<FiUserPlus />}
            label="Added this month"
            value={data.kpis?.created_this_month ?? 0}
          />
        </div>
      )}
      <div className="settings-tabs">
        <button
          className={tab === "profile" ? "active" : ""}
          onClick={() => setTab("profile")}
        >
          <FiUsers /> Profile
        </button>
        {superAdmin && (
          <>
            <button
              className={tab === "rabc" ? "active" : ""}
              onClick={() => setTab("rabc")}
            >
              <FiShield /> Roles &amp; access
            </button>
            <button
              className={tab === "preferences" ? "active" : ""}
              onClick={() => setTab("preferences")}
            >
              <FiArchive /> Preferences
            </button>
          </>
        )}
      </div>
      {tab === "profile" && (
        <form
          className="admin-card settings-card settings-wide settings-profile"
          action={async (f) => {
            await send({
              action: "profile",
              name: profile.name,
              username: profile.username,
              email: profile.email,
              avatar_url: profile.avatar_url,
              currentPassword: String(f.get("currentPassword") ?? ""),
              newPassword: String(f.get("newPassword") ?? ""),
            });
          }}
        >
          <div className="settings-profile-heading"><span><FiUsers /></span><div><small>YOUR ACCOUNT</small><h2>Admin profile</h2></div></div>
          <p>
            {superAdmin
              ? "Update your account details and avatar."
              : "Your profile is view-only. Only the super admin can make changes."}
          </p>
          <div className="settings-avatar-row">
            <div className="settings-avatar-upload">
              {profile.avatar_url ? <img src={profile.avatar_url} alt="Admin profile" /> : <b>{(profile.name || "Admin").split(" ").map(part => part[0]).join("").slice(0,2)}</b>}
              {superAdmin && <label className="settings-camera" data-tooltip="Change profile photo"><FiCamera /><input type="file" accept="image/*" disabled={busy} aria-label="Upload profile photo" onChange={event => { void uploadProfile(event.target.files?.[0]); event.target.value = ""; }} /></label>}
            </div>
            <div>
              <strong>{p.name}</strong>
              <small>
                {p.admin_role === "SUPER_ADMIN" ? "Super admin" : p.admin_role}
              </small>
            </div>
          </div>
          <div className="settings-group-title"><h3>Personal details</h3><p>Manage how you appear across your workspace.</p></div>

          <label>
            Display name
            <input name="name" value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} disabled={!superAdmin} />
          </label>
          <label>
            Username
            <input name="username" value={profile.username} onChange={(e) => setProfile({ ...profile, username: e.target.value })} disabled={!superAdmin} />
          </label>
          <label>
            Email address
            <input
              name="email"
              type="email"
              value={profile.email}
              onChange={(e) => setProfile({ ...profile, email: e.target.value })}
              disabled={!superAdmin}
            />
          </label>
          {superAdmin && (
            <>
              <div className="settings-group-title"><h3><FiShield /> Password &amp; security</h3><p>Enter your current password only when setting a new one.</p></div>
              <Password label="Current password" name="currentPassword" />
              <Password
                label="New password"
                name="newPassword"
                hint="leave blank to keep current"
              />
              <button className="admin-primary" disabled={busy}>
                Save changes
              </button>
            </>
          )}
        </form>
      )}
      {tab === "preferences" && (
        <section className="admin-card settings-card settings-wide settings-preferences">
          <h2>Notification & preferences</h2>
          <p>Choose how the control center alerts you.</p>
          {(
            [
              [
                "Notifications",
                "notifications_enabled",
                "Show incoming control center notifications",
              ],
              [
                "Background sound",
                "background_sound_enabled",
                "Enable background audio in the control center",
              ],
            ] as const
          ).map(([l, k, t]) => (
            <Switch
              key={k}
              label={l}
              text={t}
              value={data.preferences[k]}
              onChange={(v) => {
                const n = { ...data.preferences, [k]: v };
                setData({ ...data, preferences: n });
                if (k === "background_sound_enabled" && typeof window !== "undefined") {
                  localStorage.setItem("admin-background-sound", String(v));
                  window.dispatchEvent(new Event("admin-background-sound-change"));
                }
                send({
                  action: "preferences",
                  notificationsEnabled: n.notifications_enabled,
                  interfaceSoundsEnabled: n.interface_sounds_enabled,
                  backgroundSoundEnabled: n.background_sound_enabled,
                });
              }}
            />
          ))}
        </section>
      )}
      {tab === "rabc" && (
        <div className="settings-rabc">
          <section className="admin-card settings-card">
            <div className="settings-section-title">
              <div>
                <h2>{role.id ? "Edit role" : "Create role"}</h2>
                <p>Assign the pages this role may access.</p>
              </div>
              <FiShield />
            </div>
            <label>
              Role name
              <input
                value={role.name}
                onChange={(e) => setRole({ ...role, name: e.target.value })}
              />
            </label>
            <div className="permission-list">
              {pages.map((x) => (
                <Switch
                  key={x}
                  label={x === "credentials" ? "AI Credentials" : x === "quickdial" ? "Quick Dial" : x.replace(/\b\w/g, (letter) => letter.toUpperCase())}
                  text=""
                  value={role.permissions.includes(x)}
                  onChange={() => toggle(x)}
                />
              ))}
            </div>
            <button
              type="button"
              className="admin-primary"
              disabled={busy}
              onClick={async () => {
                if (
                  await send(
                    role.id
                      ? { action: "role-update", ...role }
                      : {
                          action: "role",
                          name: role.name,
                          permissions: role.permissions,
                        },
                  )
                )
                  setRole({ id: "", name: "", permissions: [] });
              }}
            >
              {role.id ? "Update role" : "Create role"}
            </button>
          </section>
          <section className="admin-card settings-card">
            <div className="settings-section-title">
              <div>
                <h2>{edit ? "Edit sub-admin" : "Create sub-admin"}</h2>
                <p>Avatar, name, password and role are required.</p>
              </div>
              <FiUserPlus />
            </div>
            <label>
              Avatar
              <input
                type="file"
                accept="image/*"
                onChange={(e) => upload(e.target.files?.[0])}
              />
            </label>
            {admin.avatar_url && (
              <img
                className="subadmin-avatar-preview"
                src={admin.avatar_url}
                alt=""
              />
            )}
            <label>
              Name
              <input
                value={admin.name}
                onChange={(e) => setAdmin({ ...admin, name: e.target.value })}
              />
            </label>
            <label>
              Username
              <input
                value={admin.username}
                onChange={(e) =>
                  setAdmin({ ...admin, username: e.target.value })
                }
              />
            </label>
            <label>
              Email <small>(optional)</small>
              <input
                type="email"
                value={admin.email}
                onChange={(e) => setAdmin({ ...admin, email: e.target.value })}
              />
            </label>
            <Password
              label={edit ? "New password (optional)" : "Password"}
              value={admin.password}
              onChange={(v) => setAdmin({ ...admin, password: v })}
            />
            <div className="custom-role-select">
              <span>Role</span>
              <button
                type="button"
                className={roleOpen ? "open" : ""}
                onClick={() => setRoleOpen(!roleOpen)}
              >
                {admin.roleName || "Select role"}
                <FiChevronDown />
              </button>
              {roleOpen && (
                <div>
                  {data.roles.map((r) => (
                    <button
                      type="button"
                      key={r.id}
                      onClick={() => {
                        setAdmin({ ...admin, roleName: r.name });
                        setRoleOpen(false);
                      }}
                    >
                      {r.name}
                      <small>{r.permissions.join(", ")}</small>
                    </button>
                  ))}
                </div>
              )}
            </div>
            <button
              type="button"
              className="admin-primary"
              disabled={
                busy ||
                !admin.avatar_url ||
                !admin.name ||
                (!admin.password && !edit) ||
                !admin.roleName
              }
              onClick={async () => {
                if (
                  await send({
                    action: edit ? "admin-update" : "admin",
                    ...admin,
                  })
                ) {
                  setAdmin({ ...blank, id: "" });
                  setEdit(false);
                }
              }}
            >
              {edit ? "Save sub-admin" : "Create sub-admin"}
            </button>
            {edit && (
              <button
                type="button"
                className="admin-outline"
                onClick={() => {
                  setAdmin({ ...blank, id: "" });
                  setEdit(false);
                  setRoleOpen(false);
                }}
              >
                Cancel
              </button>
            )}
          </section>
          <List
            title="Roles"
            items={data.roles}
            onEdit={(r) => setRole(r)}
            onDelete={(r) =>
              setConfirm({ type: "role", id: r.id, name: r.name })
            }
          />
          <List
            title="Sub-admins"
            items={data.admins}
            onEdit={(a) => {
              setAdmin({
                id: a.id,
                name: a.name ?? "",
                username: a.username ?? "",
                email: a.email ?? "",
                avatar_url: a.avatar_url ?? "",
                password: "",
                roleName: a.admin_role ?? "",
              });
              setEdit(true);
            }}
            onDelete={(a) =>
              setConfirm({ type: "admin", id: a.id, name: a.name })
            }
          />
        </div>
      )}
      {confirm && (
        <div className="settings-confirm">
          <div>
            <FiArchive />
            <h2>Delete {confirm.type === "role" ? "role" : "sub-admin"}?</h2>
            <p>
              Are you sure you want to delete {confirm.name}? This cannot be
              undone.
            </p>
            <button disabled={busy} onClick={() => setConfirm(null)}>Cancel</button>
            <button
              className="danger"
              disabled={busy}
              onClick={async () => {
                if (
                  await send(
                    {},
                    `DELETE?${confirm.type === "role" ? "roleId" : "adminId"}=${encodeURIComponent(confirm.id)}`,
                  )
                )
                  setConfirm(null);
              }}
            >
              {busy ? "Deleting..." : "Delete"}
            </button>
          </div>
        </div>
      )}
    </>
  );
}
function Password({
  name,
  label,
  hint,
  value,
  onChange,
}: {
  name?: string;
  label: string;
  hint?: string;
  value?: string;
  onChange?: (v: string) => void;
}) {
  const [show, setShow] = useState(false);
  const [localValue, setLocalValue] = useState("");
  return (
    <label className="settings-password">
      {label} {hint && <small>({hint})</small>}
      <span>
        <input
          name={name}
          value={value ?? localValue}
          onChange={(e) => { setLocalValue(e.target.value); onChange?.(e.target.value); }}
          placeholder={name === "currentPassword" ? "Enter current password" : name === "newPassword" ? "Enter new password" : "Enter password"}
          type={show ? "text" : "password"}
          minLength={name === "newPassword" ? 8 : undefined}
        />
        <button
          type="button"
          onClick={() => setShow(!show)}
          aria-label={show ? "Hide password" : "Show password"}
        >
          {show ? <FiEyeOff /> : <FiEye />}
        </button>
      </span>
    </label>
  );
}
function Switch({
  label,
  text,
  value,
  onChange,
}: {
  label: string;
  text: string;
  value: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <div className="setting-switch">
      <span>
        <b>{label}</b>
        {text && <small>{text}</small>}
      </span>
      <button
        type="button"
        role="switch"
        aria-label={label}
        aria-checked={value}
        className={value ? "on" : ""}
        onClick={(event) => {
          event.preventDefault();
          onChange(!value);
        }}
      >
        <i />
      </button>
    </div>
  );
}
function Kpi({
  icon,
  label,
  value,
}: {
  icon: React.ReactNode;
  label: string;
  value: number;
}) {
  return (
    <section className="admin-stat">
      <span>{icon}</span>
      <p>{label}</p>
      <strong>{value}</strong>
    </section>
  );
}
function List<T extends Role | Admin>({
  title,
  items,
  onEdit,
  onDelete,
}: {
  title: string;
  items: T[];
  onEdit: (x: T) => void;
  onDelete: (x: T) => void;
}) {
  return (
    <section className="admin-card settings-card settings-list">
      <h2>{title}</h2>
      {!items.length ? <div className="settings-list-empty"><FiUsers /><span>No {title.toLowerCase()} available yet.</span></div> : items.map((x) => (
        <div key={x.id}>
          {"avatar_url" in x && (x.avatar_url ? <img className="settings-list-avatar" src={x.avatar_url} alt="" /> : <i className="settings-list-avatar settings-list-initials">{x.name.slice(0, 2).toUpperCase()}</i>)}
          <span>
            <b>{x.name}</b>
            <small>
              {"permissions" in x ? x.permissions.join(", ") : x.admin_role}
            </small>
          </span>
          <button onClick={() => onEdit(x)}>
            <FiEdit2 />
          </button>
          <button onClick={() => onDelete(x)}>
            <FiTrash2 />
          </button>
        </div>
      ))}
    </section>
  );
}

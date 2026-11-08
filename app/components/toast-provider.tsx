"use client";

import { Toaster, ToastBar, toast } from "react-hot-toast";
import styles from "./toast-provider.module.css";

export function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      gutter={10}
      toastOptions={{
        className: styles.toast,
        duration: 2000,
        style: {
          background: "#fff",
          border: "1px solid #f3ebe4",
          color: "#322a23",
          maxWidth: "360px",
          padding: "12px 14px",
          boxShadow: "0 12px 32px rgba(232, 82, 10, 0.16)",
        },
        success: { iconTheme: { primary: "#16a36a", secondary: "#fff" } },
        error: { iconTheme: { primary: "#dc3f4f", secondary: "#fff" } },
      }}
      children={(t) => <div onClick={() => toast.dismiss(t.id)} role="button" tabIndex={0} aria-label="Dismiss notification"><ToastBar toast={t} /></div>}
    />
  );
}

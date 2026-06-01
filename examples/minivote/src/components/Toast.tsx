import { useState, useEffect, useCallback } from "react";
import styles from "../styles/Toast.module.css";

let toastId = 0;

export interface ToastMessage {
  id: number;
  text: string;
  type: "success" | "error" | "info";
}

let addToastGlobal: ((text: string, type: ToastMessage["type"]) => void) | null = null;

export function showToast(text: string, type: ToastMessage["type"] = "info") {
  addToastGlobal?.(text, type);
}

export default function ToastContainer() {
  const [toasts, setToasts] = useState<ToastMessage[]>([]);

  const addToast = useCallback((text: string, type: ToastMessage["type"]) => {
    const id = ++toastId;
    setToasts((prev) => [...prev, { id, text, type }]);
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, 2500);
  }, []);

  useEffect(() => {
    addToastGlobal = addToast;
    return () => {
      addToastGlobal = null;
    };
  }, [addToast]);

  if (toasts.length === 0) return null;

  return (
    <div className={styles.container}>
      {toasts.map((t) => (
        <div key={t.id} className={`${styles.toast} ${styles[t.type]}`}>
          <span className={styles.icon}>
            {t.type === "success" ? "✓" : t.type === "error" ? "✕" : "ℹ"}
          </span>
          {t.text}
        </div>
      ))}
    </div>
  );
}

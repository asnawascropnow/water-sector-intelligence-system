import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { SystemInfo, User } from "../../shared/types";
import { api, setApiUser } from "../lib/api";

interface AppState {
  users: User[];
  activeUsers: User[];
  currentUser: User | null;
  setCurrentUserId: (id: number) => void;
  theme: "light" | "dark";
  setTheme: (t: "light" | "dark") => void;
  /** Bump to make every useApi hook refetch after a mutation. */
  dataVersion: number;
  invalidate: () => void;
  reloadUsers: () => Promise<void>;
  system: SystemInfo | null;
  toast: (message: string, kind?: "info" | "error") => void;
}

const Ctx = createContext<AppState | null>(null);

const read = (k: string) => {
  try {
    return localStorage.getItem(k);
  } catch {
    return null;
  }
};
const write = (k: string, v: string) => {
  try {
    localStorage.setItem(k, v);
  } catch {
    /* storage unavailable */
  }
};

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [users, setUsers] = useState<User[]>([]);
  const [currentUserId, setCurrentUserIdState] = useState<number | null>(() => Number(read("bwi-user")) || null);
  const [theme, setThemeState] = useState<"light" | "dark">(() => (read("bwi-theme") === "dark" ? "dark" : "light"));
  const [dataVersion, setDataVersion] = useState(0);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: "info" | "error" }[]>([]);

  const reloadUsers = useCallback(async () => {
    setUsers(await api.get<User[]>("/users"));
  }, []);

  useEffect(() => {
    reloadUsers().catch(() => undefined);
    api.get<SystemInfo>("/system").then(setSystem).catch(() => undefined);
  }, [reloadUsers]);

  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);
  const currentUser = activeUsers.find((u) => u.id === currentUserId) ?? activeUsers[0] ?? null;
  setApiUser(currentUser?.id ?? null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    write("bwi-theme", theme);
  }, [theme]);

  const toast = useCallback((message: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4500);
  }, []);

  const value: AppState = {
    users,
    activeUsers,
    currentUser,
    setCurrentUserId: (id) => {
      setCurrentUserIdState(id);
      write("bwi-user", String(id));
    },
    theme,
    setTheme: setThemeState,
    dataVersion,
    invalidate: useCallback(() => setDataVersion((v) => v + 1), []),
    reloadUsers,
    system,
    toast,
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-[2000] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-md px-3.5 py-2.5 text-sm shadow-lg border ${
              t.kind === "error"
                ? "bg-red-50 border-red-200 text-red-800 dark:bg-red-950 dark:border-red-900 dark:text-red-200"
                : "bg-white border-neutral-200 text-neutral-800 dark:bg-neutral-900 dark:border-neutral-800 dark:text-neutral-100"
            }`}
          >
            {t.message}
          </div>
        ))}
      </div>
    </Ctx.Provider>
  );
}

export function useApp() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useApp must be used inside AppProvider");
  return v;
}

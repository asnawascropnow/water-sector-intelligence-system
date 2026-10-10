import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { Catalog, OrganizationTaxonomy, SystemInfo, User } from "../../shared/types";
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
  /** Database-backed organization types, groups and saved Discover views (null until loaded). */
  taxonomy: OrganizationTaxonomy | null;
  /** All catalogs from GET /api/meta (project types, stages, roles, fact definitions, pipelines…). */
  catalog: Catalog | null;
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
  // Dark is the default look; a choice made with the header toggle is remembered.
  const [theme, setThemeState] = useState<"light" | "dark">(() => (read("wsis-theme") === "light" ? "light" : "dark"));
  const [dataVersion, setDataVersion] = useState(0);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [taxonomy, setTaxonomy] = useState<OrganizationTaxonomy | null>(null);
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [toasts, setToasts] = useState<{ id: number; message: string; kind: "info" | "error" }[]>([]);

  const reloadUsers = useCallback(async () => {
    setUsers(await api.get<User[]>("/users"));
  }, []);

  // Pages wait for the team list so their first requests already carry X-User-Id.
  const [usersReady, setUsersReady] = useState(false);
  useEffect(() => {
    reloadUsers()
      .catch(() => undefined)
      .finally(() => setUsersReady(true));
    api.get<SystemInfo>("/system").then(setSystem).catch(() => undefined);
    api.get<OrganizationTaxonomy>("/meta/organization-types").then(setTaxonomy).catch(() => undefined);
    api.get<Catalog>("/meta").then(setCatalog).catch(() => undefined);
  }, [reloadUsers]);

  const activeUsers = useMemo(() => users.filter((u) => u.active), [users]);
  const currentUser = activeUsers.find((u) => u.id === currentUserId) ?? activeUsers[0] ?? null;
  setApiUser(currentUser?.id ?? null);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    write("wsis-theme", theme);
  }, [theme]);

  const toast = useCallback((message: string, kind: "info" | "error" = "info") => {
    const id = Date.now() + Math.random();
    // An identical message already on screen is not shown twice (e.g. the same error from repeated clicks).
    setToasts((t) => (t.some((x) => x.message === message && x.kind === kind) ? t : [...t, { id, message, kind }]));
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
    taxonomy,
    catalog,
    toast,
  };

  return (
    <Ctx.Provider value={value}>
      {usersReady ? children : <div className="min-h-screen bg-[var(--page)]" aria-busy="true" />}
      <div className="fixed bottom-4 right-4 z-[2000] flex flex-col gap-2 max-w-sm">
        {toasts.map((t) => (
          <div
            key={t.id}
            role="status"
            className={`rounded-2xl px-4 py-3 text-sm shadow-2xl border ${
              t.kind === "error"
                ? "bg-red-50 border-red-200 text-red-800 dark:bg-[#1c1214] dark:border-red-500/30 dark:text-red-200"
                : "bg-[var(--surface)] border-[var(--border)] text-[var(--text)]"
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

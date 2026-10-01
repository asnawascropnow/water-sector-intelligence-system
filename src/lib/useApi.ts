import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "./api";
import { useApp } from "../context/AppContext";

/** Fetch JSON from the API; refetches when the path changes or when data is invalidated app-wide. */
export function useApi<T>(path: string | null) {
  const { dataVersion } = useApp();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(Boolean(path));
  const seq = useRef(0);

  const load = useCallback(async () => {
    if (!path) return;
    const n = ++seq.current;
    setLoading(true);
    try {
      const d = await api.get<T>(path);
      if (n === seq.current) {
        setData(d);
        setError(null);
      }
    } catch (e) {
      if (n === seq.current) setError((e as Error).message);
    } finally {
      if (n === seq.current) setLoading(false);
    }
  }, [path]);

  useEffect(() => {
    load();
  }, [load, dataVersion]);

  return { data, error, loading, reload: load, setData };
}

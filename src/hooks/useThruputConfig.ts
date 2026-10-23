import { useEffect, useState } from "react";
import { getThruputConfig, type ThruputConfig } from "../thruput/config";

export interface UseThruputConfigReturn {
  config: ThruputConfig | null;
  error: string | null;
}

/** Network config from `/api/config`, shared by every caller through one cached request. */
export function useThruputConfig(): UseThruputConfigReturn {
  const [config, setConfig] = useState<ThruputConfig | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const next = await getThruputConfig();
        if (!cancelled) {
          setConfig(next);
          setError(null);
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "failed to load network config");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { config, error };
}

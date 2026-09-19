"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useI18n } from "@/hooks/useI18n";

interface CustomUpdateStatus {
  available: boolean;
  running: boolean;
  deployedVersion: string | null;
  upstreamVersion: string | null;
  lastStatus: { ok: boolean; message: string } | null;
}

type Phase = "idle" | "updating";

const GREEN = "#4ade80";
const YELLOW = "#f59e0b";
const GRAY = "var(--border)";
const POLL_INTERVAL_MS = 5 * 60 * 1000;
const UPDATE_POLL_MS = 4_000;
const UPDATE_TIMEOUT_MS = 12 * 60 * 1000;

/**
 * Small status dot for the customized build: green when the source tree
 * matches upstream agegr/pi-web main, yellow when upstream moved (click to
 * auto-update), pulsing while an update runs.
 */
export function CustomUpdateDot() {
  const { t } = useI18n();
  const [status, setStatus] = useState<CustomUpdateStatus | null>(null);
  const [failed, setFailed] = useState(false);
  const [phase, setPhase] = useState<Phase>("idle");
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch("/api/custom-update", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setStatus(await res.json() as CustomUpdateStatus);
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => { void refresh(); }, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  useEffect(() => {
    if (phase !== "updating") return;
    const startedAt = Date.now();
    const poll = () => {
      void (async () => {
        try {
          const res = await fetch("/api/custom-update", { cache: "no-store" });
          const next = res.ok ? await res.json() as CustomUpdateStatus : null;
          if (next && !next.running) {
            setPhase("idle");
            if (next.lastStatus?.ok && !next.available) {
              // Fresh build deployed — reload so the UI swaps to the new bundle.
              window.location.reload();
              return;
            }
            setStatus(next);
            setFailed(!next.lastStatus?.ok);
            return;
          }
        } catch {
          // The service is restarting mid-update; keep polling.
        }
        if (Date.now() - startedAt > UPDATE_TIMEOUT_MS) {
          setPhase("idle");
          setFailed(true);
          void refresh();
          return;
        }
        pollTimer.current = setTimeout(poll, UPDATE_POLL_MS);
      })();
    };
    poll();
    return () => { if (pollTimer.current) clearTimeout(pollTimer.current); };
  }, [phase, refresh]);

  const startUpdate = useCallback(async () => {
    if (phase === "updating") return;
    if (!window.confirm(t("customUpdate.confirm"))) return;
    setPhase("updating");
    try {
      const res = await fetch("/api/custom-update", { method: "POST" });
      if (!res.ok && res.status !== 409) {
        const body = await res.json().catch(() => ({}) as { error?: string });
        setFailed(true);
        setPhase("idle");
        window.alert(body.error ?? `HTTP ${res.status}`);
        void refresh();
      }
    } catch {
      setFailed(true);
      setPhase("idle");
    }
  }, [phase, refresh, t]);

  const updating = phase === "updating" || (status?.running ?? false);
  const color = updating ? YELLOW : failed ? GRAY : status?.available ? YELLOW : status ? GREEN : GRAY;
  const title = updating
    ? t("customUpdate.updating")
    : failed
      ? t("customUpdate.checkFailed")
      : status?.available
        ? t("customUpdate.available", { version: status.upstreamVersion ?? "?" })
        : status
          ? t("customUpdate.upToDate", { version: status.deployedVersion ?? "?" })
          : t("customUpdate.checkFailed");

  return (
    <button
      type="button"
      onClick={() => { if (status?.available && !updating) void startUpdate(); }}
      disabled={!status?.available || updating}
      title={title}
      aria-label={title}
      style={{
        width: 14, height: 14, padding: 0, flexShrink: 0,
        display: "inline-flex", alignItems: "center", justifyContent: "center",
        background: "none", border: "none", cursor: status?.available && !updating ? "pointer" : "default",
      }}
    >
      <span
        data-custom-update-dot={status?.available ? "update" : "current"}
        style={{
          width: 8, height: 8, borderRadius: "50%",
          background: color,
          boxShadow: updating ? `0 0 5px ${YELLOW}` : "none",
          opacity: failed ? 0.6 : 1,
          animation: updating ? "custom-update-pulse 1s ease-in-out infinite alternate" : undefined,
          display: "block",
        }}
      />
    </button>
  );
}

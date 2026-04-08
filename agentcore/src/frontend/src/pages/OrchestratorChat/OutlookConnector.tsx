
import { useCallback, useEffect, useRef, useState } from "react";
import { Mail, Check, X, Loader2, Unplug } from "lucide-react";
import { api } from "@/controllers/API/api";
import { BASE_URL_API } from "@/constants/constants";

/* ------------------------------------------------------------------ */
/*  Props                                                              */
/* ------------------------------------------------------------------ */

interface OutlookConnectorProps {
  isOpen: boolean;
  onDismiss: () => void;
  onConnected: () => void;
  onDisconnected?: () => void;
}

/* ------------------------------------------------------------------ */
/*  Component                                                          */
/* ------------------------------------------------------------------ */

export default function OutlookConnector({
  isOpen,
  onDismiss,
  onConnected,
  onDisconnected,
}: OutlookConnectorProps) {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [isConnected, setIsConnected] = useState(false);
  const [justConnected, setJustConnected] = useState(false);
  const [error, setError] = useState("");
  const connectingRef = useRef(false);
  const authWindowRef = useRef<Window | null>(null);

  /* ---- Check connection status ---- */
  const refreshStatus = useCallback(async () => {
    setChecking(true);
    setError("");
    try {
      const res = await api.get(`${BASE_URL_API}outlook-chat/status`, {
        withCredentials: true,
      });
      const connected = !!res.data?.connected;
      setIsConnected(connected);
      return connected;
    } catch {
      setIsConnected(false);
      return false;
    } finally {
      setChecking(false);
    }
  }, []);

  useEffect(() => {
    if (isOpen) {
      setJustConnected(false);
      refreshStatus();
    } else {
      setLoading(false);
      connectingRef.current = false;
      authWindowRef.current = null;
    }
  }, [isOpen, refreshStatus]);

  /* ---- Listen for postMessage from popup ---- */
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== window.location.origin) return;

      if (event.data?.type === "OUTLOOK_AUTH_SUCCESS") {
        setIsConnected(true);
        setJustConnected(true);
        onConnected();
        connectingRef.current = false;
        setLoading(false);
      }

      if (event.data?.type === "OUTLOOK_AUTH_ERROR") {
        connectingRef.current = false;
        setLoading(false);
        setError("Failed to connect to Outlook. Please try again.");
      }
    };

    // Also detect popup closed without completing auth
    const timer = window.setInterval(() => {
      if (
        connectingRef.current &&
        authWindowRef.current &&
        authWindowRef.current.closed
      ) {
        connectingRef.current = false;
        setLoading(false);
        authWindowRef.current = null;
        // Refresh status in case the auth completed but postMessage missed
        refreshStatus();
      }
    }, 500);

    window.addEventListener("message", onMessage);
    return () => {
      window.removeEventListener("message", onMessage);
      window.clearInterval(timer);
    };
  }, [onConnected, refreshStatus]);

  /* ---- Open OAuth popup ---- */
  const handleConnect = () => {
    if (connectingRef.current) return;
    connectingRef.current = true;
    setLoading(true);
    setError("");

    // The /auth/login endpoint redirects to Microsoft OAuth directly
    const loginUrl = `${BASE_URL_API}outlook-chat/auth/login`;
    const popup = window.open(loginUrl, "outlookAuth", "width=600,height=700");
    authWindowRef.current = popup;

    if (!popup) {
      connectingRef.current = false;
      setLoading(false);
      setError("Popup blocked. Please allow popups and try again.");
    }
  };

  /* ---- Disconnect ---- */
  const handleDisconnect = async () => {
    try {
      await api.post(`${BASE_URL_API}outlook-chat/disconnect`, null, {
        withCredentials: true,
      });
      setIsConnected(false);
      onDisconnected?.();
    } catch {
      setError("Failed to disconnect.");
    }
  };

  if (!isOpen) return null;

  const isDark =
    document.documentElement.classList.contains("dark") ||
    localStorage.getItem("themeMode") === "dark";

  /* ---- Render ---- */
  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/40">
      <div
        className={`relative w-full max-w-[520px] rounded-2xl border shadow-2xl ${
          isDark
            ? "border-zinc-700 bg-zinc-900 text-white"
            : "border-zinc-200 bg-white text-zinc-900"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-inherit px-6 py-4">
          <div className="flex items-center gap-2.5">
            <Mail size={20} className="text-blue-500" />
            <h2 className="text-lg font-semibold">
              {justConnected
                ? "Outlook Connected!"
                : isConnected
                  ? "Outlook Connected"
                  : "Connect to Outlook"}
            </h2>
          </div>
          <button
            onClick={onDismiss}
            className="rounded-lg p-1.5 hover:bg-zinc-100 dark:hover:bg-zinc-800"
          >
            <X size={18} />
          </button>
        </div>

        {/* Body */}
        <div className="px-6 py-5">
          {checking ? (
            /* ---- Loading ---- */
            <div className="flex flex-col items-center gap-3 py-8">
              <Loader2 size={28} className="animate-spin text-blue-500" />
              <p className="text-sm text-muted-foreground">
                Checking Outlook status...
              </p>
            </div>
          ) : justConnected ? (
            /* ---- Just connected success screen ---- */
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <Check size={32} className="text-green-600" />
              </div>
              <p className="text-base font-medium text-green-600">
                Successfully Connected!
              </p>
              <p className="text-sm text-muted-foreground">
                You can now ask questions about your emails and calendar.
              </p>
              <div
                className={`mt-2 w-full rounded-lg p-4 text-left text-sm ${
                  isDark ? "bg-zinc-800" : "bg-zinc-50"
                }`}
              >
                <p className="mb-2 font-semibold">Try asking:</p>
                <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
                  <li>"Show me my recent emails"</li>
                  <li>"Do I have any meetings today?"</li>
                  <li>"Search for emails from John about the project"</li>
                  <li>"What's on my calendar this week?"</li>
                </ul>
              </div>
            </div>
          ) : isConnected ? (
            /* ---- Already connected ---- */
            <div className="flex flex-col items-center gap-4 py-4 text-center">
              <div className="flex h-16 w-16 items-center justify-center rounded-full bg-green-100 dark:bg-green-900/30">
                <Check size={32} className="text-green-600" />
              </div>
              <p className="text-base font-medium text-green-600">
                Outlook is connected
              </p>
              <p className="text-sm text-muted-foreground">
                Your Outlook session is active. You can ask about emails and
                calendar events.
              </p>
              <button
                onClick={handleDisconnect}
                className="mt-2 flex items-center gap-2 rounded-lg border border-red-300 px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:border-red-700 dark:hover:bg-red-900/20"
              >
                <Unplug size={16} />
                Disconnect Outlook
              </button>
            </div>
          ) : (
            /* ---- Not connected — consent screen ---- */
            <div className="space-y-5 text-center">
              <div className="text-5xl">
                <Mail size={48} className="mx-auto text-blue-500" />
              </div>
              <div>
                <p className="text-base font-semibold">
                  Connect your Outlook account
                </p>
                <p className="mt-1 text-sm text-muted-foreground">
                  Access your emails and calendar to get intelligent assistance
                </p>
              </div>

              <div
                className={`rounded-lg border p-4 text-left ${
                  isDark ? "border-zinc-700" : "border-zinc-200"
                }`}
              >
                <p className="mb-3 text-sm font-semibold">
                  This will allow agents to:
                </p>
                <ul className="space-y-2.5 text-sm">
                  <li className="flex items-center gap-3">
                    <span className="font-bold text-green-600">&#10003;</span>
                    Read your emails and search your mailbox
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="font-bold text-green-600">&#10003;</span>
                    View your calendar events and meetings
                  </li>
                  <li className="flex items-center gap-3">
                    <span className="font-bold text-green-600">&#10003;</span>
                    Access your profile information
                  </li>
                </ul>
              </div>

              <div
                className={`rounded-md border p-3 text-left text-xs ${
                  isDark
                    ? "border-amber-700/50 bg-amber-900/20 text-amber-200"
                    : "border-amber-300 bg-amber-50 text-amber-800"
                }`}
              >
                <strong>Privacy Note:</strong> Your emails and calendar data are
                only accessed when you ask questions. We never store your email
                content or share it with third parties.
              </div>

              <div className="flex items-center justify-center gap-3 pt-1">
                <button
                  onClick={handleConnect}
                  disabled={loading}
                  className="flex items-center gap-2 rounded-lg bg-blue-600 px-6 py-2.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {loading ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : (
                    <Mail size={16} />
                  )}
                  {loading ? "Connecting..." : "Connect to Outlook"}
                </button>
                <button
                  onClick={onDismiss}
                  disabled={loading}
                  className={`rounded-lg border px-5 py-2.5 text-sm font-medium ${
                    isDark
                      ? "border-zinc-700 hover:bg-zinc-800"
                      : "border-zinc-300 hover:bg-zinc-50"
                  }`}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {error && (
            <p className="mt-3 text-center text-sm text-red-500">{error}</p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Hook: check Outlook connection status (MiBuddy-style)              */
/* ------------------------------------------------------------------ */

export function useOutlookStatus() {
  const [isConnected, setIsConnected] = useState(false);

  const check = useCallback(async () => {
    try {
      const res = await api.get(`${BASE_URL_API}outlook-chat/status`, {
        withCredentials: true,
      });
      const connected = !!res.data?.connected;
      setIsConnected(connected);
      return connected;
    } catch {
      setIsConnected(false);
      return false;
    }
  }, []);

  useEffect(() => {
    check();
  }, [check]);

  return { isConnected, refresh: check, setIsConnected };
}

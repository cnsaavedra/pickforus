import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HealthStatus,
  PickMode,
  RoomPhase,
  RoomSnapshot,
  WsClientPayload,
  WsServerPayload,
} from "../shared/types";

const PARTICIPANT_STORAGE_KEY = "pickforus_participant_id";

interface ModeCardMeta {
  mode: PickMode;
  title: string;
  description: string;
  tag: string;
}

const MODE_CARDS: readonly ModeCardMeta[] = [
  {
    mode: "food",
    title: "Picking Food",
    description: "Cravings, dietary vetoes, and tie-breaking.",
    tag: "Eats & Drinks",
  },
  {
    mode: "destination",
    title: "Picking Destination",
    description: "Activities, hangouts, and nearby spots.",
    tag: "Plans & Spots",
  },
  {
    mode: "surprise",
    title: "Pick For Us Please",
    description: "Everyone truly has zero clue? Instant break.",
    tag: "Wildcard",
  },
];

const MODE_TITLES: Record<PickMode, string> = {
  food: "Picking Food",
  destination: "Picking Destination",
  surprise: "Pick For Us Please",
};

interface TimerOption {
  seconds: number;
  label: string;
}

const TIMER_OPTIONS: readonly TimerOption[] = [
  { seconds: 60, label: "60s Classic" },
  { seconds: 30, label: "30s Quick" },
  { seconds: 15, label: "15s Rapid" },
];

const PHASE_LABELS: Record<RoomPhase, string> = {
  lobby: "Waiting",
  active: "Live Blitz",
  deciding: "Thinking...",
  decided: "Picked",
};

class ApiError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

function getOrCreateParticipantId(): string {
  try {
    const existing = window.sessionStorage.getItem(PARTICIPANT_STORAGE_KEY);
    if (existing && existing.trim().length > 0) {
      return existing;
    }
  } catch {
    // Ignore storage access restrictions and fall back to memory ID.
  }

  const generated =
    typeof window.crypto !== "undefined" && typeof window.crypto.randomUUID === "function"
      ? window.crypto.randomUUID()
      : `p_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;

  try {
    window.sessionStorage.setItem(PARTICIPANT_STORAGE_KEY, generated);
  } catch {
    // Ignore storage write errors.
  }

  return generated;
}

function parseRoomCodeFromPath(pathname: string): string | null {
  const match = /^\/room\/([A-Za-z0-9_-]+)\/?$/.exec(pathname.trim());
  if (!match) {
    return null;
  }
  const code = match[1];
  return code ? code.toUpperCase() : null;
}

function extractRoomCodeInput(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "";
  }
  const urlMatch = /\/room\/([A-Za-z0-9_-]+)/i.exec(trimmed);
  if (urlMatch?.[1]) {
    return urlMatch[1].toUpperCase();
  }
  return trimmed.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase();
}

function formatCountdown(totalSeconds: number): string {
  const clamped = Math.max(0, Math.floor(totalSeconds));
  const minutes = Math.floor(clamped / 60);
  const seconds = clamped % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function formatMessageTime(isoString: string): string {
  const parsed = new Date(isoString);
  if (Number.isNaN(parsed.getTime())) {
    return "";
  }
  return parsed.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

async function fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);
  const body = (await response.json().catch(() => null)) as {
    error?: unknown;
    message?: unknown;
  } | null;

  if (!response.ok) {
    const serverMessage =
      typeof body?.error === "string"
        ? body.error
        : typeof body?.message === "string"
          ? body.message
          : `Request failed (${response.status})`;
    throw new ApiError(serverMessage, response.status);
  }

  return body as T;
}

async function copyTextToClipboard(text: string): Promise<boolean> {
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall through to textarea copy fallback.
    }
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "true");
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand("copy");
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

interface LobbyViewProps {
  health: HealthStatus | null;
  healthChecked: boolean;
  onEnterRoom: (snapshot: RoomSnapshot) => void;
}

function LobbyView({ health, healthChecked, onEnterRoom }: LobbyViewProps) {
  const [selectedMode, setSelectedMode] = useState<PickMode>("food");
  const [selectedDuration, setSelectedDuration] = useState<number>(60);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [joinError, setJoinError] = useState<string | null>(null);

  const brainBadgeLabel = !healthChecked
    ? "Checking local brain..."
    : health?.ollamaAvailable
      ? `Local Qwen ready: ${health.ollamaModel || "qwen3.5:9b"}`
      : "Fast Rule Engine ready";

  const brainReadyOllama = Boolean(healthChecked && health?.ollamaAvailable);

  async function handleCreateRoom() {
    if (creating) return;
    setCreating(true);
    setCreateError(null);

    try {
      const snapshot = await fetchJson<RoomSnapshot>("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: selectedMode,
          durationSeconds: selectedDuration,
        }),
      });
      onEnterRoom(snapshot);
    } catch (err: unknown) {
      setCreateError(err instanceof Error ? err.message : "Could not create room.");
    } finally {
      setCreating(false);
    }
  }

  async function handleJoinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joining) return;

    const code = extractRoomCodeInput(joinCode);
    if (!code) {
      setJoinError("Enter a 4-letter room code.");
      return;
    }

    setJoining(true);
    setJoinError(null);

    try {
      const snapshot = await fetchJson<RoomSnapshot>(`/api/rooms/${encodeURIComponent(code)}`);
      onEnterRoom(snapshot);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setJoinError(`Room ${code} was not found.`);
      } else {
        setJoinError(err instanceof Error ? err.message : "Could not join room.");
      }
    } finally {
      setJoining(false);
    }
  }

  return (
    <div className="pfu-shell">
      <header className="pfu-lobby-header">
        <div className="pfu-brand-block">
          <div className="pfu-brand-row">
            <span className="pfu-brand-mark" aria-hidden="true">
              P
            </span>
            <h1 className="pfu-brand-title">PickForUs</h1>
          </div>
          <p className="pfu-tagline">60 seconds of honest gut thoughts. Zero polite stalling.</p>
        </div>

        <div
          className={`pfu-health-badge ${
            !healthChecked
              ? "pfu-health-badge--checking"
              : brainReadyOllama
                ? "pfu-health-badge--ollama"
                : "pfu-health-badge--rules"
          }`}
        >
          <span className="pfu-health-dot" aria-hidden="true" />
          <span>{brainBadgeLabel}</span>
        </div>
      </header>

      <main className="pfu-lobby-grid">
        <section className="pfu-card pfu-card--create" aria-labelledby="create-heading">
          <div className="pfu-section-head">
            <h2 id="create-heading" className="pfu-section-title">
              Start a Blitz Room
            </h2>
            <p className="pfu-section-subtitle">
              Pick a decision lane, choose the clock, and send the link to the group chat.
            </p>
          </div>

          <fieldset className="pfu-fieldset">
            <legend className="pfu-sr-only">Decision mode</legend>
            <div className="pfu-mode-grid">
              {MODE_CARDS.map((card) => {
                const isSelected = selectedMode === card.mode;
                return (
                  <button
                    key={card.mode}
                    type="button"
                    aria-pressed={isSelected}
                    className={`pfu-mode-card ${isSelected ? "pfu-mode-card--active" : ""}`}
                    onClick={() => setSelectedMode(card.mode)}
                  >
                    <span className="pfu-mode-tag">{card.tag}</span>
                    <span className="pfu-mode-title">{card.title}</span>
                    <span className="pfu-mode-desc">{card.description}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>

          <div className="pfu-create-footer">
            <div className="pfu-timer-block">
              <span className="pfu-field-label" id="timer-selector-label">
                Round Clock
              </span>
              <fieldset className="pfu-fieldset" aria-labelledby="timer-selector-label">
                <legend className="pfu-sr-only">Round Clock</legend>
                <div className="pfu-timer-pills">
                  {TIMER_OPTIONS.map((option) => {
                    const isActive = selectedDuration === option.seconds;
                    return (
                      <button
                        key={option.seconds}
                        type="button"
                        aria-pressed={isActive}
                        className={`pfu-timer-pill ${isActive ? "pfu-timer-pill--active" : ""}`}
                        onClick={() => setSelectedDuration(option.seconds)}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>
            </div>

            <button
              type="button"
              className="pfu-btn pfu-btn--primary pfu-btn--lg"
              disabled={creating}
              onClick={handleCreateRoom}
            >
              {creating ? "Creating Room..." : "Create Room"}
            </button>
          </div>

          {createError ? (
            <p className="pfu-inline-banner pfu-inline-banner--error" role="alert">
              {createError}
            </p>
          ) : null}
        </section>

        <section className="pfu-card pfu-card--join" aria-labelledby="join-heading">
          <div className="pfu-section-head">
            <h2 id="join-heading" className="pfu-section-title">
              Join Existing Room
            </h2>
            <p className="pfu-section-subtitle">
              Already have a 4-letter code from a friend? Jump straight in anonymously.
            </p>
          </div>

          <form className="pfu-join-form" onSubmit={handleJoinRoom}>
            <div className="pfu-input-group">
              <label htmlFor="join-room-code" className="pfu-field-label">
                Room Code
              </label>
              <input
                id="join-room-code"
                type="text"
                className="pfu-input pfu-input--code"
                placeholder="ABCD"
                value={joinCode}
                onChange={(event) => {
                  setJoinCode(event.target.value.toUpperCase());
                  if (joinError) setJoinError(null);
                }}
                maxLength={64}
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
              />
            </div>

            <button
              type="submit"
              className="pfu-btn pfu-btn--secondary pfu-btn--lg"
              disabled={joining}
            >
              {joining ? "Checking Room..." : "Join Room"}
            </button>
          </form>

          {joinError ? (
            <p className="pfu-inline-banner pfu-inline-banner--error" role="alert">
              {joinError}
            </p>
          ) : null}

          <div className="pfu-spirit-note">
            <p className="pfu-spirit-title">How PickForUs breaks the stall</p>
            <ul className="pfu-spirit-list">
              <li>Everyone gets a random anonymous alias per browser tab.</li>
              <li>Hard vetoes (&ldquo;no burgers&rdquo;) disqualify options immediately.</li>
              <li>Spamming the same spot counts once per friend, not per message.</li>
            </ul>
          </div>
        </section>
      </main>
    </div>
  );
}

interface RoomViewProps {
  roomCode: string;
  participantId: string;
  initialSnapshot: RoomSnapshot | null;
  onBackToLobby: () => void;
}

function RoomView({ roomCode, participantId, initialSnapshot, onBackToLobby }: RoomViewProps) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initialSnapshot);
  const [alias, setAlias] = useState<string | null>(null);
  const [nextMode, setNextMode] = useState<PickMode>(initialSnapshot?.mode ?? "food");
  const [loading, setLoading] = useState<boolean>(initialSnapshot === null);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [copiedInvite, setCopiedInvite] = useState<boolean>(false);
  const [chatText, setChatText] = useState<string>("");
  const [sendingChat, setSendingChat] = useState<boolean>(false);
  const [wsConnected, setWsConnected] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const notFoundRef = useRef<boolean>(false);
  const chatListRef = useRef<HTMLDivElement | null>(null);
  const copyTimerRef = useRef<number | null>(null);

  const currentMode = snapshot?.mode;
  const currentPhase = snapshot?.phase;

  useEffect(() => {
    if (currentMode && currentPhase === "lobby") {
      setNextMode(currentMode);
    }
  }, [currentMode, currentPhase]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    let disposed = false;
    let reconnectTimer: number | null = null;

    async function loadRoomSnapshot() {
      try {
        const fetched = await fetchJson<RoomSnapshot>(`/api/rooms/${encodeURIComponent(roomCode)}`);
        if (disposed) return;
        setSnapshot((prev) => prev ?? fetched);
        setLoading(false);
        setNotFound(false);
        notFoundRef.current = false;
      } catch (err: unknown) {
        if (disposed) return;
        setLoading(false);
        if (err instanceof ApiError && err.status === 404) {
          setNotFound(true);
          notFoundRef.current = true;
          if (wsRef.current) {
            wsRef.current.close();
          }
        } else {
          setBannerError(err instanceof Error ? err.message : "Could not load room.");
        }
      }
    }

    function connectWebSocket() {
      if (disposed || notFoundRef.current) return;
      const wsProto = window.location.protocol === "https:" ? "wss:" : "ws:";
      const socket = new WebSocket(`${wsProto}//${window.location.host}/ws`);
      wsRef.current = socket;

      socket.addEventListener("open", () => {
        if (disposed) {
          socket.close();
          return;
        }
        setWsConnected(true);
        const joinMessage: WsClientPayload = {
          type: "join",
          roomCode,
          participantId,
        };
        socket.send(JSON.stringify(joinMessage));
      });

      socket.addEventListener("message", (event) => {
        if (disposed || typeof event.data !== "string") return;
        let payload: WsServerPayload;
        try {
          payload = JSON.parse(event.data) as WsServerPayload;
        } catch {
          return;
        }

        if (payload.type === "joined") {
          if (payload.roomCode === roomCode) {
            setAlias(payload.alias);
            setSnapshot(payload.snapshot);
            setLoading(false);
            setNotFound(false);
            notFoundRef.current = false;
            setBannerError(null);
          }
        } else if (payload.type === "snapshot") {
          if (payload.snapshot.code === roomCode) {
            setSnapshot(payload.snapshot);
            setLoading(false);
            setNotFound(false);
            notFoundRef.current = false;
          }
        } else if (payload.type === "tick") {
          if (payload.roomCode === roomCode) {
            setSnapshot((prev) =>
              prev
                ? {
                    ...prev,
                    remainingSeconds: payload.remainingSeconds,
                    phase: payload.phase,
                  }
                : prev,
            );
          }
        } else if (payload.type === "error") {
          setBannerError(payload.message);
        }
      });

      socket.addEventListener("close", () => {
        if (wsRef.current === socket) {
          wsRef.current = null;
        }
        setWsConnected(false);
        if (!disposed && !notFoundRef.current) {
          reconnectTimer = window.setTimeout(() => {
            connectWebSocket();
          }, 1500);
        }
      });
    }

    void loadRoomSnapshot();
    connectWebSocket();

    return () => {
      disposed = true;
      if (reconnectTimer !== null) {
        window.clearTimeout(reconnectTimer);
      }
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [roomCode, participantId]);

  const messageCount = snapshot?.messages.length ?? 0;
  const lastMessageId = messageCount > 0 ? (snapshot?.messages[messageCount - 1]?.id ?? "") : "";

  useEffect(() => {
    const container = chatListRef.current;
    if (!container) return;
    if (messageCount >= 0 && lastMessageId !== undefined) {
      container.scrollTop = container.scrollHeight;
    }
  }, [messageCount, lastMessageId]);

  const runRoomAction = useCallback(
    async (endpoint: string, body?: Record<string, unknown>) => {
      if (actionBusy) return;
      setActionBusy(true);
      setBannerError(null);
      try {
        const updated = await fetchJson<RoomSnapshot>(
          `/api/rooms/${encodeURIComponent(roomCode)}/${endpoint}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: body ? JSON.stringify(body) : "{}",
          },
        );
        setSnapshot(updated);
      } catch (err: unknown) {
        setBannerError(err instanceof Error ? err.message : "Action failed.");
      } finally {
        setActionBusy(false);
      }
    },
    [actionBusy, roomCode],
  );

  async function handleCopyInvite() {
    const ok = await copyTextToClipboard(window.location.href);
    if (!ok) {
      setBannerError(
        "Could not copy invite link automatically — copy the URL from the address bar.",
      );
      return;
    }
    setCopiedInvite(true);
    if (copyTimerRef.current !== null) {
      window.clearTimeout(copyTimerRef.current);
    }
    copyTimerRef.current = window.setTimeout(() => {
      setCopiedInvite(false);
    }, 2000);
  }

  async function handleChatSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!snapshot || sendingChat) return;
    if (snapshot.phase === "decided" || snapshot.phase === "deciding") return;

    const trimmed = chatText.trim();
    if (!trimmed) return;

    setBannerError(null);
    const socket = wsRef.current;
    if (socket && socket.readyState === WebSocket.OPEN) {
      try {
        const payload: WsClientPayload = {
          type: "chat",
          roomCode,
          participantId,
          text: trimmed,
        };
        socket.send(JSON.stringify(payload));
        setChatText("");
        return;
      } catch {
        // Fall back to HTTP POST below if socket send fails.
      }
    }

    setSendingChat(true);
    try {
      const updated = await fetchJson<RoomSnapshot>(
        `/api/rooms/${encodeURIComponent(roomCode)}/messages`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            participantId,
            text: trimmed,
          }),
        },
      );
      setSnapshot(updated);
      setChatText("");
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : "Could not send message.");
    } finally {
      setSendingChat(false);
    }
  }

  if (notFound) {
    return (
      <div className="pfu-shell">
        <div className="pfu-card pfu-empty-state">
          <span className="pfu-room-code-pill">Room {roomCode}</span>
          <h1 className="pfu-section-title">Room Not Found</h1>
          <p className="pfu-section-subtitle">
            That room code does not exist or its session expired. Head back to create a fresh room.
          </p>
          <button type="button" className="pfu-btn pfu-btn--primary" onClick={onBackToLobby}>
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  if (loading || !snapshot) {
    return (
      <div className="pfu-shell">
        <div className="pfu-card pfu-empty-state">
          <span className="pfu-room-code-pill">Room {roomCode}</span>
          <h1 className="pfu-section-title">Joining Room...</h1>
          <p className="pfu-section-subtitle">Connecting to the live blitz table.</p>
          {bannerError ? (
            <p className="pfu-inline-banner pfu-inline-banner--error" role="alert">
              {bannerError}
            </p>
          ) : null}
          <button type="button" className="pfu-btn pfu-btn--secondary" onClick={onBackToLobby}>
            Back to Lobby
          </button>
        </div>
      </div>
    );
  }

  const progressPercent =
    snapshot.durationSeconds > 0
      ? Math.max(0, Math.min(100, (snapshot.remainingSeconds / snapshot.durationSeconds) * 100))
      : 0;

  const isLowTime = snapshot.phase === "active" && snapshot.remainingSeconds <= 10;
  const chatDisabled = snapshot.phase === "decided" || snapshot.phase === "deciding" || sendingChat;

  const chatPlaceholder =
    snapshot.phase === "deciding"
      ? "Thinking through the chat... input locked for this round."
      : snapshot.phase === "decided"
        ? "Round picked! Start a New Round to chat again."
        : snapshot.mode === "food"
          ? "Drop a craving or veto (e.g. ramen, no burgers)..."
          : snapshot.mode === "destination"
            ? "Suggest a spot or veto (e.g. arcade bar, not bowling)..."
            : "Anything goes — pitch an idea or hard veto...";

  const friendLabel = snapshot.participantCount === 1 ? "friend" : "friends";
  const verdict = snapshot.verdict;

  return (
    <div className="pfu-shell">
      <header className="pfu-card pfu-room-topbar">
        <div className="pfu-topbar-left">
          <span className="pfu-room-code-pill">Room {snapshot.code}</span>
          <button
            type="button"
            className={`pfu-btn pfu-btn--sm ${copiedInvite ? "pfu-btn--success" : "pfu-btn--ghost"}`}
            onClick={handleCopyInvite}
          >
            {copiedInvite ? "Invite Link Copied!" : "Copy Invite Link"}
          </button>
        </div>

        <div className="pfu-topbar-pills">
          <span className="pfu-meta-pill pfu-meta-pill--alias">
            {alias ? `You: ${alias}` : "You: Joining..."}
          </span>
          <span className="pfu-meta-pill">
            <span
              className={`pfu-ws-dot ${wsConnected ? "pfu-ws-dot--live" : ""}`}
              aria-hidden="true"
            />
            {snapshot.participantCount} {friendLabel}
          </span>
          <span className="pfu-meta-pill">Round #{snapshot.roundNumber}</span>
          <button
            type="button"
            className="pfu-btn pfu-btn--sm pfu-btn--secondary"
            onClick={onBackToLobby}
          >
            Back to Lobby
          </button>
        </div>
      </header>

      {bannerError ? (
        <div className="pfu-inline-banner pfu-inline-banner--error" role="alert">
          <span>{bannerError}</span>
          <button
            type="button"
            className="pfu-banner-dismiss"
            onClick={() => setBannerError(null)}
            aria-label="Dismiss error"
          >
            Dismiss
          </button>
        </div>
      ) : null}

      <section className="pfu-card pfu-countdown-strip" aria-label="Round countdown and controls">
        <div className="pfu-strip-main">
          <div className="pfu-clock-group">
            <div
              className={`pfu-countdown-clock ${isLowTime ? "pfu-countdown-clock--urgent" : ""}`}
              aria-live="off"
            >
              {formatCountdown(snapshot.remainingSeconds)}
            </div>
            <div className="pfu-phase-meta">
              <span className={`pfu-phase-pill pfu-phase-pill--${snapshot.phase}`}>
                {PHASE_LABELS[snapshot.phase]}
              </span>
              <span className="pfu-mode-badge">{MODE_TITLES[snapshot.mode]}</span>
            </div>
          </div>

          <div className="pfu-strip-actions">
            {snapshot.phase === "lobby" ? (
              <>
                <button
                  type="button"
                  className="pfu-btn pfu-btn--primary"
                  disabled={actionBusy}
                  onClick={() => void runRoomAction("start")}
                >
                  Start Countdown
                </button>
                <button
                  type="button"
                  className="pfu-btn pfu-btn--secondary"
                  disabled={actionBusy}
                  onClick={() => void runRoomAction("simulate")}
                >
                  Load 4-Friend Demo
                </button>
              </>
            ) : null}

            {snapshot.phase === "active" ? (
              <>
                {snapshot.messages.length < 2 ? (
                  <button
                    type="button"
                    className="pfu-btn pfu-btn--secondary"
                    disabled={actionBusy}
                    onClick={() => void runRoomAction("simulate")}
                  >
                    Load 4-Friend Demo
                  </button>
                ) : null}
                <button
                  type="button"
                  className="pfu-btn pfu-btn--primary"
                  disabled={actionBusy}
                  onClick={() => void runRoomAction("finish")}
                >
                  Lock &amp; Pick Now
                </button>
              </>
            ) : null}

            {snapshot.phase === "deciding" ? (
              <span className="pfu-thinking-note">Weighing cravings, vetoes, and repeats...</span>
            ) : null}

            {snapshot.phase === "decided" ? (
              <div className="pfu-reset-controls">
                <label htmlFor="switch-mode-select" className="pfu-sr-only">
                  Switch Mode
                </label>
                <select
                  id="switch-mode-select"
                  className="pfu-select"
                  value={nextMode}
                  onChange={(event) => setNextMode(event.target.value as PickMode)}
                  disabled={actionBusy}
                >
                  <option value="food">Mode: Picking Food</option>
                  <option value="destination">Mode: Picking Destination</option>
                  <option value="surprise">Mode: Pick For Us Please</option>
                </select>
                <button
                  type="button"
                  className="pfu-btn pfu-btn--primary"
                  disabled={actionBusy}
                  onClick={() =>
                    void runRoomAction("reset", {
                      mode: nextMode,
                      durationSeconds: snapshot.durationSeconds,
                    })
                  }
                >
                  New Round
                </button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="pfu-progress-track" aria-hidden="true">
          <div
            className={`pfu-progress-fill ${isLowTime ? "pfu-progress-fill--urgent" : ""}`}
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </section>

      <div className="pfu-room-columns">
        <section className="pfu-card pfu-chat-card" aria-labelledby="chat-heading">
          <div className="pfu-chat-header">
            <h2 id="chat-heading" className="pfu-section-title">
              Anonymous Gut Feed
            </h2>
            <span className="pfu-chat-count">
              {snapshot.messages.length} {snapshot.messages.length === 1 ? "thought" : "thoughts"}
            </span>
          </div>

          <div ref={chatListRef} className="pfu-chat-feed" aria-live="polite">
            {snapshot.messages.length === 0 ? (
              <div className="pfu-chat-empty">
                <p>No thoughts yet.</p>
                <p className="pfu-chat-empty-hint">
                  Hit <strong>Start Countdown</strong> to go live, or click{" "}
                  <strong>Load 4-Friend Demo</strong> to test solo in one click.
                </p>
              </div>
            ) : (
              snapshot.messages.map((msg) => {
                const isOwn = msg.participantId === participantId;
                const timeLabel = formatMessageTime(msg.createdAt);
                return (
                  <article key={msg.id} className={`pfu-msg ${isOwn ? "pfu-msg--own" : ""}`}>
                    <div className="pfu-msg-meta">
                      <span className="pfu-msg-alias">
                        {msg.alias}
                        {isOwn ? <span className="pfu-msg-you"> (You)</span> : null}
                      </span>
                      {timeLabel ? <span className="pfu-msg-time">{timeLabel}</span> : null}
                    </div>
                    <p className="pfu-msg-text">{msg.text}</p>
                  </article>
                );
              })
            )}
          </div>

          <form className="pfu-chat-form" onSubmit={handleChatSubmit}>
            <label htmlFor="chat-input" className="pfu-sr-only">
              Share your honest pick or veto
            </label>
            <input
              id="chat-input"
              type="text"
              className="pfu-input"
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              placeholder={chatPlaceholder}
              disabled={chatDisabled}
              maxLength={400}
              autoComplete="off"
            />
            <button
              type="submit"
              className="pfu-btn pfu-btn--primary"
              disabled={chatDisabled || chatText.trim().length === 0}
            >
              Send
            </button>
          </form>
        </section>

        <section className="pfu-card pfu-verdict-card" aria-labelledby="verdict-heading">
          {snapshot.phase === "decided" && verdict ? (
            <div className="pfu-verdict-body">
              <div className="pfu-verdict-header">
                <div>
                  <span className="pfu-verdict-eyebrow">Final Group Pick</span>
                  <h2 id="verdict-heading" className="pfu-verdict-winner">
                    {verdict.winner}
                  </h2>
                </div>
                <span
                  className={`pfu-engine-pill ${
                    verdict.engineUsed === "ollama"
                      ? "pfu-engine-pill--ollama"
                      : "pfu-engine-pill--rules"
                  }`}
                >
                  {verdict.engineUsed === "ollama"
                    ? `Local Ollama · ${verdict.modelName ?? "qwen3.5:9b"}`
                    : "Rule Engine"}
                </span>
              </div>

              <p className="pfu-verdict-summary">{verdict.summary}</p>

              {verdict.duplicateDetected ? (
                <output className="pfu-inline-banner pfu-inline-banner--warn">
                  <strong>Spam guard triggered:</strong>{" "}
                  {verdict.duplicateNote ??
                    "Repeated messages from the same friend only counted as one vote."}
                </output>
              ) : null}

              <div className="pfu-verdict-section">
                <h3 className="pfu-subhead">Top 3 Ranked</h3>
                {verdict.top3.length === 0 ? (
                  <p className="pfu-muted-note">No ranked candidates were extracted.</p>
                ) : (
                  <ol className="pfu-ranked-list">
                    {verdict.top3.map((option, idx) => {
                      const sampleQuote = option.sampleQuotes[0];
                      const supporterWord = option.supporters === 1 ? "friend" : "friends";
                      const mentionWord = option.mentions === 1 ? "mention" : "mentions";
                      return (
                        <li
                          key={option.name}
                          className={`pfu-ranked-item ${idx === 0 ? "pfu-ranked-item--first" : ""}`}
                        >
                          <div className="pfu-ranked-top">
                            <span className="pfu-rank-badge">#{idx + 1}</span>
                            <span className="pfu-rank-name">{option.name}</span>
                            <span className="pfu-rank-stats">
                              {option.supporters} {supporterWord} &middot; {option.mentions}{" "}
                              {mentionWord}
                            </span>
                          </div>
                          {sampleQuote ? (
                            <p className="pfu-rank-quote">&ldquo;{sampleQuote}&rdquo;</p>
                          ) : null}
                        </li>
                      );
                    })}
                  </ol>
                )}
              </div>

              <div className="pfu-verdict-section">
                <h3 className="pfu-subhead">Vetoed / Excluded</h3>
                {verdict.vetoed.length === 0 ? (
                  <p className="pfu-muted-note">No hard vetoes called this round.</p>
                ) : (
                  <div className="pfu-veto-chips">
                    {verdict.vetoed.map((veto) => (
                      <span key={`${veto.name}-${veto.reason}`} className="pfu-veto-chip">
                        No {veto.name} &mdash; &ldquo;{veto.reason}&rdquo;
                      </span>
                    ))}
                  </div>
                )}
              </div>

              <div className="pfu-verdict-actions">
                <a
                  href={verdict.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pfu-btn pfu-btn--primary pfu-btn--link"
                >
                  Find Winner on Google Maps
                </a>
                <button
                  type="button"
                  className="pfu-btn pfu-btn--secondary"
                  disabled={actionBusy}
                  onClick={() =>
                    void runRoomAction("reset", {
                      mode: nextMode,
                      durationSeconds: snapshot.durationSeconds,
                    })
                  }
                >
                  Run Another Round
                </button>
              </div>
            </div>
          ) : (
            <div className="pfu-verdict-standby">
              <span className="pfu-verdict-eyebrow">Decision Board</span>
              <h2 id="verdict-heading" className="pfu-section-title">
                {snapshot.phase === "deciding"
                  ? "Crunching the Group Verdict..."
                  : "Verdict Lands When the Clock Hits Zero"}
              </h2>
              <p className="pfu-section-subtitle">
                {snapshot.phase === "deciding"
                  ? "Filtering out vetoes, collapsing duplicate spam, and ranking the top 3 spots."
                  : "Speak honestly in the feed — nobody knows who typed what. Hit Lock & Pick Now whenever everyone is ready early."}
              </p>

              <div className="pfu-standby-rules">
                <div className="pfu-standby-item">
                  <span className="pfu-standby-kicker">1. Negation-safe</span>
                  <p>Saying &ldquo;no burgers&rdquo; vetoes Burgers instead of voting for it.</p>
                </div>
                <div className="pfu-standby-item">
                  <span className="pfu-standby-kicker">2. Spam-resistant</span>
                  <p>
                    One friend repeating &ldquo;tacos&rdquo; five times still counts as 1 friend.
                  </p>
                </div>
                <div className="pfu-standby-item">
                  <span className="pfu-standby-kicker">3. Zero stalemate</span>
                  <p>Ties and indecisive shrugs break immediately with a Maps link ready.</p>
                </div>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}

export function App() {
  const [participantId] = useState<string>(() => getOrCreateParticipantId());
  const [routeRoomCode, setRouteRoomCode] = useState<string | null>(() =>
    parseRoomCodeFromPath(window.location.pathname),
  );
  const [initialRoomSnapshot, setInitialRoomSnapshot] = useState<RoomSnapshot | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthChecked, setHealthChecked] = useState<boolean>(false);

  useEffect(() => {
    function handlePopState() {
      setInitialRoomSnapshot(null);
      setRouteRoomCode(parseRoomCodeFromPath(window.location.pathname));
    }

    window.addEventListener("popstate", handlePopState);
    return () => window.removeEventListener("popstate", handlePopState);
  }, []);

  useEffect(() => {
    let active = true;

    async function checkHealth() {
      try {
        const status = await fetchJson<HealthStatus>("/api/health");
        if (active) {
          setHealth(status);
        }
      } catch {
        // Keep null health and show Rule Engine fallback status.
      } finally {
        if (active) {
          setHealthChecked(true);
        }
      }
    }

    void checkHealth();
    return () => {
      active = false;
    };
  }, []);

  const handleEnterRoom = useCallback((snapshot: RoomSnapshot) => {
    const normalizedCode = snapshot.code.toUpperCase();
    setInitialRoomSnapshot(snapshot);
    setRouteRoomCode(normalizedCode);
    window.history.pushState(null, "", `/room/${encodeURIComponent(normalizedCode)}`);
  }, []);

  const handleBackToLobby = useCallback(() => {
    setInitialRoomSnapshot(null);
    setRouteRoomCode(null);
    window.history.pushState(null, "", "/");
  }, []);

  if (routeRoomCode) {
    return (
      <RoomView
        key={routeRoomCode}
        roomCode={routeRoomCode}
        participantId={participantId}
        initialSnapshot={initialRoomSnapshot}
        onBackToLobby={handleBackToLobby}
      />
    );
  }

  return <LobbyView health={health} healthChecked={healthChecked} onEnterRoom={handleEnterRoom} />;
}

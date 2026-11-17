import { useCallback, useEffect, useRef, useState } from "react";
import type {
  HealthStatus,
  PickMode,
  RoomSnapshot,
  WsClientPayload,
  WsServerPayload,
} from "../shared/types";

const PARTICIPANT_STORAGE_KEY = "pickforus_participant_id";

interface ParsedRoute {
  view: "menu" | "chat";
  mode: PickMode;
  roomCode: string | null;
}

const MODE_PATHS: Record<PickMode, string> = {
  food: "/food",
  destination: "/destination",
  surprise: "/pickforusplease",
};

const CHAT_HEADINGS: Record<PickMode, string> = {
  food: "Talk about where or what to eat!",
  destination: "Talk about where to go!",
  surprise: "Let me pick for you!",
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

function parseBrowserRoute(pathname: string, search: string): ParsedRoute {
  const cleanPath = pathname.trim().toLowerCase().replace(/\/+$/, "") || "/";
  const params = new URLSearchParams(search);
  const queryCode = params.get("room")?.trim().toUpperCase() || null;

  if (cleanPath === "/food") {
    return { view: "chat", mode: "food", roomCode: queryCode };
  }
  if (cleanPath === "/destination") {
    return { view: "chat", mode: "destination", roomCode: queryCode };
  }
  if (cleanPath === "/pickforusplease" || cleanPath === "/pick") {
    return { view: "chat", mode: "surprise", roomCode: queryCode };
  }

  const legacyMatch = /^\/room\/([a-z0-9_-]+)$/i.exec(cleanPath);
  if (legacyMatch?.[1]) {
    return { view: "chat", mode: "food", roomCode: legacyMatch[1].toUpperCase() };
  }

  if (queryCode) {
    return { view: "chat", mode: "food", roomCode: queryCode };
  }

  return { view: "menu", mode: "food", roomCode: null };
}

function extractRoomCodeInput(rawInput: string): string {
  const trimmed = rawInput.trim();
  if (!trimmed) {
    return "";
  }
  const queryMatch = /[?&]room=([A-Za-z0-9_-]+)/i.exec(trimmed);
  if (queryMatch?.[1]) {
    return queryMatch[1].toUpperCase();
  }
  const pathMatch = /\/room\/([A-Za-z0-9_-]+)/i.exec(trimmed);
  if (pathMatch?.[1]) {
    return pathMatch[1].toUpperCase();
  }
  return trimmed.replace(/[^A-Za-z0-9_-]/g, "").toUpperCase();
}

function buildRoomUrl(mode: PickMode, roomCode: string): string {
  return `${MODE_PATHS[mode]}?room=${encodeURIComponent(roomCode.toUpperCase())}`;
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

interface MainMenuProps {
  health: HealthStatus | null;
  healthChecked: boolean;
  onEnterRoom: (snapshot: RoomSnapshot) => void;
}

function MainMenu({ health, healthChecked, onEnterRoom }: MainMenuProps) {
  const [busyMode, setBusyMode] = useState<PickMode | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joining, setJoining] = useState(false);
  const [errorText, setErrorText] = useState<string | null>(null);

  async function handleStartMode(mode: PickMode) {
    if (busyMode !== null || joining) {
      return;
    }
    setBusyMode(mode);
    setErrorText(null);

    try {
      const created = await fetchJson<RoomSnapshot>("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, durationSeconds: 60 }),
      });
      const started = await fetchJson<RoomSnapshot>(
        `/api/rooms/${encodeURIComponent(created.code)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      onEnterRoom(started);
    } catch (err: unknown) {
      setErrorText(err instanceof Error ? err.message : "Could not start a room.");
    } finally {
      setBusyMode(null);
    }
  }

  async function handleJoinRoom(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (joining || busyMode !== null) {
      return;
    }

    const code = extractRoomCodeInput(joinCode);
    if (!code) {
      setErrorText("Enter a 4-letter room code.");
      return;
    }

    setJoining(true);
    setErrorText(null);

    try {
      const snapshot = await fetchJson<RoomSnapshot>(`/api/rooms/${encodeURIComponent(code)}`);
      onEnterRoom(snapshot);
    } catch (err: unknown) {
      if (err instanceof ApiError && err.status === 404) {
        setErrorText(`Room ${code} was not found.`);
      } else {
        setErrorText(err instanceof Error ? err.message : "Could not join room.");
      }
    } finally {
      setJoining(false);
    }
  }

  const engineLine = !healthChecked
    ? "Checking engine status..."
    : health?.ollamaAvailable
      ? `Primary: Gazetteer + NegEx Approval Voting · Fallback: Local Qwen (${health.ollamaModel || "qwen3.5:9b"} ready)`
      : "Primary: Gazetteer + NegEx Approval Voting · Fallback: Local Qwen (offline)";

  return (
    <div className="pfu-menu-page">
      <main className="pfu-menu-center">
        <h1 className="pfu-menu-heading">Pick For Us</h1>

        <div className="pfu-menu-buttons">
          <button
            type="button"
            className="pfu-btn-info pfu-btn-lg"
            disabled={busyMode !== null}
            onClick={() => void handleStartMode("food")}
          >
            {busyMode === "food" ? "Starting..." : "Picking Food"}
          </button>
          <button
            type="button"
            className="pfu-btn-info pfu-btn-lg"
            disabled={busyMode !== null}
            onClick={() => void handleStartMode("destination")}
          >
            {busyMode === "destination" ? "Starting..." : "Picking Destination"}
          </button>
          <button
            type="button"
            className="pfu-btn-info pfu-btn-lg"
            disabled={busyMode !== null}
            onClick={() => void handleStartMode("surprise")}
          >
            {busyMode === "surprise" ? "Starting..." : "Pick For Us please"}
          </button>
        </div>

        <form className="pfu-menu-join" onSubmit={handleJoinRoom}>
          <label htmlFor="join-room-code" className="pfu-menu-join-label">
            Have a room code?
          </label>
          <input
            id="join-room-code"
            type="text"
            className="pfu-menu-code-input"
            placeholder="ABCD"
            value={joinCode}
            onChange={(event) => {
              setJoinCode(event.target.value.toUpperCase());
              if (errorText) setErrorText(null);
            }}
            maxLength={48}
            autoCapitalize="characters"
            autoCorrect="off"
            spellCheck={false}
          />
          <button type="submit" className="pfu-btn-outline" disabled={joining}>
            {joining ? "Joining..." : "Join"}
          </button>
        </form>

        {errorText ? (
          <p className="pfu-menu-error" role="alert">
            {errorText}
          </p>
        ) : null}

        <p className="pfu-menu-status">
          <span
            className={`pfu-status-dot ${health?.ollamaAvailable ? "pfu-status-dot--live" : ""}`}
            aria-hidden="true"
          />
          {engineLine}
        </p>
      </main>
    </div>
  );
}

interface ChatRoomScreenProps {
  roomCode: string;
  participantId: string;
  initialSnapshot: RoomSnapshot | null;
  onBackToMenu: () => void;
  onRouteSync: (snapshot: RoomSnapshot) => void;
}

function ChatRoomScreen({
  roomCode,
  participantId,
  initialSnapshot,
  onBackToMenu,
  onRouteSync,
}: ChatRoomScreenProps) {
  const [snapshot, setSnapshot] = useState<RoomSnapshot | null>(initialSnapshot);
  const [notFound, setNotFound] = useState<boolean>(false);
  const [bannerError, setBannerError] = useState<string | null>(null);
  const [actionBusy, setActionBusy] = useState<boolean>(false);
  const [copiedInvite, setCopiedInvite] = useState<boolean>(false);
  const [chatText, setChatText] = useState<string>("");
  const [sendingChat, setSendingChat] = useState<boolean>(false);

  const wsRef = useRef<WebSocket | null>(null);
  const notFoundRef = useRef<boolean>(false);
  const copyTimerRef = useRef<number | null>(null);
  const feedEndRef = useRef<HTMLDivElement | null>(null);

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
        onRouteSync(fetched);
        setNotFound(false);
        notFoundRef.current = false;
      } catch (err: unknown) {
        if (disposed) return;
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
            setSnapshot(payload.snapshot);
            onRouteSync(payload.snapshot);
            setNotFound(false);
            notFoundRef.current = false;
            setBannerError(null);
          }
        } else if (payload.type === "snapshot") {
          if (payload.snapshot.code === roomCode) {
            setSnapshot(payload.snapshot);
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
  }, [roomCode, participantId, onRouteSync]);

  const messageCount = snapshot?.messages.length ?? 0;

  useEffect(() => {
    if (messageCount > 0) {
      feedEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
    }
  }, [messageCount]);

  async function handleCopyInvite() {
    const ok = await copyTextToClipboard(window.location.href);
    if (!ok) {
      setBannerError("Copy the room link directly from the address bar.");
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

  async function handleDemoChat() {
    if (actionBusy || !snapshot) return;
    if (snapshot.phase === "decided" || snapshot.phase === "deciding") return;
    setActionBusy(true);
    setBannerError(null);
    try {
      const updated = await fetchJson<RoomSnapshot>(
        `/api/rooms/${encodeURIComponent(roomCode)}/simulate`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      setSnapshot(updated);
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : "Could not load demo chat.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handleFinishNow() {
    if (actionBusy || !snapshot) return;
    if (snapshot.phase === "decided" || snapshot.phase === "deciding") return;
    setActionBusy(true);
    setBannerError(null);
    try {
      const updated = await fetchJson<RoomSnapshot>(
        `/api/rooms/${encodeURIComponent(roomCode)}/finish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      setSnapshot(updated);
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : "Could not finish round.");
    } finally {
      setActionBusy(false);
    }
  }

  async function handlePlayAgain() {
    if (actionBusy || !snapshot) return;
    setActionBusy(true);
    setBannerError(null);
    try {
      await fetchJson<RoomSnapshot>(`/api/rooms/${encodeURIComponent(roomCode)}/reset`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ durationSeconds: snapshot.durationSeconds }),
      });
      const started = await fetchJson<RoomSnapshot>(
        `/api/rooms/${encodeURIComponent(roomCode)}/start`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: "{}",
        },
      );
      setSnapshot(started);
    } catch (err: unknown) {
      setBannerError(err instanceof Error ? err.message : "Could not start a new round.");
    } finally {
      setActionBusy(false);
    }
  }

  const handleChatSubmit = useCallback(
    async (event: React.FormEvent<HTMLFormElement>) => {
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
            body: JSON.stringify({ participantId, text: trimmed }),
          },
        );
        setSnapshot(updated);
        setChatText("");
      } catch (err: unknown) {
        setBannerError(err instanceof Error ? err.message : "Could not send message.");
      } finally {
        setSendingChat(false);
      }
    },
    [chatText, participantId, roomCode, sendingChat, snapshot],
  );

  if (notFound) {
    return (
      <div className="pfu-menu-page">
        <div className="pfu-menu-center">
          <h1 className="pfu-menu-heading">Room Not Found</h1>
          <p className="pfu-menu-status">
            Room {roomCode} does not exist anymore. Start a fresh 60-second round from the menu.
          </p>
          <div className="pfu-menu-buttons">
            <button type="button" className="pfu-btn-info pfu-btn-lg" onClick={onBackToMenu}>
              Back to Pick For Us
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!snapshot) {
    return (
      <div className="pfu-chat-page">
        <h1 className="pfu-chat-heading">Joining room {roomCode}...</h1>
      </div>
    );
  }

  const isLowTime = snapshot.phase === "active" && snapshot.remainingSeconds <= 10;
  const hideInputBar = snapshot.phase === "deciding" || snapshot.phase === "decided";
  const verdict = snapshot.verdict;
  const showOverlay =
    snapshot.phase === "deciding" || (snapshot.phase === "decided" && verdict !== null);

  return (
    <div className="pfu-chat-page">
      <div className={`pfu-timer-box ${isLowTime ? "pfu-timer-box--urgent" : ""}`}>
        {snapshot.remainingSeconds}
      </div>

      <header className="pfu-chat-top">
        <h1 className="pfu-chat-heading">{CHAT_HEADINGS[snapshot.mode]}</h1>

        <div className="pfu-helper-bar">
          <button type="button" className="pfu-helper-pill" onClick={onBackToMenu}>
            &larr; Main Menu
          </button>
          <button type="button" className="pfu-helper-pill" onClick={handleCopyInvite}>
            Room {snapshot.code} &middot; {copiedInvite ? "Link Copied!" : "Copy Invite"}
          </button>
          {!hideInputBar ? (
            <>
              <button
                type="button"
                className="pfu-helper-pill"
                disabled={actionBusy}
                onClick={() => void handleDemoChat()}
              >
                Load Demo Chat
              </button>
              <button
                type="button"
                className="pfu-helper-pill pfu-helper-pill--accent"
                disabled={actionBusy}
                onClick={() => void handleFinishNow()}
              >
                Finish Now
              </button>
            </>
          ) : null}
        </div>
      </header>

      {bannerError ? (
        <div className="pfu-error-strip" role="alert">
          {bannerError}
        </div>
      ) : null}

      <div className="pfu-feed-container">
        <ul className="pfu-server-messages">
          {snapshot.participantCount > 1 ? (
            <li>{snapshot.participantCount} users connected</li>
          ) : null}
          <li>You have {snapshot.durationSeconds} seconds to put in your thoughts!</li>
        </ul>

        <ul className="pfu-messages" aria-live="polite">
          {snapshot.messages.map((msg) => (
            <li key={msg.id}>{msg.text}</li>
          ))}
        </ul>
        <div ref={feedEndRef} />
      </div>

      {!hideInputBar ? (
        <form id="message-form" className="pfu-message-form" onSubmit={handleChatSubmit}>
          <div className="pfu-input-group">
            <input
              id="m"
              type="text"
              className="pfu-message-input"
              placeholder="Message..."
              autoComplete="off"
              value={chatText}
              onChange={(event) => setChatText(event.target.value)}
              disabled={sendingChat}
              maxLength={400}
            />
            <button
              type="submit"
              className="pfu-btn-send"
              disabled={sendingChat || chatText.trim().length === 0}
            >
              Send
            </button>
          </div>
        </form>
      ) : null}

      {showOverlay ? (
        <section id="overlay" className="pfu-overlay" aria-label="Group results">
          {snapshot.phase === "deciding" || verdict === null ? (
            <div className="pfu-overlay-thinking">
              <h2>Picking for you...</h2>
              <p>Filtering vetoes and duplicate spam.</p>
            </div>
          ) : (
            <>
              <h2 className="pfu-overlay-title">Top 3:</h2>
              <ol className="pfu-overlay-list">
                {verdict.top3.length > 0 ? (
                  verdict.top3.map((option) => (
                    <li key={option.name}>
                      <span>{option.name}</span>
                      <span className="pfu-vote-meta">
                        ({option.supporters} {option.supporters === 1 ? "vote" : "votes"}
                        {option.mentions > option.supporters ? `, ${option.mentions} mentions` : ""}
                        )
                      </span>
                    </li>
                  ))
                ) : (
                  <li>
                    <span>{verdict.winner}</span>
                    <span className="pfu-vote-meta">(tie-breaker)</span>
                  </li>
                )}
              </ol>

              {verdict.duplicateDetected ? (
                <p className="pfu-overlay-dup">You have duplicates, but we fixed that for you :)</p>
              ) : null}

              {verdict.vetoed.length > 0 ? (
                <p className="pfu-overlay-veto">
                  Excluded (&ldquo;don&apos;t want&rdquo;):{" "}
                  {verdict.vetoed.map((v) => v.name).join(", ")}
                </p>
              ) : null}

              <p className="pfu-overlay-rec">
                {snapshot.mode === "destination"
                  ? `You should definitely check out ${verdict.winner} though!`
                  : `You should definitely go for some ${verdict.winner} though!`}
              </p>

              <p className="pfu-overlay-engine">
                {verdict.engineUsed === "ollama"
                  ? `Fallback Local Qwen (${verdict.modelName ?? "qwen3.5:9b"}) · ${verdict.summary}`
                  : `Approval Voting + NegEx (<2ms) · ${verdict.summary}`}
              </p>

              <div className="pfu-overlay-actions">
                <a
                  href={verdict.mapsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="pfu-btn-info pfu-btn-md"
                >
                  Click here for {verdict.winner} suggestions
                </a>
                <button
                  type="button"
                  className="pfu-btn-outline"
                  disabled={actionBusy}
                  onClick={() => void handlePlayAgain()}
                >
                  Play Again
                </button>
                <button type="button" className="pfu-btn-link" onClick={onBackToMenu}>
                  Main Menu
                </button>
              </div>
            </>
          )}
        </section>
      ) : null}
    </div>
  );
}

export function App() {
  const [participantId] = useState<string>(() => getOrCreateParticipantId());
  const [route, setRoute] = useState<ParsedRoute>(() =>
    parseBrowserRoute(window.location.pathname, window.location.search),
  );
  const [initialSnapshot, setInitialSnapshot] = useState<RoomSnapshot | null>(null);
  const [health, setHealth] = useState<HealthStatus | null>(null);
  const [healthChecked, setHealthChecked] = useState<boolean>(false);
  const autoCreatingRef = useRef<boolean>(false);

  useEffect(() => {
    function handlePopState() {
      setInitialSnapshot(null);
      setRoute(parseBrowserRoute(window.location.pathname, window.location.search));
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
        // Leave null and report offline fallback status.
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
    const nextUrl = buildRoomUrl(snapshot.mode, snapshot.code);
    setInitialSnapshot(snapshot);
    setRoute({ view: "chat", mode: snapshot.mode, roomCode: snapshot.code.toUpperCase() });
    window.history.pushState(null, "", nextUrl);
  }, []);

  const handleRouteSync = useCallback((snapshot: RoomSnapshot) => {
    const targetPath = MODE_PATHS[snapshot.mode];
    const targetQuery = `?room=${encodeURIComponent(snapshot.code.toUpperCase())}`;
    if (window.location.pathname !== targetPath || window.location.search !== targetQuery) {
      window.history.replaceState(null, "", `${targetPath}${targetQuery}`);
    }
  }, []);

  const handleBackToMenu = useCallback(() => {
    setInitialSnapshot(null);
    setRoute({ view: "menu", mode: "food", roomCode: null });
    window.history.pushState(null, "", "/");
  }, []);

  // Support opening /food, /destination, or /pickforusplease directly without ?room=
  useEffect(() => {
    if (route.view !== "chat" || route.roomCode !== null || autoCreatingRef.current) {
      return;
    }
    autoCreatingRef.current = true;

    void (async () => {
      try {
        const created = await fetchJson<RoomSnapshot>("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ mode: route.mode, durationSeconds: 60 }),
        });
        const started = await fetchJson<RoomSnapshot>(
          `/api/rooms/${encodeURIComponent(created.code)}/start`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: "{}",
          },
        );
        setInitialSnapshot(started);
        setRoute({ view: "chat", mode: started.mode, roomCode: started.code });
        window.history.replaceState(null, "", buildRoomUrl(started.mode, started.code));
      } catch {
        // Leave user able to return to menu.
      } finally {
        autoCreatingRef.current = false;
      }
    })();
  }, [route]);

  if (route.view === "chat" && route.roomCode !== null) {
    return (
      <ChatRoomScreen
        key={route.roomCode}
        roomCode={route.roomCode}
        participantId={participantId}
        initialSnapshot={initialSnapshot}
        onBackToMenu={handleBackToMenu}
        onRouteSync={handleRouteSync}
      />
    );
  }

  if (route.view === "chat") {
    return (
      <div className="pfu-chat-page">
        <h1 className="pfu-chat-heading">{CHAT_HEADINGS[route.mode]}</h1>
      </div>
    );
  }

  return <MainMenu health={health} healthChecked={healthChecked} onEnterRoom={handleEnterRoom} />;
}

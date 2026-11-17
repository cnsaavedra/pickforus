import { existsSync } from "node:fs";
import { type Server as HttpServer, createServer } from "node:http";
import path from "node:path";
import express, { type Express, type RequestHandler } from "express";
import { type RawData, WebSocket, WebSocketServer } from "ws";
import { DESTINATION_LEXICON, FOOD_LEXICON } from "../algorithms/gazetteer.js";
import { runDecisionPipeline } from "../algorithms/pipeline.js";
import type {
  HealthStatus,
  PickMode,
  RoomSnapshot,
  WsClientPayload,
  WsServerPayload,
} from "../shared/types.js";
import { PickForUsStore } from "./db.js";

export interface PickForUsServerOptions {
  dbPath?: string;
  distClientDir?: string;
  viteMiddleware?: RequestHandler;
  decideFn?: typeof runDecisionPipeline;
}

export interface PickForUsServer {
  app: Express;
  httpServer: HttpServer;
  wss: WebSocketServer;
  store: PickForUsStore;
  close: () => Promise<void>;
}

interface SimulatedLine {
  participantId: string;
  text: string;
}

const FOOD_SIMULATION_LINES: readonly SimulatedLine[] = [
  { participantId: "sim-1", text: "idk honestly whatever you guys want" },
  { participantId: "sim-2", text: "please I don't want burger again, had it yesterday" },
  { participantId: "sim-3", text: "kinda craving ramen or pho" },
  { participantId: "sim-3", text: "ramen ramen ramen!!" },
  { participantId: "sim-4", text: "down for ramen or tacos, just no sushi" },
];

const DESTINATION_SIMULATION_LINES: readonly SimulatedLine[] = [
  { participantId: "sim-1", text: "idk honestly whatever you guys want" },
  { participantId: "sim-2", text: "please I don't want bowling again, had it yesterday" },
  { participantId: "sim-3", text: "kinda craving arcade or mini golf" },
  { participantId: "sim-3", text: "arcade arcade arcade!!" },
  { participantId: "sim-4", text: "down for arcade or board games, just no karaoke" },
];

function isPickMode(raw: unknown): raw is PickMode {
  return raw === "food" || raw === "destination" || raw === "surprise";
}

function normalizeCode(raw: string | undefined): string {
  return (raw ?? "").trim().toUpperCase();
}

function rawDataToString(data: RawData): string {
  if (typeof data === "string") {
    return data;
  }
  if (Array.isArray(data)) {
    return Buffer.concat(data).toString("utf8");
  }
  if (data instanceof ArrayBuffer) {
    return Buffer.from(data).toString("utf8");
  }
  return data.toString("utf8");
}

export function createPickForUsServer(options?: PickForUsServerOptions): PickForUsServer {
  const dbPath = options?.dbPath ?? process.env.PICKFORUS_DB_PATH ?? "./data/pickforus.sqlite";
  const runDecision = options?.decideFn ?? runDecisionPipeline;

  const store = new PickForUsStore(dbPath);
  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const wss = new WebSocketServer({ noServer: true });

  const roomTimers = new Map<string, NodeJS.Timeout>();
  const decidingRooms = new Set<string>();
  const inFlightDecisions = new Map<string, Promise<RoomSnapshot | null>>();
  const inFlightTokens = new Map<string, symbol>();

  const roomSockets = new Map<string, Set<WebSocket>>();
  const socketMeta = new Map<WebSocket, { roomCode: string; participantId: string }>();

  const sendWs = (ws: WebSocket, payload: WsServerPayload): void => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(payload));
    }
  };

  const broadcastToRoom = (
    roomCode: string,
    payload: WsServerPayload,
    exclude?: WebSocket,
  ): void => {
    const code = normalizeCode(roomCode);
    const sockets = roomSockets.get(code);
    if (sockets === undefined) {
      return;
    }
    const serialized = JSON.stringify(payload);
    for (const client of sockets) {
      if (client !== exclude && client.readyState === WebSocket.OPEN) {
        client.send(serialized);
      }
    }
  };

  const detachSocket = (ws: WebSocket): void => {
    const meta = socketMeta.get(ws);
    if (meta === undefined) {
      return;
    }
    socketMeta.delete(ws);
    const set = roomSockets.get(meta.roomCode);
    if (set !== undefined) {
      set.delete(ws);
      if (set.size === 0) {
        roomSockets.delete(meta.roomCode);
      }
    }
  };

  const attachSocket = (ws: WebSocket, roomCode: string, participantId: string): void => {
    const code = normalizeCode(roomCode);
    const existing = socketMeta.get(ws);
    if (existing !== undefined && existing.roomCode !== code) {
      detachSocket(ws);
    }
    let set = roomSockets.get(code);
    if (set === undefined) {
      set = new Set<WebSocket>();
      roomSockets.set(code, set);
    }
    set.add(ws);
    socketMeta.set(ws, { roomCode: code, participantId });
  };

  const stopRoomTimer = (roomCode: string): void => {
    const code = normalizeCode(roomCode);
    const timer = roomTimers.get(code);
    if (timer !== undefined) {
      clearInterval(timer);
      roomTimers.delete(code);
    }
  };

  const finalizeRoom = async (roomCode: string): Promise<RoomSnapshot | null> => {
    const code = normalizeCode(roomCode);
    const existingFlight = inFlightDecisions.get(code);
    if (existingFlight !== undefined) {
      return existingFlight;
    }

    const current = store.getRoomSnapshot(code);
    if (current === null) {
      return null;
    }
    if (current.phase === "decided" && current.verdict !== null) {
      return current;
    }

    const flightToken = Symbol("finalize-round");
    inFlightTokens.set(code, flightToken);

    const task = (async (): Promise<RoomSnapshot | null> => {
      decidingRooms.add(code);
      stopRoomTimer(code);
      try {
        const snapshotBefore = store.updateRoomState(code, {
          phase: "deciding",
          remainingSeconds: 0,
        });
        if (snapshotBefore === null) {
          return null;
        }
        const targetRound = snapshotBefore.roundNumber;
        const verdict = await Promise.resolve(
          runDecision(snapshotBefore.messages, snapshotBefore.mode),
        );

        const latest = store.getRoomSnapshot(code);
        if (latest === null || latest.roundNumber !== targetRound) {
          return latest;
        }

        store.saveVerdict(code, targetRound, verdict);
        const decided = store.updateRoomState(code, {
          phase: "decided",
          remainingSeconds: 0,
        });
        if (decided !== null) {
          broadcastToRoom(code, { type: "snapshot", snapshot: decided });
        }
        return decided;
      } finally {
        if (inFlightTokens.get(code) === flightToken) {
          inFlightTokens.delete(code);
          decidingRooms.delete(code);
          inFlightDecisions.delete(code);
        }
      }
    })();

    inFlightDecisions.set(code, task);
    return task;
  };

  const handleTick = async (roomCode: string): Promise<void> => {
    const code = normalizeCode(roomCode);
    if (decidingRooms.has(code)) {
      return;
    }
    const room = store.getRoomSnapshot(code);
    if (room === null || room.phase !== "active") {
      stopRoomTimer(code);
      return;
    }

    if (room.remainingSeconds <= 0) {
      stopRoomTimer(code);
      await finalizeRoom(code);
      return;
    }

    const nextRemaining = Math.max(0, room.remainingSeconds - 1);
    if (nextRemaining > 0) {
      store.updateRoomState(code, { remainingSeconds: nextRemaining });
      broadcastToRoom(code, {
        type: "tick",
        roomCode: code,
        remainingSeconds: nextRemaining,
        phase: "active",
      });
      return;
    }

    // Exact 1 -> 0 edge: lock timer and compute verdict once.
    stopRoomTimer(code);
    store.updateRoomState(code, { remainingSeconds: 0, phase: "deciding" });
    broadcastToRoom(code, {
      type: "tick",
      roomCode: code,
      remainingSeconds: 0,
      phase: "deciding",
    });
    await finalizeRoom(code);
  };

  const startRoomTimer = (roomCode: string): void => {
    const code = normalizeCode(roomCode);
    if (roomTimers.has(code) || decidingRooms.has(code)) {
      return;
    }
    const timer = setInterval(() => {
      void handleTick(code);
    }, 1000);
    roomTimers.set(code, timer);
  };

  httpServer.on("upgrade", (request, socket, head) => {
    const rawUrl = request.url ?? "/";
    const pathname = new URL(rawUrl, "http://localhost").pathname;
    if (!pathname.startsWith("/ws")) {
      return;
    }
    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit("connection", ws, request);
    });
  });

  wss.on("connection", (ws) => {
    ws.on("message", (raw) => {
      let payload: WsClientPayload;
      try {
        payload = JSON.parse(rawDataToString(raw)) as WsClientPayload;
      } catch {
        sendWs(ws, { type: "error", message: "Invalid JSON payload." });
        return;
      }

      if (payload === null || typeof payload !== "object" || !("type" in payload)) {
        sendWs(ws, { type: "error", message: "Invalid message format." });
        return;
      }

      if (payload.type === "join") {
        const code = normalizeCode(payload.roomCode);
        const participantId =
          typeof payload.participantId === "string" ? payload.participantId.trim() : "";
        if (code.length === 0 || participantId.length === 0) {
          sendWs(ws, { type: "error", message: "roomCode and participantId are required." });
          return;
        }
        const room = store.getRoomSnapshot(code);
        if (room === null) {
          sendWs(ws, { type: "error", message: `Room ${code} not found.` });
          return;
        }
        const alias = store.getOrAssignAlias(code, participantId);
        attachSocket(ws, code, participantId);
        const snapshot = store.getRoomSnapshot(code) ?? room;
        sendWs(ws, {
          type: "joined",
          roomCode: code,
          participantId,
          alias,
          snapshot,
        });
        broadcastToRoom(code, { type: "snapshot", snapshot }, ws);
        return;
      }

      if (payload.type === "chat") {
        const code = normalizeCode(payload.roomCode);
        const participantId =
          typeof payload.participantId === "string" ? payload.participantId.trim() : "";
        const text = typeof payload.text === "string" ? payload.text.trim() : "";
        if (code.length === 0 || participantId.length === 0) {
          sendWs(ws, { type: "error", message: "roomCode and participantId are required." });
          return;
        }
        if (text.length === 0) {
          sendWs(ws, { type: "error", message: "Message text cannot be empty." });
          return;
        }
        const room = store.getRoomSnapshot(code);
        if (room === null) {
          sendWs(ws, { type: "error", message: `Room ${code} not found.` });
          return;
        }
        if (room.phase === "deciding" || room.phase === "decided") {
          sendWs(ws, { type: "error", message: "Round has already ended." });
          return;
        }
        attachSocket(ws, code, participantId);
        if (room.phase === "lobby") {
          store.updateRoomState(code, { phase: "active" });
          startRoomTimer(code);
        }
        const { snapshot } = store.addMessage(code, participantId, text);
        broadcastToRoom(code, { type: "snapshot", snapshot });
        return;
      }

      sendWs(ws, { type: "error", message: "Unsupported WebSocket message type." });
    });

    ws.on("close", () => {
      detachSocket(ws);
    });

    ws.on("error", () => {
      detachSocket(ws);
    });
  });

  app.get("/api/health", (_req, res) => {
    const status: HealthStatus = {
      ok: true,
      lexiconCounts: {
        food: FOOD_LEXICON.length,
        destination: DESTINATION_LEXICON.length,
      },
    };
    res.json(status);
  });

  app.post("/api/rooms", (req, res) => {
    const body = (req.body ?? {}) as { mode?: unknown; durationSeconds?: unknown };
    let mode: PickMode = "food";
    if (body.mode !== undefined) {
      if (!isPickMode(body.mode)) {
        res.status(400).json({ error: "Invalid mode. Use food, destination, or surprise." });
        return;
      }
      mode = body.mode;
    }

    let durationSeconds = 60;
    if (body.durationSeconds !== undefined) {
      if (
        typeof body.durationSeconds !== "number" ||
        !Number.isFinite(body.durationSeconds) ||
        body.durationSeconds <= 0
      ) {
        res.status(400).json({ error: "durationSeconds must be a positive number." });
        return;
      }
      durationSeconds = Math.min(3600, Math.max(1, Math.floor(body.durationSeconds)));
    }

    const snapshot = store.createRoom(mode, durationSeconds);
    res.status(201).json(snapshot);
  });

  app.get("/api/rooms/:code", (req, res) => {
    const code = normalizeCode(req.params.code);
    const snapshot = store.getRoomSnapshot(code);
    if (snapshot === null) {
      res.status(404).json({ error: "Room not found." });
      return;
    }
    res.json(snapshot);
  });

  app.post("/api/rooms/:code/start", (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = store.getRoomSnapshot(code);
    if (room === null) {
      res.status(404).json({ error: "Room not found." });
      return;
    }
    if (room.phase === "deciding" || room.phase === "decided") {
      res.status(409).json({ error: "Round already ended. Reset to start a new round." });
      return;
    }

    const updated =
      room.phase === "lobby" ? (store.updateRoomState(code, { phase: "active" }) ?? room) : room;
    startRoomTimer(code);
    broadcastToRoom(code, { type: "snapshot", snapshot: updated });
    res.json(updated);
  });

  app.post("/api/rooms/:code/messages", (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = store.getRoomSnapshot(code);
    if (room === null) {
      res.status(404).json({ error: "Room not found." });
      return;
    }
    if (room.phase === "deciding" || room.phase === "decided") {
      res.status(409).json({ error: "Round has already ended." });
      return;
    }

    const body = (req.body ?? {}) as { participantId?: unknown; text?: unknown };
    const participantId = typeof body.participantId === "string" ? body.participantId.trim() : "";
    const text = typeof body.text === "string" ? body.text.trim() : "";

    if (participantId.length === 0) {
      res.status(400).json({ error: "participantId is required." });
      return;
    }
    if (text.length === 0) {
      res.status(400).json({ error: "Message text cannot be empty." });
      return;
    }

    if (room.phase === "lobby") {
      store.updateRoomState(code, { phase: "active" });
      startRoomTimer(code);
    }

    const { snapshot } = store.addMessage(code, participantId, text);
    broadcastToRoom(code, { type: "snapshot", snapshot });
    res.status(201).json(snapshot);
  });

  app.post("/api/rooms/:code/simulate", (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = store.getRoomSnapshot(code);
    if (room === null) {
      res.status(404).json({ error: "Room not found." });
      return;
    }
    if (room.phase === "deciding" || room.phase === "decided") {
      res.status(409).json({ error: "Round has already ended. Reset to simulate again." });
      return;
    }

    const nextRemaining = room.remainingSeconds < 15 ? 15 : room.remainingSeconds;
    store.updateRoomState(code, {
      phase: "active",
      remainingSeconds: nextRemaining,
    });
    startRoomTimer(code);

    const lines =
      room.mode === "destination" ? DESTINATION_SIMULATION_LINES : FOOD_SIMULATION_LINES;
    let latestSnapshot = room;
    for (const line of lines) {
      latestSnapshot = store.addMessage(code, line.participantId, line.text).snapshot;
    }

    broadcastToRoom(code, { type: "snapshot", snapshot: latestSnapshot });
    res.json(latestSnapshot);
  });

  app.post("/api/rooms/:code/finish", async (req, res) => {
    const code = normalizeCode(req.params.code);
    const snapshot = await finalizeRoom(code);
    if (snapshot === null) {
      res.status(404).json({ error: "Room not found." });
      return;
    }
    res.json(snapshot);
  });

  app.post("/api/rooms/:code/reset", (req, res) => {
    const code = normalizeCode(req.params.code);
    const room = store.getRoomSnapshot(code);
    if (room === null) {
      res.status(404).json({ error: "Room not found." });
      return;
    }

    const body = (req.body ?? {}) as { mode?: unknown; durationSeconds?: unknown };
    let nextMode: PickMode | undefined;
    if (body.mode !== undefined) {
      if (!isPickMode(body.mode)) {
        res.status(400).json({ error: "Invalid mode. Use food, destination, or surprise." });
        return;
      }
      nextMode = body.mode;
    }

    let nextDuration: number | undefined;
    if (body.durationSeconds !== undefined) {
      if (
        typeof body.durationSeconds !== "number" ||
        !Number.isFinite(body.durationSeconds) ||
        body.durationSeconds <= 0
      ) {
        res.status(400).json({ error: "durationSeconds must be a positive number." });
        return;
      }
      nextDuration = Math.min(3600, Math.max(1, Math.floor(body.durationSeconds)));
    }

    stopRoomTimer(code);
    inFlightTokens.delete(code);
    inFlightDecisions.delete(code);
    decidingRooms.delete(code);

    const resetOptions: { mode?: PickMode; durationSeconds?: number } = {};
    if (nextMode !== undefined) {
      resetOptions.mode = nextMode;
    }
    if (nextDuration !== undefined) {
      resetOptions.durationSeconds = nextDuration;
    }

    const snapshot = store.resetRoom(code, resetOptions);
    if (snapshot === null) {
      res.status(404).json({ error: "Room not found." });
      return;
    }

    broadcastToRoom(code, { type: "snapshot", snapshot });
    res.json(snapshot);
  });

  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "API route not found." });
  });

  if (options?.viteMiddleware !== undefined) {
    app.use(options.viteMiddleware);
  } else if (options?.distClientDir !== undefined && existsSync(options.distClientDir)) {
    const clientDir = options.distClientDir;
    const indexHtml = path.join(clientDir, "index.html");
    app.use(express.static(clientDir));
    app.get("*", (req, res, next) => {
      if (req.path.startsWith("/api") || req.path.startsWith("/ws")) {
        next();
        return;
      }
      if (existsSync(indexHtml)) {
        res.sendFile(indexHtml);
        return;
      }
      next();
    });
  }

  const close = async (): Promise<void> => {
    for (const timer of roomTimers.values()) {
      clearInterval(timer);
    }
    roomTimers.clear();
    for (const client of wss.clients) {
      client.terminate();
    }
    await new Promise<void>((resolve) => {
      wss.close(() => resolve());
    });
    await new Promise<void>((resolve) => {
      if (httpServer.listening) {
        httpServer.close(() => resolve());
      } else {
        resolve();
      }
    });
    store.close();
  };

  return { app, httpServer, wss, store, close };
}

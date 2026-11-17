import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { runDecisionPipeline } from "../src/algorithms/pipeline.js";
import { type PickForUsServer, createPickForUsServer } from "../src/server/app.js";
import { PickForUsStore } from "../src/server/db.js";
import type { HealthStatus, RoomSnapshot, WsServerPayload } from "../src/shared/types.js";

interface ConnectedWs {
  ws: WebSocket;
  messages: WsServerPayload[];
  waitFor: (
    predicate: (msg: WsServerPayload) => boolean,
    timeoutMs?: number,
  ) => Promise<WsServerPayload>;
}

async function startTestServer(
  options?: Parameters<typeof createPickForUsServer>[0],
): Promise<{ server: PickForUsServer; baseUrl: string; wsUrl: string }> {
  const server = createPickForUsServer({
    dbPath: ":memory:",
    ...options,
  });
  await new Promise<void>((resolve) => {
    server.httpServer.listen(0, "127.0.0.1", () => resolve());
  });
  const addr = server.httpServer.address();
  if (addr === null || typeof addr === "string") {
    throw new Error("Expected ephemeral TCP port address");
  }
  return {
    server,
    baseUrl: `http://127.0.0.1:${addr.port}`,
    wsUrl: `ws://127.0.0.1:${addr.port}/ws`,
  };
}

async function connectWs(wsUrl: string): Promise<ConnectedWs> {
  const ws = new WebSocket(wsUrl);
  const messages: WsServerPayload[] = [];
  const waiters: Array<{
    predicate: (msg: WsServerPayload) => boolean;
    resolve: (msg: WsServerPayload) => void;
    reject: (err: Error) => void;
  }> = [];

  ws.on("message", (raw) => {
    const parsed = JSON.parse(raw.toString("utf8")) as WsServerPayload;
    messages.push(parsed);
    for (let i = waiters.length - 1; i >= 0; i -= 1) {
      const waiter = waiters[i];
      if (waiter?.predicate(parsed)) {
        waiters.splice(i, 1);
        waiter.resolve(parsed);
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    ws.once("open", () => resolve());
    ws.once("error", (err) => reject(err));
  });

  const waitFor = (
    predicate: (msg: WsServerPayload) => boolean,
    timeoutMs = 5000,
  ): Promise<WsServerPayload> => {
    const existing = messages.find(predicate);
    if (existing !== undefined) {
      return Promise.resolve(existing);
    }
    return new Promise<WsServerPayload>((resolve, reject) => {
      const timer = setTimeout(() => {
        const idx = waiters.findIndex((w) => w.resolve === wrappedResolve);
        if (idx >= 0) {
          waiters.splice(idx, 1);
        }
        reject(new Error(`Timed out waiting for WebSocket payload after ${timeoutMs}ms`));
      }, timeoutMs);

      const wrappedResolve = (msg: WsServerPayload): void => {
        clearTimeout(timer);
        resolve(msg);
      };

      waiters.push({
        predicate,
        resolve: wrappedResolve,
        reject: (err) => {
          clearTimeout(timer);
          reject(err);
        },
      });
    });
  };

  return { ws, messages, waitFor };
}

async function closeWsClient(client: ConnectedWs): Promise<void> {
  if (client.ws.readyState === WebSocket.CLOSED) {
    return;
  }
  await new Promise<void>((resolve) => {
    client.ws.once("close", () => resolve());
    client.ws.close();
  });
}

describe("PickForUs server & WebSocket integration", () => {
  const servers: PickForUsServer[] = [];
  const tempDirs: string[] = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const srv = servers.pop();
      if (srv !== undefined) {
        await srv.close();
      }
    }
    while (tempDirs.length > 0) {
      const dir = tempDirs.pop();
      if (dir !== undefined) {
        rmSync(dir, { recursive: true, force: true });
      }
    }
  });

  it("auto-creates parent directory for file-backed SQLite store", () => {
    const root = mkdtempSync(path.join(tmpdir(), "pickforus-db-"));
    tempDirs.push(root);
    const dbFile = path.join(root, "nested", "data", "pickforus.sqlite");

    const store = new PickForUsStore(dbFile);
    const created = store.createRoom("food", 45);
    expect(created.code).toMatch(/^[A-Z0-9]{4}$/);
    store.close();

    const reopened = new PickForUsStore(dbFile);
    const loaded = reopened.getRoomSnapshot(created.code);
    expect(loaded?.code).toBe(created.code);
    reopened.close();
  });

  it("serves /api/health, creates rooms, and returns 404 for unknown rooms", async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const healthRes = await fetch(`${baseUrl}/api/health`);
    expect(healthRes.status).toBe(200);
    const health = (await healthRes.json()) as HealthStatus;
    expect(health.ok).toBe(true);
    expect(health.lexiconCounts.food).toBeGreaterThan(50);
    expect(health.lexiconCounts.destination).toBeGreaterThan(20);

    const createRes = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "food", durationSeconds: 60 }),
    });
    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as RoomSnapshot;
    expect(created.code).toMatch(/^[A-Z0-9]{4}$/);
    expect(created.phase).toBe("lobby");
    expect(created.roundNumber).toBe(1);

    const missingRes = await fetch(`${baseUrl}/api/rooms/ZZZZ`);
    expect(missingRes.status).toBe(404);
  });

  it("runs runDecisionPipeline exactly once when timer hits 0 across 3 WebSocket clients", async () => {
    const decideSpy = vi.fn(runDecisionPipeline);
    const { server, baseUrl, wsUrl } = await startTestServer({ decideFn: decideSpy });
    servers.push(server);

    const createRes = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "food", durationSeconds: 2 }),
    });
    const room = (await createRes.json()) as RoomSnapshot;

    const clients = await Promise.all([connectWs(wsUrl), connectWs(wsUrl), connectWs(wsUrl)]);
    for (let i = 0; i < clients.length; i += 1) {
      const client = clients[i];
      if (client !== undefined) {
        client.ws.send(
          JSON.stringify({ type: "join", roomCode: room.code, participantId: `u-${i + 1}` }),
        );
        await client.waitFor((m) => m.type === "joined");
      }
    }

    await fetch(`${baseUrl}/api/rooms/${room.code}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "u-1", text: "craving pho" }),
    });

    await Promise.all(
      clients.map((client) =>
        client.waitFor((m) => m.type === "snapshot" && m.snapshot.phase === "decided", 4500),
      ),
    );

    expect(decideSpy).toHaveBeenCalledTimes(1);

    const finalRes = await fetch(`${baseUrl}/api/rooms/${room.code}`);
    const finalSnap = (await finalRes.json()) as RoomSnapshot;
    expect(finalSnap.phase).toBe("decided");
    expect(finalSnap.verdict?.winner).toBe("Pho");

    for (const client of clients) {
      await closeWsClient(client);
    }
  });

  it("deduplicates spam via WebSocket join + chat, keeps SQLite open on disconnect, and isolates rounds on reset", async () => {
    const decideSpy = vi.fn(runDecisionPipeline);
    const { server, baseUrl, wsUrl } = await startTestServer({ decideFn: decideSpy });
    servers.push(server);

    const createRes = await fetch(`${baseUrl}/api/rooms`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "food", durationSeconds: 60 }),
    });
    const room = (await createRes.json()) as RoomSnapshot;

    const clientA = await connectWs(wsUrl);
    const clientB = await connectWs(wsUrl);
    const clientC = await connectWs(wsUrl);

    clientA.ws.send(JSON.stringify({ type: "join", roomCode: room.code, participantId: "alice" }));
    const joinedA = (await clientA.waitFor((m) => m.type === "joined")) as Extract<
      WsServerPayload,
      { type: "joined" }
    >;

    clientB.ws.send(JSON.stringify({ type: "join", roomCode: room.code, participantId: "bob" }));
    const joinedB = (await clientB.waitFor((m) => m.type === "joined")) as Extract<
      WsServerPayload,
      { type: "joined" }
    >;

    clientC.ws.send(JSON.stringify({ type: "join", roomCode: room.code, participantId: "carol" }));
    await clientC.waitFor((m) => m.type === "joined");

    expect(joinedA.alias).not.toBe(joinedB.alias);

    for (let i = 0; i < 5; i += 1) {
      clientA.ws.send(
        JSON.stringify({
          type: "chat",
          roomCode: room.code,
          participantId: "alice",
          text: "burger",
        }),
      );
    }
    clientB.ws.send(
      JSON.stringify({ type: "chat", roomCode: room.code, participantId: "bob", text: "ramen" }),
    );
    clientC.ws.send(
      JSON.stringify({ type: "chat", roomCode: room.code, participantId: "carol", text: "ramen" }),
    );

    await clientC.waitFor((m) => m.type === "snapshot" && m.snapshot.messages.length === 7);

    // Concurrent /finish requests must only invoke decideRoom once
    const [finish1, finish2] = await Promise.all([
      fetch(`${baseUrl}/api/rooms/${room.code}/finish`, { method: "POST" }),
      fetch(`${baseUrl}/api/rooms/${room.code}/finish`, { method: "POST" }),
    ]);
    expect(finish1.status).toBe(200);
    expect(finish2.status).toBe(200);
    expect(decideSpy).toHaveBeenCalledTimes(1);

    const round1 = (await finish1.json()) as RoomSnapshot;
    expect(round1.verdict?.winner).toBe("Ramen");
    expect(round1.verdict?.duplicateDetected).toBe(true);
    expect(round1.verdict?.top3.find((o) => o.name === "Ramen")?.supporters).toBe(2);
    expect(round1.verdict?.top3.find((o) => o.name === "Burgers")).toMatchObject({
      supporters: 1,
      mentions: 5,
    });

    // Post-round chat must be rejected cleanly
    const postRoundRes = await fetch(`${baseUrl}/api/rooms/${room.code}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "bob", text: "tacos" }),
    });
    expect(postRoundRes.status).toBe(409);

    // Disconnecting WS must NOT close SQLite
    await closeWsClient(clientA);
    await closeWsClient(clientB);

    const resetRes = await fetch(`${baseUrl}/api/rooms/${room.code}/reset`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ durationSeconds: 30 }),
    });
    expect(resetRes.status).toBe(200);
    const round2Reset = (await resetRes.json()) as RoomSnapshot;
    expect(round2Reset.roundNumber).toBe(2);
    expect(round2Reset.phase).toBe("lobby");
    expect(round2Reset.remainingSeconds).toBe(30);
    expect(round2Reset.messages).toEqual([]);
    expect(round2Reset.verdict).toBeNull();

    // Rejoin with alice and verify alias stability across rounds
    const clientA2 = await connectWs(wsUrl);
    clientA2.ws.send(JSON.stringify({ type: "join", roomCode: room.code, participantId: "alice" }));
    const rejoinedA = (await clientA2.waitFor((m) => m.type === "joined")) as Extract<
      WsServerPayload,
      { type: "joined" }
    >;
    expect(rejoinedA.alias).toBe(joinedA.alias);

    await fetch(`${baseUrl}/api/rooms/${room.code}/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ participantId: "alice", text: "tacos tonight" }),
    });
    const round2Done = (await (
      await fetch(`${baseUrl}/api/rooms/${room.code}/finish`, { method: "POST" })
    ).json()) as RoomSnapshot;

    expect(round2Done.roundNumber).toBe(2);
    expect(round2Done.messages).toHaveLength(1);
    expect(round2Done.verdict?.winner).toBe("Tacos");
    expect(round2Done.verdict?.top3.map((o) => o.name)).toEqual(["Tacos"]);

    await closeWsClient(clientA2);
    await closeWsClient(clientC);
  });

  it("supports simulate endpoint for food and destination modes", async () => {
    const { server, baseUrl } = await startTestServer();
    servers.push(server);

    const foodRoom = (await (
      await fetch(`${baseUrl}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "food", durationSeconds: 5 }),
      })
    ).json()) as RoomSnapshot;

    const foodSim = (await (
      await fetch(`${baseUrl}/api/rooms/${foodRoom.code}/simulate`, { method: "POST" })
    ).json()) as RoomSnapshot;
    expect(foodSim.phase).toBe("active");
    expect(foodSim.remainingSeconds).toBeGreaterThanOrEqual(15);
    expect(foodSim.messages).toHaveLength(5);

    const foodDone = (await (
      await fetch(`${baseUrl}/api/rooms/${foodRoom.code}/finish`, { method: "POST" })
    ).json()) as RoomSnapshot;
    expect(foodDone.verdict?.winner).toBe("Ramen");
    expect(foodDone.verdict?.duplicateDetected).toBe(true);
    expect(foodDone.verdict?.vetoed.map((v) => v.name)).toEqual(
      expect.arrayContaining(["Burgers", "Sushi"]),
    );

    const destRoom = (await (
      await fetch(`${baseUrl}/api/rooms`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "destination", durationSeconds: 30 }),
      })
    ).json()) as RoomSnapshot;

    const destSim = (await (
      await fetch(`${baseUrl}/api/rooms/${destRoom.code}/simulate`, { method: "POST" })
    ).json()) as RoomSnapshot;
    expect(destSim.messages).toHaveLength(5);

    const destDone = (await (
      await fetch(`${baseUrl}/api/rooms/${destRoom.code}/finish`, { method: "POST" })
    ).json()) as RoomSnapshot;
    expect(destDone.verdict?.winner).toBe("Arcade");
    expect(destDone.verdict?.vetoed.map((v) => v.name)).toEqual(
      expect.arrayContaining(["Bowling", "Karaoke"]),
    );
  });
});

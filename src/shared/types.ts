export type PickMode = "food" | "destination" | "surprise";

export type RoomPhase = "lobby" | "active" | "deciding" | "decided";

export type LlmMode = "auto" | "ollama" | "rules";

export interface ChatEntry {
  id: string;
  roomCode: string;
  roundNumber: number;
  participantId: string;
  alias: string;
  text: string;
  createdAt: string;
}

export interface RankedOption {
  name: string;
  supporters: number;
  mentions: number;
  sampleQuotes: string[];
}

export interface VetoedOption {
  name: string;
  vetoedByCount: number;
  reason: string;
}

export interface DecisionVerdict {
  winner: string;
  summary: string;
  top3: RankedOption[];
  vetoed: VetoedOption[];
  duplicateDetected: boolean;
  duplicateNote: string | null;
  engineUsed: "ollama" | "rules";
  modelName: string | null;
  mapsUrl: string;
  decidedAt: string;
}

export interface RoomSnapshot {
  code: string;
  mode: PickMode;
  durationSeconds: number;
  remainingSeconds: number;
  phase: RoomPhase;
  roundNumber: number;
  participantCount: number;
  messages: ChatEntry[];
  verdict: DecisionVerdict | null;
}

export interface HealthStatus {
  ok: boolean;
  ollamaAvailable: boolean;
  ollamaModel: string;
  llmMode: LlmMode;
}

export type WsClientPayload =
  | {
      type: "join";
      roomCode: string;
      participantId: string;
    }
  | {
      type: "chat";
      roomCode: string;
      participantId: string;
      text: string;
    };

export type WsServerPayload =
  | {
      type: "joined";
      roomCode: string;
      participantId: string;
      alias: string;
      snapshot: RoomSnapshot;
    }
  | {
      type: "snapshot";
      snapshot: RoomSnapshot;
    }
  | {
      type: "tick";
      roomCode: string;
      remainingSeconds: number;
      phase: RoomPhase;
    }
  | {
      type: "error";
      message: string;
    };

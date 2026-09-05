import "server-only";
import type { DataStore } from "./DataStore";
import { GoogleSheetsDataStore } from "./google-sheets/GoogleSheetsDataStore";

/**
 * Factory: picks a DataStore implementation based on DATA_STORE_PROVIDER.
 * This is the *only* place that decides which concrete backend is used —
 * every caller works against the DataStore interface, so adding a new
 * backend means writing a new implementation and adding one case here.
 */
function createDataStore(): DataStore {
  const provider = (process.env.DATA_STORE_PROVIDER ?? "google-sheets").toLowerCase();

  switch (provider) {
    case "google-sheets":
      return new GoogleSheetsDataStore();
    default:
      throw new Error(
        `Unknown DATA_STORE_PROVIDER "${provider}". Supported: "google-sheets".`,
      );
  }
}

let cachedStore: DataStore | null = null;

export function getDataStore(): DataStore {
  if (!cachedStore) cachedStore = createDataStore();
  return cachedStore;
}

export type {
  Group,
  GroupUpdate,
  Guest,
  GuestSource,
  GuestUpdate,
  NewGroup,
  NewGuest,
  NewVote,
  Vote,
  VotingStatus,
} from "./types";
export type { DataStore } from "./DataStore";

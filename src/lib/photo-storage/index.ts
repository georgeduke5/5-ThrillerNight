import "server-only";
import type { PhotoStorage } from "./PhotoStorage";
import { GoogleDrivePhotoStorage } from "./google-drive/GoogleDrivePhotoStorage";

function createPhotoStorage(): PhotoStorage {
  const provider = (process.env.PHOTO_STORAGE_PROVIDER ?? "google-drive").toLowerCase();

  switch (provider) {
    case "google-drive":
      return new GoogleDrivePhotoStorage();
    default:
      throw new Error(`Unknown PHOTO_STORAGE_PROVIDER "${provider}". Supported: "google-drive".`);
  }
}

let cached: PhotoStorage | null = null;

export function getPhotoStorage(): PhotoStorage {
  if (!cached) cached = createPhotoStorage();
  return cached;
}

export type { PhotoStorage, UploadPhotoInput, UploadedPhoto } from "./PhotoStorage";

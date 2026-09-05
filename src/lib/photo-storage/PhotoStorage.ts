export interface UploadedPhoto {
  /** Storage-specific reference (e.g. a Drive file id), persisted via DataStore.savePhotoReference. */
  ref: string;
  /** Directly usable URL for rendering the photo. */
  url: string;
}

export interface UploadPhotoInput {
  fileName: string;
  mimeType: string;
  data: Buffer;
}

/**
 * Binary photo storage is a separate concern from the DataStore: DataStore
 * only ever persists a photo *reference* string against a guest. Where the
 * actual bytes live (Google Drive today, something else later) is decided
 * here, behind this interface, via the factory in ./index.ts.
 */
export interface PhotoStorage {
  uploadPhoto(input: UploadPhotoInput): Promise<UploadedPhoto>;
  /**
   * Best-effort cleanup for a photo whose upload otherwise succeeded but
   * couldn't be recorded against a guest (e.g. the DataStore write failed
   * after the file was already created). Callers should treat failure here
   * as non-fatal and just log it — the original error is what matters.
   */
  deletePhoto(ref: string): Promise<void>;
}

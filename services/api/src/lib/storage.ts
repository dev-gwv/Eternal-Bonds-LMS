import type { Env } from '../env.ts';
import { serviceClient } from './supabase.ts';

/**
 * Storage behind a narrow interface. Today it is Supabase Storage; the surface
 * is small enough that swapping to S3/R2 is one file, not a refactor.
 */
export interface Storage {
  signedUploadUrl(key: string): Promise<{ url: string; token: string }>;
  signedDownloadUrl(key: string, expiresInSeconds?: number): Promise<string>;
  remove(keys: string[]): Promise<void>;
}

export function createStorage(env: Env): Storage {
  const bucket = () => serviceClient(env).storage.from(env.STORAGE_BUCKET);

  return {
    async signedUploadUrl(key) {
      const { data, error } = await bucket().createSignedUploadUrl(key);
      if (error) throw error;
      return { url: data.signedUrl, token: data.token };
    },
    async signedDownloadUrl(key, expiresInSeconds = 900) {
      const { data, error } = await bucket().createSignedUrl(key, expiresInSeconds);
      if (error) throw error;
      return data.signedUrl;
    },
    async remove(keys) {
      const { error } = await bucket().remove(keys);
      if (error) throw error;
    },
  };
}

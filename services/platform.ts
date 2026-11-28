import { Capacitor, CapacitorHttp } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

const TIMEOUT_MS = 45000;

const proxied = (url: string) => `https://corsproxy.io/?${encodeURIComponent(url)}`;

const base64ToBlob = (b64: string): Blob => {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes]);
};

/**
 * Downloads a file that the browser would normally block via CORS.
 * On Android it uses native HTTP (no proxy); on the web it falls back to a public CORS proxy.
 */
export async function fetchCrossOrigin(url: string, as: 'text'): Promise<string>;
export async function fetchCrossOrigin(url: string, as: 'blob'): Promise<Blob>;
export async function fetchCrossOrigin(url: string, as: 'text' | 'blob'): Promise<string | Blob> {
  if (isNative) {
    const res = await CapacitorHttp.get({
      url,
      responseType: as === 'blob' ? 'arraybuffer' : 'text',
      connectTimeout: 15000,
      readTimeout: TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) throw new Error(`HTTP Error: ${res.status}`);
    return as === 'blob' ? base64ToBlob(res.data as string) : String(res.data);
  }
  const res = await fetch(proxied(url), { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP Error: ${res.status}`);
  return as === 'blob' ? res.blob() : res.text();
}

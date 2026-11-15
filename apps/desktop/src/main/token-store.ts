import { readFile, rename, rm, writeFile } from 'node:fs/promises';
import { safeStorage } from 'electron';
import type { TokenStore } from './auth-session.ts';

/**
 * Keeps the refresh token in a file encrypted with Electron's safeStorage: Keychain on macOS,
 * DPAPI on Windows (ARCHITECTURE §9). Without OS encryption the token is kept in memory only,
 * so the user signs in again after a restart rather than having it stored in plain text.
 */
export class SafeStorageTokenStore implements TokenStore {
  readonly #file: string;
  #memory: string | null = null;

  constructor(file: string) {
    this.#file = file;
  }

  async load(): Promise<string | null> {
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return this.#memory;
    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.#file);
    } catch {
      return null; // not signed in on this machine yet
    }
    try {
      const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(encrypted);
      if (shouldReEncrypt) await this.save(result); // the OS key was rotated
      return result;
    } catch {
      return null; // can't be decrypted (e.g. the keychain was reset): sign in again
    }
  }

  async save(refreshToken: string | null): Promise<void> {
    this.#memory = refreshToken;
    if (refreshToken === null) {
      await rm(this.#file, { force: true });
      return;
    }
    if (!(await safeStorage.isAsyncEncryptionAvailable())) return;
    // Write then rename, so a crash never leaves half a token behind.
    const temporary = `${this.#file}.tmp`;
    await writeFile(temporary, await safeStorage.encryptStringAsync(refreshToken), { mode: 0o600 });
    await rename(temporary, this.#file);
  }
}

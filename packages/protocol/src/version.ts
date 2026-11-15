/**
 * Version of the client–server wire contract.
 *
 * Bump it on any breaking change to HTTP payloads or WebSocket messages.
 * The server accepts clients whose protocol version lies in
 * [MIN_SUPPORTED_PROTOCOL_VERSION, PROTOCOL_VERSION] and asks every other
 * client to download a new version (DECISIONS A33).
 */
export const PROTOCOL_VERSION = 1;

/** Oldest client protocol version the current server still serves. */
export const MIN_SUPPORTED_PROTOCOL_VERSION = 1;

export function isProtocolSupported(clientProtocolVersion: number): boolean {
  return (
    Number.isInteger(clientProtocolVersion) &&
    clientProtocolVersion >= MIN_SUPPORTED_PROTOCOL_VERSION &&
    clientProtocolVersion <= PROTOCOL_VERSION
  );
}

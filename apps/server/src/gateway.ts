import type { FastifyInstance } from 'fastify';
import type { RawData, WebSocket } from 'ws';
import {
  ClientMessage,
  GatewayCloseCode,
  MIN_SUPPORTED_PROTOCOL_VERSION,
  PROTOCOL_VERSION,
  isProtocolSupported,
  parseFrame,
  type ServerMessage,
} from '@hasbihal/protocol';
import type { Config } from './config.ts';

function rawToString(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString('utf8');
  if (data instanceof ArrayBuffer) return Buffer.from(data).toString('utf8');
  return data.toString('utf8');
}

function send(socket: WebSocket, message: ServerMessage): void {
  socket.send(JSON.stringify(message));
}

/**
 * The real-time gateway (ARCHITECTURE §5). In M0 it only performs the version
 * handshake (DECISIONS A33) and answers pings. Authentication, presence, and
 * event fan-out arrive in M1.
 */
export function registerGateway(app: FastifyInstance, config: Config): void {
  app.get('/ws', { websocket: true }, (socket, request) => {
    let greeted = false;
    const helloTimer = setTimeout(() => {
      send(socket, { type: 'error', code: 'hello_required', message: 'Send hello first.' });
      socket.close(GatewayCloseCode.protocolViolation, 'hello timeout');
    }, config.helloTimeoutMs);

    socket.on('close', () => {
      clearTimeout(helloTimer);
    });

    socket.on('message', (data, isBinary) => {
      const message = isBinary ? undefined : parseFrame(ClientMessage, rawToString(data));
      if (!message) {
        send(socket, { type: 'error', code: 'bad_message', message: 'Unrecognized frame.' });
        socket.close(GatewayCloseCode.protocolViolation, 'bad message');
        return;
      }

      if (!greeted && message.type !== 'hello') {
        send(socket, { type: 'error', code: 'hello_required', message: 'Send hello first.' });
        socket.close(GatewayCloseCode.protocolViolation, 'hello required');
        return;
      }

      switch (message.type) {
        case 'hello': {
          clearTimeout(helloTimer);
          if (!isProtocolSupported(message.protocolVersion)) {
            request.log.info(
              { clientVersion: message.clientVersion, protocolVersion: message.protocolVersion },
              'client too old or too new; asking it to upgrade',
            );
            send(socket, {
              type: 'upgrade_required',
              minProtocolVersion: MIN_SUPPORTED_PROTOCOL_VERSION,
              maxProtocolVersion: PROTOCOL_VERSION,
            });
            socket.close(GatewayCloseCode.upgradeRequired, 'upgrade required');
            return;
          }
          greeted = true;
          send(socket, {
            type: 'welcome',
            serverVersion: config.serverVersion,
            protocolVersion: PROTOCOL_VERSION,
          });
          return;
        }
        case 'ping': {
          send(socket, { type: 'pong' });
          return;
        }
      }
    });
  });
}

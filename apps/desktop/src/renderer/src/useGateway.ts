import { useEffect, useState } from 'react';
import { GatewayClient, type GatewayStatus } from '@hasbihal/core';

function toWebSocketUrl(serverUrl: string): string {
  const url = new URL('/ws', serverUrl);
  url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:';
  return url.toString();
}

export function useGateway(serverUrl: string, clientVersion: string): GatewayStatus {
  const [status, setStatus] = useState<GatewayStatus>({ kind: 'connecting', attempt: 0 });

  useEffect(() => {
    const client = new GatewayClient({
      url: toWebSocketUrl(serverUrl),
      clientVersion,
      createSocket: (url) => new WebSocket(url),
      onStatus: setStatus,
    });
    client.start();
    return () => {
      client.stop();
    };
  }, [serverUrl, clientVersion]);

  return status;
}

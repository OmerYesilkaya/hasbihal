import type { MessageKey } from './tr.ts';

export const en: Record<MessageKey, string> = {
  'app.name': 'Hasbihal',
  'app.tagline': 'Family and friends',
  'connection.connecting': 'Connecting…',
  'connection.connected': 'Connected',
  'connection.offline': 'Can’t reach the server',
  'connection.upgradeRequired': 'A new version is available. Download and install it to continue.',
  'rooms.heading': 'Rooms',
  'members.heading': 'Members',
  'members.count': '{count, plural, one {# member} other {# members}}',
  'composer.placeholder': 'Message · {room}',
  'placeholder.welcome': 'Welcome. Rooms and chat will be here soon.',
};

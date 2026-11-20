import { QueryClient } from '@tanstack/react-query';
import type { AuthError } from '../../shared/app-info.ts';
import type { ApiResult } from './api.ts';

/** A failed request, thrown for TanStack Query: the client itself returns errors, never throws. */
export class ApiFailure extends Error {
  readonly error: AuthError;

  constructor(error: AuthError) {
    super(error.message);
    this.name = 'ApiFailure';
    this.error = error;
  }
}

/** The value of a request, or an `ApiFailure` thrown: for query and mutation functions. */
export async function unwrap<T>(pending: Promise<ApiResult<T>>): Promise<T> {
  const result = await pending;
  if (!result.ok) throw new ApiFailure(result.error);
  return result.value;
}

/**
 * Keys of the data that screens fetch for themselves (#46). Rooms, members, messages and
 * presence aren't here: the server pushes those, and they live in the `ChatStore`.
 */
export const queryKeys = {
  sessions: ['me', 'sessions'],
  invites: ['admin', 'invites'],
  events: ['events'],
  eventWindow: (roomId: string | null, days: number) => ['events', { roomId, days }],
  search: (q: string) => ['search', q],
} as const;

/**
 * One cache per signed-in session (it goes with the shell on sign-out). Not reloaded on window
 * focus: the gateway says when things change (events) or may have (a reconnect), and the shell
 * marks those queries stale then.
 */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        refetchOnWindowFocus: false,
        // Only a server that couldn't be reached is worth trying again.
        retry: (failures, error) =>
          failures < 2 && error instanceof ApiFailure && error.error.code === 'unavailable',
      },
      mutations: { retry: false },
    },
  });
}

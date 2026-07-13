import AsyncStorage from '@react-native-async-storage/async-storage';
import type { CompletionsResponse, TodayResponse, WeekDayDto } from '@athlete-guide/shared-types';

/**
 * A tiny offline cache for the Today view: the last successful load bundle,
 * so a cold open at the rink with no signal shows the last saved day instead
 * of an error card. Scoped to the acting identity so one user's data is never
 * shown to another after a sign-out or a persona/child switch.
 */

export interface TodayBundle {
  today: TodayResponse;
  comp: CompletionsResponse | null;
  week: WeekDayDto[];
  /** When it was cached (ISO), for the "last saved" banner. */
  savedAt: string;
}

/**
 * Stable per-identity key. Dev mode carries `x-user-id`; OIDC mode carries a
 * bearer token whose `sub` claim is stable per user (the token string itself
 * rotates, so we decode the claim rather than key on the raw header).
 */
export function identityKey(headers: Record<string, string>): string | null {
  if (headers['x-user-id']) return `u:${headers['x-user-id']}`;
  const auth = headers.authorization ?? headers.Authorization;
  if (auth?.startsWith('Bearer ')) {
    try {
      const payload = auth.slice(7).split('.')[1];
      const json = JSON.parse(
        decodeURIComponent(
          atob(payload.replace(/-/g, '+').replace(/_/g, '/'))
            .split('')
            .map((c) => `%${c.charCodeAt(0).toString(16).padStart(2, '0')}`)
            .join(''),
        ),
      ) as { sub?: string };
      return json.sub ? `s:${json.sub}` : null;
    } catch {
      return null;
    }
  }
  return null;
}

const keyFor = (id: string, child?: string) => `today:${id}${child ? `:c:${child}` : ''}`;

/** The identity/child scope for a set of request headers. */
function scope(headers: Record<string, string>): string | null {
  const id = identityKey(headers);
  return id ? keyFor(id, headers['x-child-id']) : null;
}

export async function saveTodayBundle(
  headers: Record<string, string>,
  bundle: Omit<TodayBundle, 'savedAt'>,
): Promise<void> {
  const key = scope(headers);
  if (!key) return;
  try {
    await AsyncStorage.setItem(key, JSON.stringify({ ...bundle, savedAt: new Date().toISOString() }));
  } catch {
    // A failed cache write must never surface to the user.
  }
}

export async function readTodayBundle(
  headers: Record<string, string>,
): Promise<TodayBundle | null> {
  const key = scope(headers);
  if (!key) return null;
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as TodayBundle) : null;
  } catch {
    return null;
  }
}

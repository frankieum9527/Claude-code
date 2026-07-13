import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import type { WeekDayDto } from '@athlete-guide/shared-types';

/**
 * Local training reminders, scheduled on-device from the week the app has
 * already fetched (GET /me/week) — no server push needed. Two kinds:
 *
 * - A morning check-in (8:00 local) whose copy matches the day: game,
 *   practice, home session, or off-season program session. Rest days stay
 *   quiet — a reminder to do nothing trains people to ignore reminders.
 * - An hour-before nudge for team events (games/practices).
 *
 * Everything is re-derived and re-scheduled whenever fresh week data loads
 * with reminders enabled, so schedule changes propagate on next app open.
 * Server push (coach feedback, schedule changes while the app is closed)
 * arrives with the deployment phase.
 */

export const remindersSupported = Platform.OS !== 'web';

if (remindersSupported) {
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldPlaySound: false,
      shouldSetBadge: false,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

// The permission result's base type (`PermissionResponse from 'expo'`) doesn't
// resolve its members in this TS project; we only need the status string.
type Permissionish = { status: string };

export async function ensurePermission(): Promise<boolean> {
  if (!remindersSupported) return false;
  try {
    const current = (await Notifications.getPermissionsAsync()) as Permissionish;
    if (current.status === 'granted') return true;
    const asked = (await Notifications.requestPermissionsAsync()) as Permissionish;
    return asked.status === 'granted';
  } catch {
    return false;
  }
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

/** The morning check-in for a day, or null for days that should stay quiet. */
export function morningMessage(day: WeekDayDto): { title: string; body: string } | null {
  switch (day.dayType) {
    case 'GAME_DAY':
      return {
        title: 'Game day 🏒',
        body: day.event
          ? `Puck drops at ${formatTime(day.event.startsAt)}. Your warm-up is ready in Upward.`
          : 'Your warm-up is ready in Upward.',
      };
    case 'PRACTICE_DAY':
      return {
        title: 'Practice today',
        body: day.event
          ? `On the ice at ${formatTime(day.event.startsAt)}. Warm-up is ready when you are.`
          : 'Warm-up is ready when you are.',
      };
    case 'IN_SEASON_OFF_DAY':
      return {
        title: 'Home training day',
        body: 'Your session is waiting — keep the streak alive.',
      };
    case 'OFF_SEASON':
      return day.programSession
        ? { title: 'Training day', body: 'Your off-season session is ready in Upward.' }
        : null;
  }
}

/**
 * Replace all scheduled reminders with ones derived from `days`.
 * Returns how many were scheduled (0 on unsupported platforms).
 */
export async function syncReminders(days: WeekDayDto[]): Promise<number> {
  if (!remindersSupported) return 0;
  if (Platform.OS === 'android') {
    await Notifications.setNotificationChannelAsync('reminders', {
      name: 'Training reminders',
      importance: Notifications.AndroidImportance.DEFAULT,
    });
  }
  await Notifications.cancelAllScheduledNotificationsAsync();

  const now = Date.now();
  const channelId = Platform.OS === 'android' ? 'reminders' : undefined;
  let scheduled = 0;
  const schedule = async (title: string, body: string, at: Date) => {
    if (at.getTime() <= now) return;
    await Notifications.scheduleNotificationAsync({
      content: { title, body },
      trigger: { type: Notifications.SchedulableTriggerInputTypes.DATE, date: at, channelId },
    });
    scheduled++;
  };

  for (const day of days) {
    const morning = morningMessage(day);
    if (morning) {
      await schedule(morning.title, morning.body, new Date(`${day.date}T08:00:00`));
    }
    if (day.event) {
      const label = day.event.type === 'game' ? 'Game' : 'Practice';
      await schedule(
        `${label} in one hour`,
        `Starts at ${formatTime(day.event.startsAt)} — time to get moving.`,
        new Date(new Date(day.event.startsAt).getTime() - 60 * 60 * 1000),
      );
    }
  }
  return scheduled;
}

export async function cancelReminders(): Promise<void> {
  if (!remindersSupported) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

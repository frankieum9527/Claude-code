/**
 * Background ICS re-sync: keeps connected team calendars fresh without the
 * coach pressing "Sync now".
 *
 * Runs in-process for now — a tick loop that finds due teams and syncs them
 * with per-team error isolation. When Redis/BullMQ arrive for the video
 * pipeline (Phase 2), this becomes a repeatable queue job; `runTrackedTeamSync`
 * is the piece that carries over unchanged.
 */
import type { FastifyBaseLogger } from 'fastify';
import { prisma } from '../db.js';
import { syncTeamIcs, type IcsImportResult } from './ics.js';

export interface SyncableTeam {
  id: string;
  icsUrl: string | null;
  icsLastSyncedAt: Date | null;
}

/** A team is due when it has a feed and hasn't been synced within the interval. */
export function isDueForSync(team: SyncableTeam, now: Date, intervalMs: number): boolean {
  if (!team.icsUrl) return false;
  if (!team.icsLastSyncedAt) return true;
  return now.getTime() - team.icsLastSyncedAt.getTime() >= intervalMs;
}

export type TrackedSyncResult =
  | { ok: true; result: IcsImportResult }
  | { ok: false; error: string };

/**
 * Sync one team and record feed health on the Team row. Never throws — used
 * by both the scheduler and the manual sync endpoint so coaches always see
 * the latest status either way.
 */
export async function runTrackedTeamSync(teamId: string): Promise<TrackedSyncResult> {
  try {
    const result = await syncTeamIcs(teamId);
    await prisma.team.update({
      where: { id: teamId },
      data: { icsLastSyncedAt: new Date(), icsSyncStatus: 'ok', icsSyncError: null },
    });
    return { ok: true, result };
  } catch (e) {
    const error = (e instanceof Error ? e.message : String(e)).slice(0, 500);
    await prisma.team.update({
      where: { id: teamId },
      data: { icsLastSyncedAt: new Date(), icsSyncStatus: 'error', icsSyncError: error },
    });
    return { ok: false, error };
  }
}

export interface SchedulerOptions {
  /** Re-sync each connected team this often. */
  intervalMs: number;
  /** How often to look for due teams; defaults to min(60s, intervalMs / 4). */
  tickMs?: number;
  logger?: FastifyBaseLogger;
}

/** Starts the tick loop; returns a stop function (wired to fastify onClose). */
export function startIcsSyncScheduler(opts: SchedulerOptions): () => void {
  const tickMs = opts.tickMs ?? Math.min(60_000, Math.max(1_000, opts.intervalMs / 4));
  let running = false;

  const tick = async () => {
    if (running) return; // skip a tick rather than overlap a slow one
    running = true;
    try {
      const candidates = await prisma.team.findMany({
        where: { icsUrl: { not: null } },
        select: { id: true, icsUrl: true, icsLastSyncedAt: true },
      });
      const now = new Date();
      for (const team of candidates.filter((t) => isDueForSync(t, now, opts.intervalMs))) {
        const outcome = await runTrackedTeamSync(team.id);
        if (outcome.ok) {
          const { created, updated, removed } = outcome.result;
          if (created || updated || removed) {
            opts.logger?.info({ teamId: team.id, ...outcome.result }, 'ics sync applied changes');
          }
        } else {
          opts.logger?.warn({ teamId: team.id, error: outcome.error }, 'ics sync failed');
        }
      }
    } catch (e) {
      opts.logger?.error({ err: e }, 'ics sync tick failed');
    } finally {
      running = false;
    }
  };

  const handle = setInterval(tick, tickMs);
  handle.unref?.(); // don't keep the process alive just for the scheduler
  void tick(); // first pass immediately on boot
  return () => clearInterval(handle);
}

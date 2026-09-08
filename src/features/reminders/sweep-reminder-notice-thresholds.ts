import "server-only";

import { and, eq, inArray, isNull } from "drizzle-orm";

import { db } from "@/db";
import { buildings, reminderNoticeThresholds, reminders } from "@/db/schema";
import { formatDateSlug } from "@/lib/format-date";

import { REMINDER_ACTIVE_STATUSES } from "./reminder-schema";
import { daysBetween } from "./reminder-urgency";

// Un umbral que se marcó como avisado en ESTA corrida, con lo que el mail
// dedicado (send-reminder-thresholds-email.ts) necesita para armar su fila.
export type MarkedNoticeThreshold = {
  thresholdId: string;
  reminderId: string;
  reminderTitle: string;
  // `null` = evento "General" (sin edificio). El mail lo redacta sin la
  // parte "(edificio)".
  buildingName: string | null;
  noticeDays: number;
  dueDate: string;
};

export type SweepReminderNoticeThresholdsResult =
  { ok: true; marked: MarkedNoticeThreshold[] } | { ok: false; error: string };

// Barrido diario del aviso DEDICADO por umbral (paso 3 de "múltiples
// umbrales de aviso") -- corre junto a sweepDueReminders, una vez al día
// por organización (run-daily-cron.ts). Es una capa NUEVA al lado: no toca
// `reminders.notice_days`, ni `getReminderUrgency`, ni la campana
// (`sweepDueReminders`).
//
// Para cada `reminder_notice_thresholds` activo (`deleted_at IS NULL`) con
// `notified_at IS NULL`, de un recordatorio `pending`/`notified` no
// borrado, que ya entró en su plazo -- `daysBetween(today, due_date) <=
// notice_days`, el MISMO `daysBetween` que usa el semáforo
// (reminder-urgency.ts, reusado, no reimplementado) -- hace un
// compare-and-swap: `UPDATE ... SET notified_at = now() WHERE id = ? AND
// notified_at IS NULL`. Si no tocó fila (otra corrida ya lo marcó), se
// descarta -- no se avisa dos veces, misma garantía atómica que
// `sweepDueReminders` con `status = 'pending'`.
//
// Devuelve SOLO los que efectivamente se marcaron en esta corrida. El
// caller (run-daily-cron.ts) arma UN mail con todos juntos si la lista no
// está vacía; si lo está, no manda nada.
//
// REGLA DURA: nunca propaga una excepción -- mismo patrón que
// `sweepDueReminders` / `sweepOverdueTickets`.
export async function sweepReminderNoticeThresholds(
  organizationId: string,
  timezone: string,
  now: Date = new Date(),
): Promise<SweepReminderNoticeThresholdsResult> {
  try {
    const todaySlug = formatDateSlug(now, timezone);

    const candidates = await db
      .select({
        thresholdId: reminderNoticeThresholds.id,
        reminderId: reminders.id,
        reminderTitle: reminders.title,
        buildingName: buildings.name,
        noticeDays: reminderNoticeThresholds.noticeDays,
        dueDate: reminders.dueDate,
      })
      .from(reminderNoticeThresholds)
      .innerJoin(
        reminders,
        and(
          eq(reminders.id, reminderNoticeThresholds.reminderId),
          eq(reminders.organizationId, reminderNoticeThresholds.organizationId),
        ),
      )
      // LEFT JOIN (no INNER): un evento "General" tiene building_id NULL y
      // su umbral tiene que barrerse igual -- si no, no sale el mail
      // dedicado. `buildings.name` sale NULL para esos.
      .leftJoin(
        buildings,
        and(
          eq(buildings.id, reminders.buildingId),
          eq(buildings.organizationId, reminders.organizationId),
        ),
      )
      .where(
        and(
          eq(reminderNoticeThresholds.organizationId, organizationId),
          isNull(reminderNoticeThresholds.deletedAt),
          isNull(reminderNoticeThresholds.notifiedAt),
          isNull(reminders.deletedAt),
          inArray(reminders.status, REMINDER_ACTIVE_STATUSES),
        ),
      );

    const due = candidates.filter(
      (c) => daysBetween(todaySlug, c.dueDate) <= c.noticeDays,
    );

    if (due.length === 0) {
      return { ok: true, marked: [] };
    }

    const marked: MarkedNoticeThreshold[] = [];
    for (const candidate of due) {
      const [updated] = await db
        .update(reminderNoticeThresholds)
        .set({ notifiedAt: now })
        .where(
          and(
            eq(reminderNoticeThresholds.id, candidate.thresholdId),
            eq(reminderNoticeThresholds.organizationId, organizationId),
            isNull(reminderNoticeThresholds.notifiedAt),
          ),
        )
        .returning({ id: reminderNoticeThresholds.id });

      if (!updated) {
        // Otra corrida (o algo concurrente) ya lo marcó -- el
        // compare-and-swap ya hizo su trabajo, no se vuelve a incluir.
        continue;
      }

      marked.push({
        thresholdId: candidate.thresholdId,
        reminderId: candidate.reminderId,
        reminderTitle: candidate.reminderTitle,
        buildingName: candidate.buildingName,
        noticeDays: candidate.noticeDays,
        dueDate: candidate.dueDate,
      });
    }

    return { ok: true, marked };
  } catch (error) {
    console.error(
      `[sweepReminderNoticeThresholds] Falló el barrido de umbrales de aviso para la organización ${organizationId}:`,
      error,
    );
    return { ok: false, error: String(error) };
  }
}

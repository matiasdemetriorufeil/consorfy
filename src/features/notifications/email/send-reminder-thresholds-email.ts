import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organizations } from "@/db/schema";
import { formatDueDate } from "@/features/reminders/format-due-date";
import type { MarkedNoticeThreshold } from "@/features/reminders/sweep-reminder-notice-thresholds";
import { env } from "@/lib/env";
import { formatLongDate } from "@/lib/format-date";

import { buildReminderThresholdsEmail } from "../email-content";
import { getAdminEmails } from "./get-admin-emails";
import { getEmailProvider } from "./get-email-provider";

export type SendReminderThresholdsEmailResult =
  | { status: "sent" }
  | { status: "skipped_no_admins" }
  | { status: "skipped_empty" }
  | { status: "error"; error: string };

// Mail dedicado por umbral de aviso (paso 3 de "múltiples umbrales") -- lo
// dispara run-daily-cron.ts justo después de sweepReminderNoticeThresholds,
// SOLO si esa corrida marcó al menos un umbral. UN solo mail con todos los
// umbrales que entraron hoy en su plazo en esa organización juntos, sean
// de uno o de varios recordatorios.
//
// Mismo proveedor (`getEmailProvider`), mismos destinatarios
// (`getAdminEmails`, TODOS los app_users de la organización) y mismo
// "loguear y seguir" que `sendDailySummaryEmail` /
// `sendUrgentTicketAlertEmail` -- REGLA DURA: nunca propaga una excepción,
// un mail que no sale no puede tumbar el cron.
//
// SIN marca de idempotencia propia (a diferencia de
// `sendDailySummaryEmail` y su `last_daily_summary_sent_on`): la
// idempotencia ya la da el compare-and-swap de `notified_at` en el barrido
// -- un umbral marcado no vuelve a aparecer en `marked` en la corrida
// siguiente, así que este mail nunca repite un umbral. Si el envío falla
// DESPUÉS de marcar, ese umbral queda marcado sin mail (mismo trade-off
// que `sweepDueReminders`: el aviso puntual es "una vez", no hay
// reintento) -- se loguea con `console.error`.
export async function sendReminderThresholdsEmail(
  organizationId: string,
  marked: MarkedNoticeThreshold[],
): Promise<SendReminderThresholdsEmailResult> {
  try {
    if (marked.length === 0) {
      // El caller ya chequea esto, pero la función tampoco arma un mail
      // vacío si la llaman sin nada.
      return { status: "skipped_empty" };
    }

    const [org] = await db
      .select({ name: organizations.name, timezone: organizations.timezone })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    if (!org) {
      console.error(
        `[sendReminderThresholdsEmail] No se encontró la organización ${organizationId}.`,
      );
      return { status: "error", error: "organización no encontrada" };
    }

    const adminEmails = await getAdminEmails(organizationId);
    if (adminEmails.length === 0) {
      return { status: "skipped_no_admins" };
    }

    const content = buildReminderThresholdsEmail({
      organizationName: org.name,
      dateLabel: formatLongDate(new Date(), org.timezone),
      appUrl: env.NEXT_PUBLIC_APP_URL,
      thresholds: marked.map((m) => ({
        reminderTitle: m.reminderTitle,
        buildingName: m.buildingName,
        noticeDays: m.noticeDays,
        dueDateLabel: formatDueDate(m.dueDate),
      })),
    });

    const result = await getEmailProvider().send({
      to: adminEmails,
      subject: content.subject,
      html: content.html,
    });

    if (!result.ok) {
      console.error(
        `[sendReminderThresholdsEmail] Resend no pudo enviar el aviso de umbrales de la organización ${organizationId}: ${result.error}`,
      );
      return { status: "error", error: result.error };
    }

    return { status: "sent" };
  } catch (error) {
    console.error(
      `[sendReminderThresholdsEmail] Falló el armado/envío del aviso de umbrales para la organización ${organizationId}:`,
      error,
    );
    return { status: "error", error: String(error) };
  }
}

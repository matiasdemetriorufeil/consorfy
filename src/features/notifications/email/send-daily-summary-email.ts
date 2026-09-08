import "server-only";

import { eq } from "drizzle-orm";

import { db } from "@/db";
import { organizations } from "@/db/schema";
import {
  getReminderIdsWithNotifiedThreshold,
  getReminderList,
} from "@/features/reminders/queries";
import { REMINDER_ACTIVE_STATUSES } from "@/features/reminders/reminder-schema";
import { getReminderUrgency } from "@/features/reminders/reminder-urgency";
import {
  getOpenTickets,
  getTicketsReportedInRange,
} from "@/features/tickets/queries";
import { env } from "@/lib/env";
import {
  formatDateSlug,
  formatLongDate,
  zonedDayBoundsToUtc,
} from "@/lib/format-date";

import {
  buildDailySummaryEmail,
  type DailySummaryReminderRow,
  type DailySummaryTicketRow,
} from "../email-content";
import { ticketQualifiesAsOverdue } from "../notification-content";
import { getAdminEmails } from "./get-admin-emails";
import { getEmailProvider } from "./get-email-provider";

// Qué puede devolver un intento -- pensado para que el orquestador del
// cron (paso 9.6, run-daily-cron.ts) pueda contar/loguear sin tener que
// adivinar qué pasó a partir de un `void`. Agregado en la MISMA corrección
// que le sumó la idempotencia (ver abajo) -- no es un cambio de contrato
// aparte, las dos cosas requerían tocar esta función de todos modos.
export type DailySummaryResult =
  | { status: "sent" }
  | { status: "skipped_already_sent_today" }
  | { status: "skipped_no_admins" }
  | { status: "error"; error: string };

// Resumen diario (paso 9.5, punto 5; conectado y hecho idempotente en el
// paso 9.6, punto 6) -- el disparo diario es el cron del paso 9.6, mismo
// patrón que quedó pendiente con ticket_overdue/reminder_due en la
// corrección del 9.4 (ver CLAUDE.md > Generación automática de
// notificaciones, "Qué falta para que se disparen solos"). Esta función
// hace TODO lo que hace falta para mandar el resumen de UNA organización
// -- 9.6 la llama una vez por organización activa, no tiene que armar
// nada más.
//
// Qué junta, y por qué (criterio propio, señalado en el reporte del
// paso):
// - Reclamos nuevos del día: getTicketsReportedInRange con los límites de
//   "hoy" en la zona horaria de la organización (zonedDayBoundsToUtc,
//   nunca UTC ni la del servidor que corre el cron).
// - Reclamos urgentes sin resolver, y reclamos vencidos NO urgentes
//   (agregado en una corrección del paso 9.6, decisión tomada con la
//   persona -- ver CLAUDE.md > Cron diario): las dos salen de
//   getOpenTickets() (paso 9.6, el mismo conjunto completo de reclamos
//   abiertos que ya usa sweepOverdueTickets), separadas en JS por
//   `priority === "urgent"` / `ticketQualifiesAsOverdue()` -- un reclamo
//   nunca aparece en las dos listas a la vez (urgente Y vencido cae solo
//   en "urgentes", ver el comentario de buildDailySummaryEmail en
//   email-content.ts). Ninguna de las dos se limita a los de HOY -- un
//   urgente o un vencido de ayer sin atender sigue siendo lo más
//   importante que este email puede decir, y es justamente el criterio
//   "todos los días hasta que se resuelva" que la persona pidió para los
//   vencidos, igual que ya regía para los urgentes.
// - Recordatorios que necesitan atención: reusa getReminderList() +
//   getReminderUrgency() (paso 9.2, el mismo semáforo de vencimientos),
//   overdue Y upcoming -- ver el comentario de email-content.ts sobre
//   por qué no se limita a "upcoming" literal.
//
// Idempotencia (paso 9.6, punto 6) -- `organizations.last_daily_summary_sent_on`
// (columna nueva, ver el comentario en el schema): si ya es "hoy" en la
// zona de la organización, esta función NO manda nada y devuelve
// `skipped_already_sent_today` -- cubre "el cron se disparó dos veces el
// mismo día" sin necesitar un flag aparte en el propio cron. La columna
// se actualiza SOLO después de un envío con `result.ok === true` -- si
// Resend falla, la marca NO se toca, así que la corrida (o un reintento
// manual) del mismo día todavía puede volver a intentarlo. "Mismo día" se
// define en la zona horaria de la ORGANIZACIÓN (formatDateSlug), nunca
// UTC ni la del servidor que corre el cron -- dos organizaciones en
// zonas distintas no comparten el mismo corte de "día".
//
// REGLA DURA (punto 7): nunca propaga una excepción -- mismo criterio que
// sendUrgentTicketAlertEmail/detectAndFlagSimilarTickets.
export async function sendDailySummaryEmail(
  organizationId: string,
): Promise<DailySummaryResult> {
  try {
    const [org] = await db
      .select({
        name: organizations.name,
        timezone: organizations.timezone,
        lastDailySummarySentOn: organizations.lastDailySummarySentOn,
      })
      .from(organizations)
      .where(eq(organizations.id, organizationId));
    if (!org) {
      console.error(
        `[sendDailySummaryEmail] No se encontró la organización ${organizationId}.`,
      );
      return { status: "error", error: "organización no encontrada" };
    }

    const now = new Date();
    const todaySlug = formatDateSlug(now, org.timezone);

    if (org.lastDailySummarySentOn === todaySlug) {
      return { status: "skipped_already_sent_today" };
    }

    const adminEmails = await getAdminEmails(organizationId);
    if (adminEmails.length === 0) {
      return { status: "skipped_no_admins" };
    }

    const { start, end } = zonedDayBoundsToUtc(todaySlug, org.timezone);

    const [
      reportedToday,
      openTickets,
      reminders,
      remindersWithNotifiedThreshold,
    ] = await Promise.all([
      getTicketsReportedInRange(organizationId, start, end),
      getOpenTickets(organizationId),
      getReminderList(organizationId, null, REMINDER_ACTIVE_STATUSES),
      getReminderIdsWithNotifiedThreshold(organizationId),
    ]);

    const newTickets: DailySummaryTicketRow[] = reportedToday.map((t) => ({
      id: t.id,
      title: t.title,
      buildingName: t.buildingName,
      publicCode: t.publicCode,
    }));

    const toSummaryRow = (
      t: (typeof openTickets)[number],
    ): DailySummaryTicketRow => ({
      id: t.id,
      title: t.title,
      buildingName: t.buildingName,
      publicCode: t.publicCode,
    });

    const urgentUnresolvedTickets: DailySummaryTicketRow[] = openTickets
      .filter((t) => t.priority === "urgent")
      .map(toSummaryRow);

    // Vencidos NO urgentes -- decisión tomada con la persona (ver el
    // comentario de arriba y CLAUDE.md > Cron diario). `priority !==
    // "urgent"` es lo que evita que un reclamo urgente Y vencido a la
    // vez aparezca en las dos listas del email.
    const overdueTickets: DailySummaryTicketRow[] = openTickets
      .filter(
        (t) => t.priority !== "urgent" && ticketQualifiesAsOverdue(t, now),
      )
      .map(toSummaryRow);

    // `for` en vez de map+filter: la urgencia sale de una función que
    // devuelve un union de 3 valores (getReminderUrgency), y el guard
    // `=== "ok"` acá deja a TypeScript angostar el tipo solo (sin un type
    // predicate a mano) a los dos valores que sí necesita
    // DailySummaryReminderRow.
    const remindersNeedingAttention: DailySummaryReminderRow[] = [];
    for (const r of reminders) {
      const urgency = getReminderUrgency(r.dueDate, r.noticeDays, todaySlug);
      if (urgency === "ok") {
        continue;
      }
      // Paso 3 ("múltiples umbrales"): un recordatorio PRÓXIMO (no vencido)
      // que YA recibió al menos un aviso de umbral dedicado deja de contar
      // acá -- ese mail puntual ya cumplió, repetirlo en el resumen general
      // sería ruido. Si está VENCIDO (`urgency === "overdue"`) se sigue
      // mostrando igual, sin importar si tuvo umbrales avisados -- eso no
      // cambia.
      if (urgency === "upcoming" && remindersWithNotifiedThreshold.has(r.id)) {
        continue;
      }
      remindersNeedingAttention.push({
        id: r.id,
        title: r.title,
        buildingName: r.buildingName,
        urgency,
      });
    }

    const content = buildDailySummaryEmail({
      organizationName: org.name,
      dateLabel: formatLongDate(now, org.timezone),
      appUrl: env.NEXT_PUBLIC_APP_URL,
      newTickets,
      urgentUnresolvedTickets,
      overdueTickets,
      remindersNeedingAttention,
    });

    const result = await getEmailProvider().send({
      to: adminEmails,
      subject: content.subject,
      html: content.html,
    });

    if (!result.ok) {
      console.error(
        `[sendDailySummaryEmail] Resend no pudo enviar el resumen de la organización ${organizationId}: ${result.error}`,
      );
      return { status: "error", error: result.error };
    }

    // Marca de idempotencia -- SOLO acá, después de un envío confirmado.
    // Si esto fallara (base caída justo en este instante), el catch de
    // abajo lo loguea como error de la corrida entera -- una marca que no
    // llegó a escribirse deja el próximo intento re-enviando, que es el
    // lado seguro para equivocarse (un resumen de más es mejor que
    // ninguno).
    await db
      .update(organizations)
      .set({ lastDailySummarySentOn: todaySlug })
      .where(eq(organizations.id, organizationId));

    return { status: "sent" };
  } catch (error) {
    console.error(
      `[sendDailySummaryEmail] Falló el armado/envío del resumen para la organización ${organizationId}:`,
      error,
    );
    return { status: "error", error: String(error) };
  }
}

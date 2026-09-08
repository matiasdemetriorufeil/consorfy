import { describeReminderDueDate } from "@/features/reminders/reminder-urgency";
import type { TicketStatusValue } from "@/features/tickets/ticket-actions-schema";

import type { NotificationType } from "./notification-type";

export type NotificationContent = {
  type: NotificationType;
  title: string;
  body: string;
  link: string;
};

// Puro y separable a propósito (mismo criterio que buildIncidentTitle en
// group-tickets-into-incident.ts, paso 7.4) -- separa "qué dice la
// notificación" de "cuándo se genera" (eso vive en cada Server Action que
// dispara el evento, paso 9.4), para poder testear el contenido sin tocar
// la base.
export function buildNewTicketNotification(input: {
  ticketId: string;
  buildingName: string;
  ticketTitle: string;
}): NotificationContent {
  return {
    type: "new_ticket",
    title: `Nuevo reclamo en ${input.buildingName}`,
    body: input.ticketTitle,
    link: `/panel/tickets/${input.ticketId}`,
  };
}

// Type PROPIO (`urgent_ticket`), no `new_ticket` con contenido condicional
// -- decisión técnica, no de negocio (así lo pidió el enunciado de la
// corrección de 9.4). Motivo: `type` es la única columna que la UI usa hoy
// para decidir la etiqueta chica de cada fila (NOTIFICATION_TYPE_LABEL,
// paso 9.3) -- si un reclamo urgente insertara `type: "new_ticket"` con
// otro texto, esa columna dejaría de alcanzar sola para saber "qué clase de
// aviso es este", y cualquier filtro futuro por tipo (ej. "mostrame solo
// los urgentes") tendría que parsear el título en vez de comparar una
// columna. El costo de un valor de enum más es bajo (`ALTER TYPE ...
// ADD VALUE`, ver notifications.ts) frente a ese costo de ambigüedad
// permanente. Sigue siendo UNA sola notificación por reclamo creado (nunca
// dos): el caller (createTicketAction) elige esta función O
// buildNewTicketNotification según la prioridad, nunca las dos.
export function buildUrgentTicketNotification(input: {
  ticketId: string;
  buildingName: string;
  ticketTitle: string;
}): NotificationContent {
  return {
    type: "urgent_ticket",
    title: `Reclamo urgente en ${input.buildingName}`,
    body: input.ticketTitle,
    link: `/panel/tickets/${input.ticketId}`,
  };
}

// N=3 días -- decisión de producto tomada explícitamente por la persona al
// pedir esta corrección de 9.4 ("reclamo sin resolver hace más de 3 días"),
// no elegida por criterio propio. DISTINTA de STALE_TICKET_DAYS
// (tickets/queries.ts, =5): esa mide días desde el ÚLTIMO CAMBIO DE ESTADO
// para la sección "atención inmediata" del dashboard (paso 3.5); esta mide
// días desde REPORTED_AT para decidir si corresponde una notificación de
// vencimiento -- dos métricas distintas sobre dos preguntas distintas, con
// dos números distintos que la persona fijó por separado. No se
// reutilizó una ni se unificaron a propósito.
export const TICKET_OVERDUE_THRESHOLD_DAYS = 3;

// "Abierto" = ni resuelto ni cerrado ni descartado -- reusa
// TicketStatusValue de ticket-actions-schema.ts (no un tipo propio) para
// que un estado nuevo que se agregue ahí algún día no pueda quedar
// silenciosamente afuera de este chequeo. `now` recibido por parámetro
// (nunca `new Date()` interno) para que sea 100% determinística y
// testeable -- mismo criterio que getReminderUrgency (reminder-urgency.ts,
// paso 9.2), que ya recibe `today` en vez de calcularlo.
//
// Pura a propósito: no dispara nada por sí sola. El disparo automático
// (recorrer todos los tickets abiertos y llamar a esto por cada uno) es
// del cron del paso 9.6 -- ver CLAUDE.md > Generación automática de
// notificaciones, no está construido todavía.
export function ticketQualifiesAsOverdue(
  ticket: { status: TicketStatusValue; reportedAt: Date },
  now: Date,
  thresholdDays: number = TICKET_OVERDUE_THRESHOLD_DAYS,
): boolean {
  const isOpen =
    ticket.status !== "resolved" &&
    ticket.status !== "closed" &&
    ticket.status !== "discarded";
  if (!isOpen) {
    return false;
  }
  const ageMs = now.getTime() - ticket.reportedAt.getTime();
  return ageMs > thresholdDays * 24 * 60 * 60 * 1000;
}

export function buildTicketOverdueNotification(input: {
  ticketId: string;
  buildingName: string;
  ticketTitle: string;
}): NotificationContent {
  return {
    type: "ticket_overdue",
    title: `Reclamo sin resolver hace más de ${TICKET_OVERDUE_THRESHOLD_DAYS} días en ${input.buildingName}`,
    body: input.ticketTitle,
    link: `/panel/tickets/${input.ticketId}`,
  };
}

// `reminder_due` ya existía en el enum desde el paso 9.3 (anticipado, sin
// generador todavía) -- reusado tal cual, no un type nuevo. Reusa
// describeReminderDueDate() (reminder-urgency.ts, paso 9.2) para el cuerpo
// en vez de reimplementar el cálculo de "vence en N días" -- esa función ya
// resuelve due_date contra "today" sin arriesgo de timezone (columna `date`
// pura, ver el comentario de esa función), exactamente el mismo cálculo que
// hace falta acá. La condición de "está dentro de la ventana de aviso" (que
// también depende de notice_days) YA existe también, en
// getReminderUrgency(dueDate, noticeDays, today) === "upcoming" -- no se
// reconstruye acá una función "califica" nueva para recordatorios (a
// diferencia de ticketQualifiesAsOverdue arriba): el enunciado de esta
// corrección solo pidió la función de CONTENIDO para este evento, y la de
// calificación ya estaba resuelta desde 9.2 por otro motivo (el semáforo de
// vencimientos). El cron de 9.6 puede llamar directo a
// getReminderUrgency() -- no hace falta una segunda función que reimplique
// lo mismo.
//
// No hay una página de detalle por recordatorio (viven en una lista por
// edificio/organización, ver CLAUDE.md > Recordatorios) -- el link va a
// `/panel/reminders`, la pantalla donde vive, no a un recurso que no
// existe.
export function buildReminderDueNotification(input: {
  // `null` = evento "General" (sin edificio): el título omite el " en
  // {edificio}" en vez de decir "en null". El cuerpo ya identifica de qué
  // evento se trata.
  buildingName: string | null;
  reminderTitle: string;
  dueDate: string;
  today: string;
}): NotificationContent {
  return {
    type: "reminder_due",
    title: input.buildingName
      ? `Vencimiento próximo en ${input.buildingName}`
      : "Vencimiento próximo",
    body: `${input.reminderTitle} (${describeReminderDueDate(input.dueDate, input.today)})`,
    link: "/panel/reminders",
  };
}

// `incidentTitle` ya trae el edificio adentro (`buildIncidentTitle()`,
// group-tickets-into-incident.ts: "${categoria} en ${edificio}") -- no hace
// falta pedirlo de nuevo acá. Nombrada "Resolved", no "Updated", porque hoy
// es la única transición real que existe (incidents.status es open/
// resolved, y resolveIncidentAction es la única Server Action que lo
// cambia) -- si en el futuro aparece otra transición, esta función gana un
// parámetro o una hermana recién ahí, no antes.
export function buildIncidentResolvedNotification(input: {
  incidentId: string;
  incidentTitle: string;
}): NotificationContent {
  return {
    type: "incident_updated",
    title: "Problema en común resuelto",
    body: input.incidentTitle,
    link: `/panel/incidents/${input.incidentId}`,
  };
}

// Type PROPIO (`incident_multi_unit`), no `incident_updated` reusado --
// misma decisión técnica que new_ticket/urgent_ticket arriba, con un motivo
// adicional acá: la idempotencia de este evento (ver
// maybeNotifyMultiUnitIncident en group-tickets-into-incident.ts) se
// resuelve chequeando si YA existe una notificación para
// `related_incident_id` de este type puntual. Si compartiera type con
// "resuelto" (`incident_updated`), ese chequeo encontraría la notificación
// de resolución de un incidente YA resuelto y creería, de arranque, que el
// aviso de "varias unidades" ya se mandó sin haberlo mandado nunca --
// un bug de idempotencia cruzada, no solo una ambigüedad de UI. Un type
// propio hace que el chequeo sea correcto por construcción, sin agregar
// una columna ni una tabla nueva.
export function buildIncidentMultiUnitNotification(input: {
  incidentId: string;
  incidentTitle: string;
}): NotificationContent {
  return {
    type: "incident_multi_unit",
    title: "Problema en común afecta a varias unidades",
    body: input.incidentTitle,
    link: `/panel/incidents/${input.incidentId}`,
  };
}

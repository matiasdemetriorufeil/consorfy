// Funciones puras de contenido de email (paso 9.5) -- mismo criterio que
// notification-content.ts (paso 9.4): separan "qué dice el email" de
// "cuándo/cómo se manda" (eso vive en email/send-admin-email.ts), para
// poder testear el contenido sin tocar la base ni el SDK de Resend. Reciben
// SIEMPRE valores ya resueltos (URLs absolutas ya armadas con
// NEXT_PUBLIC_APP_URL, fechas ya formateadas en la zona de la organización)
// -- nunca leen `env` ni la hora actual por su cuenta, mismo motivo que
// ticketQualifiesAsOverdue recibe `now` por parámetro (paso 9.4):
// determinismo y testeable sin mockear nada del entorno.
//
// HTML simple, estilos inline (obligatorio para email: la mayoría de los
// clientes ignora o filtra `<style>` en el `<head>`, y ninguno entiende
// custom properties de CSS) -- mismos colores/tokens que
// src/app/globals.css (`--primary: #14484f`, `--urgente: #b42318`,
// `--ink`/`--ink-muted`/`--border`/`--canvas`), copiados literales porque
// un email no puede importar ese archivo. Tipografía: pila segura
// (Arial/Helvetica) con el nombre real del proyecto (Archivo/Inter,
// src/app/layout.tsx) como preferencia -- la mayoría de los clientes de
// email no cargan fuentes de Google, así que la pila seguro es la que
// manda en la práctica, no un capricho de simplificación.

import { TICKET_OVERDUE_THRESHOLD_DAYS } from "./notification-content";

export type EmailContent = { subject: string; html: string };

const COLOR_PRIMARY = "#14484f";
const COLOR_URGENTE = "#b42318";
const COLOR_INK = "#16181d";
const COLOR_INK_MUTED = "#5b6169";
const COLOR_BORDER = "#dde1e0";
const COLOR_CANVAS = "#f3f5f4";
const COLOR_SURFACE = "#ffffff";

const FONT_BODY = "Inter, Arial, Helvetica, sans-serif";
const FONT_DISPLAY = "Archivo, Arial, Helvetica, sans-serif";

// Layout compartido -- mismo header (marca) y mismo contenedor en los dos
// emails de este paso, para que se reconozcan como del mismo sistema
// aunque los abra el administrador semanas después uno del otro.
function renderEmailLayout(bodyHtml: string): string {
  return `<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
  </head>
  <body style="margin:0;padding:0;background-color:${COLOR_CANVAS};font-family:${FONT_BODY};">
    <div style="padding:24px 16px;">
      <div style="max-width:480px;margin:0 auto;background-color:${COLOR_SURFACE};border:1px solid ${COLOR_BORDER};border-radius:8px;overflow:hidden;">
        <div style="background-color:${COLOR_PRIMARY};padding:16px 24px;">
          <span style="font-family:${FONT_DISPLAY};font-size:18px;font-weight:700;color:#ffffff;">Consorfy</span>
        </div>
        <div style="padding:24px;">
          ${bodyHtml}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function renderButton(label: string, url: string): string {
  return `<a href="${url}" style="display:inline-block;margin-top:16px;padding:10px 20px;background-color:${COLOR_PRIMARY};color:#ffffff;font-family:${FONT_BODY};font-size:14px;font-weight:600;text-decoration:none;border-radius:6px;">${label}</a>`;
}

// Alerta inmediata de reclamo urgente (paso 9.5, punto 4) -- mismo evento
// que dispara la notificación `urgent_ticket` del centro de notificaciones
// (paso 9.4, ver notification-content.ts > buildUrgentTicketNotification),
// canal distinto (email en vez de la campana), mismo hecho de negocio.
export function buildUrgentTicketAlertEmail(input: {
  buildingName: string;
  ticketTitle: string;
  ticketPublicCode: string;
  ticketUrl: string;
}): EmailContent {
  const subject = `Reclamo urgente en ${input.buildingName}`;
  const html = renderEmailLayout(`
    <h1 style="margin:0 0 4px;font-family:${FONT_DISPLAY};font-size:20px;color:${COLOR_URGENTE};">Reclamo urgente</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${COLOR_INK_MUTED};">${input.buildingName} · ${input.ticketPublicCode}</p>
    <p style="margin:0;font-size:15px;line-height:1.5;color:${COLOR_INK};">${input.ticketTitle}</p>
    ${renderButton("Ver el reclamo", input.ticketUrl)}
  `);
  return { subject, html };
}

// Resumen diario (paso 9.5, punto 5) -- función de CONTENIDO solamente,
// sin conectar a ningún disparador automático (eso es el cron del paso
// 9.6, mismo patrón que quedó pendiente con ticket_overdue/reminder_due
// en la corrección del 9.4 -- ver CLAUDE.md).
//
// Qué se incluye -- criterio propio, señalado en el reporte, no una
// decisión de negocio ya tomada: (1) reclamos nuevos del día, (2) reclamos
// urgentes sin resolver (no solo los de hoy -- un urgente de ayer sin
// atender sigue siendo lo más importante que el resumen puede decir), (3)
// reclamos vencidos NO urgentes (agregado en una corrección del paso
// 9.6, DECISIÓN TOMADA CON LA PERSONA -- ver CLAUDE.md > Cron diario:
// mismo criterio "todos los días hasta que se resuelva" que ya usan los
// urgentes, resolviendo la asimetría que el reporte original del 9.6
// había señalado sin resolver), (4) recordatorios que necesitan
// atención, con su nivel de urgencia (`getReminderUrgency`, paso 9.2) --
// overdue Y upcoming, no solo "upcoming" literal: un recordatorio ya
// vencido es información más urgente todavía que uno próximo a vencer,
// dejarlo afuera del resumen diario porque el enunciado dijo "próximos a
// vencer" habría escondido justo el caso más grave.
export type DailySummaryTicketRow = {
  id: string;
  title: string;
  buildingName: string;
  publicCode: string;
};

export type DailySummaryReminderRow = {
  id: string;
  title: string;
  buildingName: string;
  urgency: "overdue" | "upcoming";
};

function renderTicketList(
  rows: DailySummaryTicketRow[],
  appUrl: string,
): string {
  if (rows.length === 0) {
    return `<p style="margin:0;font-size:14px;color:${COLOR_INK_MUTED};">Ninguno.</p>`;
  }
  const items = rows
    .map(
      (r) => `<li style="margin-bottom:8px;font-size:14px;color:${COLOR_INK};">
        <a href="${appUrl}/panel/tickets/${r.id}" style="color:${COLOR_PRIMARY};text-decoration:none;font-weight:600;">${r.publicCode}</a>
        -- ${r.title} (${r.buildingName})
      </li>`,
    )
    .join("");
  return `<ul style="margin:0;padding-left:18px;">${items}</ul>`;
}

function renderReminderList(rows: DailySummaryReminderRow[]): string {
  if (rows.length === 0) {
    return `<p style="margin:0;font-size:14px;color:${COLOR_INK_MUTED};">Ninguno.</p>`;
  }
  const items = rows
    .map((r) => {
      const color = r.urgency === "overdue" ? COLOR_URGENTE : COLOR_INK;
      const tag = r.urgency === "overdue" ? "Vencido" : "Próximo";
      return `<li style="margin-bottom:8px;font-size:14px;color:${color};">
        <strong>[${tag}]</strong> ${r.title} (${r.buildingName})
      </li>`;
    })
    .join("");
  return `<ul style="margin:0;padding-left:18px;">${items}</ul>`;
}

function renderSection(title: string, count: number, bodyHtml: string): string {
  return `
    <h2 style="margin:24px 0 8px;font-family:${FONT_DISPLAY};font-size:15px;color:${COLOR_INK};">${title} (${count})</h2>
    ${bodyHtml}
  `;
}

export function buildDailySummaryEmail(input: {
  organizationName: string;
  dateLabel: string;
  appUrl: string;
  newTickets: DailySummaryTicketRow[];
  urgentUnresolvedTickets: DailySummaryTicketRow[];
  // Vencidos NO urgentes (paso 9.6, corrección posterior -- decisión
  // tomada con la persona, ver CLAUDE.md > Cron diario): la asimetría que
  // el reporte original del 9.6 había señalado y no resuelto -- los
  // urgentes sin resolver ya se repetían día a día en el resumen, pero un
  // reclamo `ticket_overdue` no urgente solo tenía el aviso puntual del
  // barrido (sweepOverdueTickets), sin visibilidad continua. Mismo
  // criterio EXACTO que `urgentUnresolvedTickets`: se repite todos los
  // días hasta que el reclamo se resuelva, no una vez y desaparece --
  // reusa `ticketQualifiesAsOverdue()` (notification-content.ts, paso
  // 9.4), no una condición nueva. El caller (send-daily-summary-email.ts)
  // es responsable de que un reclamo urgente Y vencido a la vez aparezca
  // acá y NO en `urgentUnresolvedTickets` (o viceversa, nunca en las
  // dos) -- esta función solo renderiza lo que recibe, no dedupea entre
  // listas.
  overdueTickets: DailySummaryTicketRow[];
  remindersNeedingAttention: DailySummaryReminderRow[];
}): EmailContent {
  const subject = `Resumen diario de ${input.organizationName} -- ${input.dateLabel}`;

  const totalItems =
    input.newTickets.length +
    input.urgentUnresolvedTickets.length +
    input.overdueTickets.length +
    input.remindersNeedingAttention.length;

  // Sin admiración salvo algo genuino que celebrar (CLAUDE.md > Voz y
  // escritura) -- "sin novedades" es un hecho, no una fiesta.
  const summaryLine =
    totalItems === 0
      ? `<p style="margin:0 0 8px;font-size:14px;color:${COLOR_INK_MUTED};">Sin novedades para hoy.</p>`
      : "";

  const html = renderEmailLayout(`
    <h1 style="margin:0 0 4px;font-family:${FONT_DISPLAY};font-size:20px;color:${COLOR_INK};">Resumen diario</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${COLOR_INK_MUTED};">${input.organizationName} · ${input.dateLabel}</p>
    ${summaryLine}
    ${renderSection("Reclamos nuevos hoy", input.newTickets.length, renderTicketList(input.newTickets, input.appUrl))}
    ${renderSection("Reclamos urgentes sin resolver", input.urgentUnresolvedTickets.length, renderTicketList(input.urgentUnresolvedTickets, input.appUrl))}
    ${renderSection(`Reclamos sin resolver hace más de ${TICKET_OVERDUE_THRESHOLD_DAYS} días`, input.overdueTickets.length, renderTicketList(input.overdueTickets, input.appUrl))}
    ${renderSection("Eventos que necesitan atención", input.remindersNeedingAttention.length, renderReminderList(input.remindersNeedingAttention))}
    ${renderButton("Abrir el panel", `${input.appUrl}/panel`)}
  `);

  return { subject, html };
}

// Aviso DEDICADO por umbral de recordatorio (paso 3 de "múltiples umbrales
// de aviso") -- función de CONTENIDO solamente, misma separación
// "qué dice" / "cuándo se manda" que el resto de este archivo.
//
// Un solo mail junta TODOS los umbrales que entraron hoy en su plazo en
// una organización (`daysBetween(today, due_date) <= notice_days`), sean
// de uno o de varios recordatorios distintos. Mismo layout/tono/paleta que
// `buildDailySummaryEmail` (para que se reconozcan como del mismo
// sistema), pero ASUNTO y CUERPO propios -- no reusa esa plantilla. El
// caller (send-reminder-thresholds-email.ts) garantiza que `thresholds`
// nunca llega vacío: nunca se manda un mail sin nada.
export type ReminderThresholdEmailRow = {
  reminderTitle: string;
  buildingName: string;
  noticeDays: number;
  // Fecha de vencimiento ya formateada por el caller ("31/12/2026") --
  // igual que el resto de este archivo recibe todo ya resuelto.
  dueDateLabel: string;
};

function renderNoticePhrase(noticeDays: number): string {
  if (noticeDays === 0) {
    return "aviso del mismo día";
  }
  if (noticeDays === 1) {
    return "aviso de 1 día antes";
  }
  return `aviso de ${noticeDays} días antes`;
}

function renderReminderThresholdList(
  rows: ReminderThresholdEmailRow[],
): string {
  const items = rows
    .map(
      (r) => `<li style="margin-bottom:8px;font-size:14px;color:${COLOR_INK};">
        <strong>${r.reminderTitle}</strong> (${r.buildingName}) -- vence el ${r.dueDateLabel}, ${renderNoticePhrase(r.noticeDays)}
      </li>`,
    )
    .join("");
  return `<ul style="margin:0;padding-left:18px;">${items}</ul>`;
}

export function buildReminderThresholdsEmail(input: {
  organizationName: string;
  dateLabel: string;
  appUrl: string;
  thresholds: ReminderThresholdEmailRow[];
}): EmailContent {
  const subject = `Avisos de eventos de ${input.organizationName} -- ${input.dateLabel}`;
  const count = input.thresholds.length;
  const intro =
    count === 1
      ? "Un evento entró hoy en su plazo de aviso:"
      : `${count} avisos de eventos entraron hoy en su plazo:`;

  const html = renderEmailLayout(`
    <h1 style="margin:0 0 4px;font-family:${FONT_DISPLAY};font-size:20px;color:${COLOR_INK};">Avisos de eventos</h1>
    <p style="margin:0 0 16px;font-size:14px;color:${COLOR_INK_MUTED};">${input.organizationName} · ${input.dateLabel}</p>
    <p style="margin:0 0 12px;font-size:14px;color:${COLOR_INK};">${intro}</p>
    ${renderReminderThresholdList(input.thresholds)}
    ${renderButton("Abrir eventos", `${input.appUrl}/panel/reminders`)}
  `);

  return { subject, html };
}

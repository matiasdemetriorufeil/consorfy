import {
  date,
  foreignKey,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";

import { denyAnonAuthenticated, idColumn, timestamps } from "./_shared";
import { buildings } from "./buildings";
import { organizations } from "./organizations";

export const reminderRecurrence = pgEnum("reminder_recurrence", [
  "none",
  "monthly",
  "quarterly",
  "biannual",
  "annual",
]);

export const reminderStatus = pgEnum("reminder_status", [
  "pending",
  "notified",
  "done",
  "dismissed",
]);

// Color puramente decorativo/organizativo que la persona le asigna a un
// evento en el formulario (paso 1 de 2 -- el paso 2 lo usa en un rediseño
// del calendario). NO tiene ninguna relación con la urgencia
// (vencido/próximo/ok), que es un sistema aparte: acá los valores son
// nombres de color, allá son niveles de riesgo con sus propios tokens
// (`--urgente`/`--alta`/...). Los hex de cada color viven en globals.css
// (`--evento-*`, un set aislado); acá solo el conjunto de claves.
// "pizarra" (gris/neutro) es el default -- un evento sin clasificar
// todavía, sin que implique ninguna categoría.
export const reminderColor = pgEnum("reminder_color", [
  "pizarra",
  "rojo",
  "naranja",
  "ambar",
  "verde",
  "azul",
  "violeta",
  "rosa",
]);

export const reminders = pgTable(
  "reminders",
  {
    id: idColumn(),
    organizationId: uuid("organization_id")
      .notNull()
      .references(() => organizations.id, { onDelete: "restrict" }),
    // Nullable: un evento "General" -- una tarea administrativa de TODA la
    // organización, no de un edificio puntual (VTV de la flota, vencimiento
    // de un seguro, etc.) -- tiene sentido en este producto. Mismo criterio
    // y misma forma que `announcements.building_id` (ver el comentario largo
    // ahí). La FK compuesta de abajo no cambia: MATCH SIMPLE (default de
    // Postgres) no exige match cuando `building_id` es NULL.
    buildingId: uuid("building_id"),
    // Recurrencia = fila NUEVA por ocurrencia al completar la actual, NO
    // recalcular due_date en la misma fila. El pedido explícito de poder
    // "ver el historial de fumigaciones pasadas" no se puede cumplir
    // recalculando in-place: cada UPDATE pisaría la ocurrencia anterior sin
    // dejar rastro de cuándo se hizo la fumigación de marzo una vez que
    // due_date avanza a junio. Con una fila por ocurrencia, cada una queda
    // como su propio registro consultable (con su status, su due_date, su
    // last_notified_at) -- exactamente lo que hace falta para un historial
    // real, a costa de que "el recordatorio" deja de ser una sola fila
    // estable y pasa a ser una serie de filas relacionadas.
    //
    // series_id agrupa esa serie. defaultRandom(): la primera ocurrencia de
    // cualquier recordatorio (recurrente o no) recibe un series_id propio
    // sin que la aplicación tenga que pensarlo. Al completar una ocurrencia
    // recurrente, la aplicación crea la fila siguiente copiando este mismo
    // valor a mano (no dejando que el default le genere uno nuevo) -- así
    // es como todas las ocurrencias de una misma serie quedan enlazadas
    // para el historial. No se implementa ese flujo en este paso (es la
    // etapa 9 según el plan), pero el esquema ya lo soporta.
    seriesId: uuid("series_id").notNull().defaultRandom(),
    title: text("title").notNull(),
    description: text("description"),
    dueDate: date("due_date").notNull(),
    recurrence: reminderRecurrence("recurrence").notNull().default("none"),
    noticeDays: integer("notice_days").notNull().default(7),
    status: reminderStatus("status").notNull().default("pending"),
    // Decorativo, elegido por la persona (ver `reminderColor` arriba). NOT
    // NULL con default 'pizarra': los eventos ya existentes quedan en ese
    // valor tras la migración (el ADD COLUMN ... DEFAULT rellena las filas
    // viejas), sin perder ni inventar nada.
    color: reminderColor("color").notNull().default("pizarra"),
    lastNotifiedAt: timestamp("last_notified_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.buildingId, t.organizationId],
      foreignColumns: [buildings.id, buildings.organizationId],
    }).onDelete("restrict"),
    // Necesaria para que notifications.related_reminder_id referencie
    // reminders(id, organization_id) con FK compuesta.
    unique("reminders_id_organization_id_unique").on(t.id, t.organizationId),
    // "Recordatorios que vencen en los próximos N días, de todos los
    // edificios": WHERE status = 'pending' AND due_date <= (hoy + N). No
    // lleva building_id porque la consulta es explícitamente cross-edificio
    // (un barrido periódico, no una bandeja por edificio).
    index("reminders_status_due_date_idx").on(t.status, t.dueDate),
    // No es una de las 5 consultas pedidas en el punto 7, pero es la razón
    // de ser del diseño "fila nueva por ocurrencia" de arriba: "ver el
    // historial de fumigaciones pasadas" es WHERE series_id = ? ORDER BY
    // due_date.
    index("reminders_series_id_due_date_idx").on(t.seriesId, t.dueDate),
    denyAnonAuthenticated(),
  ],
).enableRLS();

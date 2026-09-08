import "server-only";

import { and, asc, eq, inArray, isNotNull, isNull, sql } from "drizzle-orm";

import { db } from "@/db";
import { buildings, reminderNoticeThresholds, reminders } from "@/db/schema";

import type {
  ReminderColorValue,
  ReminderStatusValue,
} from "./reminder-schema";

export type ReminderListRow = {
  id: string;
  buildingId: string;
  buildingName: string;
  title: string;
  description: string | null;
  dueDate: string;
  // Umbral MÁS GRANDE de los del recordatorio (columna puente
  // `reminders.notice_days`, mantenida en sync por las Server Actions
  // hasta que el paso 3 la elimine). getReminderUrgency -- el semáforo, la
  // campana (sweepDueReminders) y el resumen diario -- sigue leyendo
  // ESTO, sin cambios en este paso.
  noticeDays: number;
  // Los umbrales reales (1 a 3, ordenados de mayor a menor) desde
  // `reminder_notice_thresholds`. Para precargar el formulario de edición.
  // Caso borde (recordatorio sin ninguna fila hija todavía -- p. ej. uno
  // sembrado después de la migración): cae a `[notice_days]` para no
  // mostrar una lista vacía ni romper.
  noticeDaysThresholds: number[];
  // `recurrence` NO se trae: el campo se sacó del formulario y del listado
  // (ya no se muestra ni se filtra). La columna sigue en la base con los
  // valores que ya tuvieran los eventos -- solo dejó de leerse acá.
  status: ReminderStatusValue;
  // Color decorativo elegido por la persona (paso 1 de "color por evento").
  // SIN relación con la urgencia. Por ahora solo lo consume el formulario
  // para precargar el selector en edición -- ninguna vista (lista,
  // calendario, próximos) lo muestra todavía; eso es el paso 2.
  color: ReminderColorValue;
};

// Mismo patrón de organización que el resto del proyecto (ver CLAUDE.md >
// Acceso a datos): `organizationId` primero y obligatorio. `buildingId`
// segundo, OPCIONAL -- `null` es "todos los edificios" (vista agregada
// legítima, ver CLAUDE.md > Selector de edificio activo), no un valor
// especial que haya que guardar. `buildingName` siempre viene en el SELECT
// (INNER JOIN barato, `reminders.building_id` es NOT NULL) para que la UI
// decida sin una consulta aparte si mostrar la columna Edificio -- mismo
// criterio que `showBuildingColumn` en la bandeja de reclamos.
//
// `statuses` opcional: sin filtro (`null`), trae TODOS los estados -- la
// página lo usa para distinguir "no hay ningún recordatorio en este
// alcance" de "no hay ninguno con este filtro puntual" (mismo criterio que
// `hasExplicitFilters()` en la bandeja de reclamos), y también para el
// caso "todos los estados" del filtro.
//
// Sin paginación a propósito: los recordatorios de un edificio (fumigación,
// service de matafuegos, VTV del ascensor...) son, en la práctica, un
// puñado por edificio -- mismo orden de magnitud que las unidades de un
// edificio (ver el comentario de getUnitsForBuilding()), no la bandeja de
// reclamos.
export async function getReminderList(
  organizationId: string,
  buildingId: string | null,
  statuses: ReminderStatusValue[] | null,
): Promise<ReminderListRow[]> {
  return db
    .select({
      id: reminders.id,
      buildingId: reminders.buildingId,
      buildingName: buildings.name,
      title: reminders.title,
      description: reminders.description,
      dueDate: reminders.dueDate,
      noticeDays: reminders.noticeDays,
      noticeDaysThresholds: sql<number[]>`coalesce(
        (
          select array_agg(t.notice_days order by t.notice_days desc)
          from ${reminderNoticeThresholds} t
          where t.reminder_id = ${reminders.id}
            and t.organization_id = ${reminders.organizationId}
            and t.deleted_at is null
        ),
        array[${reminders.noticeDays}]
      )`,
      status: reminders.status,
      color: reminders.color,
    })
    .from(reminders)
    .innerJoin(buildings, eq(buildings.id, reminders.buildingId))
    .where(
      and(
        eq(reminders.organizationId, organizationId),
        buildingId ? eq(reminders.buildingId, buildingId) : undefined,
        statuses && statuses.length > 0
          ? inArray(reminders.status, statuses)
          : undefined,
        isNull(reminders.deletedAt),
      ),
    )
    .orderBy(asc(reminders.dueDate), asc(reminders.title));
}

// Distingue, cuando el listado filtrado da cero filas, "este alcance no
// tiene NINGÚN recordatorio todavía" de "no hay ninguno con este filtro" --
// mismo criterio que organizationHasAnyTicket() en tickets/queries.ts,
// disparada solo en esa rama puntual (ver page.tsx), nunca en el camino
// normal.
export async function organizationHasAnyReminder(
  organizationId: string,
  buildingId: string | null,
): Promise<boolean> {
  const [row] = await db
    .select({ id: reminders.id })
    .from(reminders)
    .where(
      and(
        eq(reminders.organizationId, organizationId),
        buildingId ? eq(reminders.buildingId, buildingId) : undefined,
        isNull(reminders.deletedAt),
      ),
    )
    .limit(1);

  return !!row;
}

// IDs de recordatorios de una organización que ya recibieron AL MENOS UN
// aviso de umbral dedicado (paso 3 de "múltiples umbrales"): tienen algún
// `reminder_notice_thresholds` activo con `notified_at IS NOT NULL`. Lo usa
// `sendDailySummaryEmail` para sacar del resumen general a los
// recordatorios PRÓXIMOS (no vencidos) que ya tuvieron su aviso puntual --
// un recordatorio vencido se sigue mostrando igual, ese filtro lo hace el
// caller con `getReminderUrgency`. Sin filtrar por el `deleted_at`/`status`
// del recordatorio: si tiene un umbral notificado, ya se avisó, sin
// importar en qué estado esté el padre.
export async function getReminderIdsWithNotifiedThreshold(
  organizationId: string,
): Promise<Set<string>> {
  const rows = await db
    .selectDistinct({ reminderId: reminderNoticeThresholds.reminderId })
    .from(reminderNoticeThresholds)
    .where(
      and(
        eq(reminderNoticeThresholds.organizationId, organizationId),
        isNull(reminderNoticeThresholds.deletedAt),
        isNotNull(reminderNoticeThresholds.notifiedAt),
      ),
    );

  return new Set(rows.map((r) => r.reminderId));
}

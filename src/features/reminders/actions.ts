"use server";

import { and, eq, inArray, isNull } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { db } from "@/db";
import { reminderNoticeThresholds, reminders } from "@/db/schema";
import { authorizedAction } from "@/lib/auth";
import { formatDateSlug } from "@/lib/format-date";

import {
  createReminderFormSchema,
  updateReminderFormSchema,
  type ReminderFieldErrors,
  type ReminderFormState,
} from "./reminder-schema";

// Transacción de Drizzle -- mismo alias que en group-tickets-into-incident.ts.
type DbTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

// Reconcilia las filas de `reminder_notice_thresholds` de UN recordatorio
// contra la lista de umbrales deseada, POR DIFERENCIA (no borrar-y-reinsertar
// a lo bruto): los umbrales que ya existían con el mismo valor de días
// quedan intactos -- con su `id`, su `created_at` y, sobre todo, su
// `notified_at` (que el paso 3 usa para no repetir un aviso). Los que se
// sacaron se dan de baja lógica (`deleted_at`, nunca DELETE físico -- misma
// regla que el resto de las entidades). Los nuevos se insertan.
//
// No hay un precedente exacto de "reconciliar el set de filas hijas al
// editar el padre" en el proyecto (announcement_recipients materializa UNA
// vez y nunca reconcilia; el alta masiva de unidades solo agrega, nunca
// borra) -- el criterio más cercano es el diff por clave natural del alta
// masiva de unidades (`existingKeys.has(unitKey(...))`), aplicado acá con
// `notice_days` como esa clave.
async function syncReminderNoticeThresholds(
  tx: DbTransaction,
  organizationId: string,
  reminderId: string,
  desiredDays: number[],
): Promise<void> {
  const existing = await tx
    .select({
      id: reminderNoticeThresholds.id,
      noticeDays: reminderNoticeThresholds.noticeDays,
    })
    .from(reminderNoticeThresholds)
    .where(
      and(
        eq(reminderNoticeThresholds.reminderId, reminderId),
        eq(reminderNoticeThresholds.organizationId, organizationId),
        isNull(reminderNoticeThresholds.deletedAt),
      ),
    );

  const desiredSet = new Set(desiredDays);
  const existingSet = new Set(existing.map((row) => row.noticeDays));

  const idsToRemove = existing
    .filter((row) => !desiredSet.has(row.noticeDays))
    .map((row) => row.id);
  const daysToInsert = desiredDays.filter((days) => !existingSet.has(days));

  if (idsToRemove.length > 0) {
    await tx
      .update(reminderNoticeThresholds)
      .set({ deletedAt: new Date() })
      .where(
        and(
          inArray(reminderNoticeThresholds.id, idsToRemove),
          eq(reminderNoticeThresholds.organizationId, organizationId),
        ),
      );
  }

  if (daysToInsert.length > 0) {
    await tx.insert(reminderNoticeThresholds).values(
      daysToInsert.map((days) => ({
        organizationId,
        reminderId,
        noticeDays: days,
      })),
    );
  }
}

// Invalida, después de cada mutación de recordatorios (paso 9.1): solo la
// bandeja de nivel superior -- `/panel/buildings/[buildingId]/reminders`
// sigue siendo el placeholder de solo lectura documentado en ese archivo
// (paso 4.2, punto 3), sin ninguna consulta real que revalidar todavía.
function revalidateReminderPaths() {
  revalidatePath("/panel/reminders");
}

function zodIssuesToFieldErrors(error: z.ZodError): ReminderFieldErrors {
  const fieldErrors: ReminderFieldErrors = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !(field in fieldErrors)) {
      fieldErrors[field as keyof ReminderFieldErrors] = issue.message;
    }
  }
  return fieldErrors;
}

// buildingId sale ya resuelto (el edificio elegido en el header, o un
// <select> cuando la vista es "todos los edificios" -- ver ReminderForm),
// nunca tipeado a mano. Puede ser un uuid de edificio O `null` (evento
// "General", sin edificio -- una tarea de toda la organización). La FK
// compuesta (building_id, organization_id) -> buildings(id, organization_id)
// (ver CLAUDE.md > Integridad entre organizaciones) es la defensa real de
// base contra un buildingId de otra organización; con `null`, MATCH SIMPLE
// no la chequea, exactamente como en announcements. No hace falta duplicar
// ese chequeo acá.
export const createReminderAction = authorizedAction(
  async (
    context,
    _prevState: ReminderFormState,
    input: unknown,
  ): Promise<ReminderFormState> => {
    // `today`: fecha civil de HOY en la zona de la organización -- mismo
    // criterio que page.tsx y los barridos (formatDateSlug), nunca
    // `new Date()` adentro del schema. Se inyecta acá para el tope
    // dinámico de los días de anticipación (ver reminder-schema.ts).
    const today = formatDateSlug(new Date(), context.organization.timezone);
    const parsed = createReminderFormSchema.safeParse({
      ...(input as Record<string, unknown>),
      today,
    });
    if (!parsed.success) {
      return {
        ok: false,
        formError: null,
        fieldErrors: zodIssuesToFieldErrors(parsed.error),
      };
    }

    const {
      title,
      description,
      dueDate,
      buildingId,
      noticeDaysThresholds,
      color,
    } = parsed.data;
    // Se arma el objeto a insertar campo por campo (no `...spread`): así el
    // `today` inyectado no llega a la base (no es columna) y `recurrence`
    // -- que ya no está en el schema -- no se manda, así que la base aplica
    // su default 'none'. `color` sí viaja (lo elige la persona en el
    // formulario); si no se mandara, la base aplicaría su default 'pizarra'.
    //
    // Valor puente: `reminders.notice_days` sigue siendo lo que lee
    // getReminderUrgency (semáforo/campana/resumen); se mantiene igual al
    // umbral MÁS GRANDE. El array está validado 1..3 por Zod, así que
    // `Math.max` nunca recibe vacío.
    const maxThreshold = Math.max(...noticeDaysThresholds);
    try {
      await db.transaction(async (tx) => {
        const [created] = await tx
          .insert(reminders)
          .values({
            organizationId: context.organization.id,
            buildingId,
            title,
            description,
            dueDate,
            color,
            noticeDays: maxThreshold,
          })
          .returning({ id: reminders.id });

        await tx.insert(reminderNoticeThresholds).values(
          noticeDaysThresholds.map((days) => ({
            organizationId: context.organization.id,
            reminderId: created!.id,
            noticeDays: days,
          })),
        );
      });
    } catch {
      return {
        ok: false,
        formError:
          "No pudimos guardar el evento. Probá de nuevo en un momento.",
        fieldErrors: {},
      };
    }

    revalidateReminderPaths();
    return { ok: true, formError: null, fieldErrors: {} };
  },
);

export const updateReminderAction = authorizedAction(
  async (
    context,
    _prevState: ReminderFormState,
    input: unknown,
  ): Promise<ReminderFormState> => {
    const today = formatDateSlug(new Date(), context.organization.timezone);
    const parsed = updateReminderFormSchema.safeParse({
      ...(input as Record<string, unknown>),
      today,
    });
    if (!parsed.success) {
      return {
        ok: false,
        formError: null,
        fieldErrors: zodIssuesToFieldErrors(parsed.error),
      };
    }

    const {
      id,
      buildingId,
      noticeDaysThresholds,
      title,
      description,
      dueDate,
      status,
      color,
    } = parsed.data;
    // Igual que en createReminderAction: se arma el `.set()` campo por
    // campo. `today` no es columna; `recurrence` ya no viaja en el schema,
    // así que el UPDATE no lo toca y el valor viejo del evento queda
    // intacto en la base. `color` sí se actualiza con lo que quedó elegido
    // en el selector (que se precarga con el color real del evento).
    const maxThreshold = Math.max(...noticeDaysThresholds);
    let updated: { id: string } | undefined;
    try {
      await db.transaction(async (tx) => {
        [updated] = await tx
          .update(reminders)
          .set({
            title,
            description,
            dueDate,
            status,
            color,
            noticeDays: maxThreshold,
          })
          .where(
            and(
              eq(reminders.id, id),
              // Guarda null-safe: un evento "General" tiene building_id NULL
              // y `eq(col, null)` nunca matchea en SQL. El id + la org ya
              // identifican la fila; esto solo verifica que el payload sea
              // internamente consistente.
              buildingId === null
                ? isNull(reminders.buildingId)
                : eq(reminders.buildingId, buildingId),
              eq(reminders.organizationId, context.organization.id),
              isNull(reminders.deletedAt),
            ),
          )
          .returning({ id: reminders.id });

        // El recordatorio no existe / es de otra organización / ya está
        // dado de baja -- no se tocó ninguna fila, así que tampoco hay que
        // tocar sus umbrales. La transacción cierra sin cambios; el mensaje
        // se arma afuera con `updated` en `undefined`.
        if (!updated) {
          return;
        }

        await syncReminderNoticeThresholds(
          tx,
          context.organization.id,
          id,
          noticeDaysThresholds,
        );
      });
    } catch {
      return {
        ok: false,
        formError:
          "No pudimos guardar el evento. Probá de nuevo en un momento.",
        fieldErrors: {},
      };
    }

    if (!updated) {
      return {
        ok: false,
        formError:
          "No encontramos ese evento. Puede que ya lo hayan dado de baja.",
        fieldErrors: {},
      };
    }

    revalidateReminderPaths();
    return { ok: true, formError: null, fieldErrors: {} };
  },
);

export type SimpleReminderActionResult = { ok: boolean; error?: string };

// Baja lógica (paso 9.1, punto 3): nunca DELETE físico, mismo criterio que
// softDeleteUnitAction (units/actions.ts). Sin dependencias que advertir
// antes de confirmar -- a diferencia de una unidad, nada referencia un
// recordatorio salvo `notifications.related_reminder_id` (nullable, un
// link informativo, no una FK que bloquee ni que haya que auditar antes de
// dar de baja).
export const softDeleteReminderAction = authorizedAction(
  async (
    context,
    buildingId: string | null,
    reminderId: string,
  ): Promise<SimpleReminderActionResult> => {
    // `buildingId` nullable: un evento "General" no tiene edificio. `null`
    // es válido; cualquier string que no sea un uuid, no.
    const parsedBuildingId = z.uuid().nullable().safeParse(buildingId);
    const parsedReminderId = z.uuid().safeParse(reminderId);
    if (!parsedBuildingId.success || !parsedReminderId.success) {
      return { ok: false, error: "Evento inválido." };
    }

    const [updated] = await db
      .update(reminders)
      .set({ deletedAt: new Date() })
      .where(
        and(
          eq(reminders.id, parsedReminderId.data),
          parsedBuildingId.data === null
            ? isNull(reminders.buildingId)
            : eq(reminders.buildingId, parsedBuildingId.data),
          eq(reminders.organizationId, context.organization.id),
          isNull(reminders.deletedAt),
        ),
      )
      .returning({ id: reminders.id });

    if (!updated) {
      return { ok: false, error: "No encontramos ese evento." };
    }

    revalidateReminderPaths();
    return { ok: true };
  },
);

import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  integer,
  pgTable,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { denyAnonAuthenticated, idColumn, timestamps } from "./_shared";
import { reminders } from "./reminders";

// Umbrales de aviso de un recordatorio -- "avisame 7 días antes, 3 días
// antes, y el mismo día". Hasta 3 por recordatorio (el tope 1..3 lo pone
// la capa de aplicación en un paso posterior, mismo criterio que
// MAX_TICKET_PHOTOS: la base no cuenta filas hijas).
//
// **Tabla hija, NO una columna array.** El schema del proyecto no usa
// arrays en ningún lado -- announcements.ts descartó explícitamente
// cambiar `building_id` por un array. Y cada umbral necesita estado propio
// MUTABLE (`notified_at`: "¿ya se mandó su aviso dedicado?"), algo que un
// array no puede llevar por elemento. Mismo molde que
// `announcement_recipients` (una fila por destinatario, con su
// `delivery_status`/`sent_at`).
//
// **Este paso es aditivo y la tabla queda DORMIDA:** `getReminderUrgency`
// (semáforo, campana, resumen diario) sigue leyendo `reminders.notice_days`
// tal cual hoy -- no cambia ningún comportamiento visible. La migración de
// datos crea exactamente UNA fila acá por cada recordatorio existente, con
// el `notice_days` que ese recordatorio ya tenía, así que
// `MAX(reminder_notice_thresholds.notice_days)` es idéntico al
// `reminders.notice_days` actual para toda fila -- listo para que un paso
// posterior mueva la lógica de urgencia a esta tabla sin cambiar cuándo se
// dispara "próximo a vencer". `reminders.notice_days` se mantiene por
// ahora; se elimina cuando ese paso reescriba el formulario.
export const reminderNoticeThresholds = pgTable(
  "reminder_notice_thresholds",
  {
    id: idColumn(),
    // Denormalizado desde `reminders.organization_id` -- hace posible la FK
    // compuesta de abajo (CLAUDE.md > Integridad entre organizaciones).
    // Nunca se actualiza a mano. Sin FK directa a `organizations`: la FK
    // compuesta hacia `reminders(id, organization_id)` ya garantiza la
    // integridad, y `reminders` a su vez referencia `organizations` --
    // mismo patrón que `ticket_attachments`/`announcement_recipients`.
    organizationId: uuid("organization_id").notNull(),
    reminderId: uuid("reminder_id").notNull(),
    // Días antes de `reminders.due_date` en que este umbral se activa.
    // Mismo dominio que el `reminders.notice_days` de hoy: 0 (el mismo
    // día) a 365 (un año antes). El CHECK replica el rango que ya valida
    // Zod en `reminder-schema.ts` -- defensa en profundidad, mismo criterio
    // que `ticket_similarity_candidates_similarity_range`.
    noticeDays: integer("notice_days").notNull(),
    // Paso posterior (todavía sin construir): el aviso DEDICADO de este
    // umbral. `NULL` = nunca se mandó; timestamp = cuándo se mandó. Misma
    // forma que `reminders.last_notified_at` /
    // `announcement_recipients.sent_at`. El barrido de ese paso hará
    // compare-and-swap contra `notified_at IS NULL` para idempotencia,
    // mismo criterio que `sweepDueReminders` contra
    // `reminders.status = 'pending'`.
    notifiedAt: timestamp("notified_at", { withTimezone: true }),
    ...timestamps(),
  },
  (t) => [
    foreignKey({
      columns: [t.reminderId, t.organizationId],
      foreignColumns: [reminders.id, reminders.organizationId],
    }).onDelete("restrict"),
    // No dos umbrales con el mismo número de días en el mismo
    // recordatorio. Índice único PARCIAL (`WHERE deleted_at IS NULL`),
    // nunca una CONSTRAINT plana -- convención congelada del proyecto (ver
    // `buildings.slug`, `people.phone_e164`, y la corrección de la
    // migración 0026): con borrado lógico, una constraint plana bloquearía
    // volver a agregar un umbral que se sacó. Su prefijo izquierdo
    // (`reminder_id`) cubre además "traé los umbrales de este
    // recordatorio", así que no hace falta un índice aparte.
    uniqueIndex("reminder_notice_thresholds_reminder_id_notice_days_unique")
      .on(t.reminderId, t.noticeDays)
      .where(sql`${t.deletedAt} is null`),
    check(
      "reminder_notice_thresholds_notice_days_range",
      sql`${t.noticeDays} >= 0 and ${t.noticeDays} <= 365`,
    ),
    denyAnonAuthenticated(),
  ],
).enableRLS();

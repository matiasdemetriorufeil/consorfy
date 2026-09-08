import { z } from "zod";

import {
  reminderColor,
  reminderRecurrence,
  reminderStatus,
} from "@/db/schema/reminders";

import { daysBetween } from "./reminder-urgency";

// Compartido entre cliente (ReminderForm, vía zodResolver) y servidor
// (actions.ts) -- mismo patrón que unit-schema.ts/building-schema.ts. Ver
// CLAUDE.md > Reglas de seguridad: toda entrada se valida con Zod en el
// servidor aunque ya se haya validado en el cliente.

// El campo "Recurrencia" se sacó del formulario y del listado: ya no se
// recibe ni se valida como input, y al crear un evento no se manda (la
// base aplica su default 'none'). La columna `reminders.recurrence` y su
// enum siguen existiendo en la base con los valores que ya tuvieran los
// eventos, sin tocar -- por eso estos tres se mantienen: mapean ese enum y
// vuelven a hacer falta el día que se reactive la funcionalidad.
export const REMINDER_RECURRENCES = reminderRecurrence.enumValues;
export type ReminderRecurrenceValue = (typeof REMINDER_RECURRENCES)[number];

export const RECURRENCE_LABEL: Record<ReminderRecurrenceValue, string> = {
  none: "Ninguna",
  monthly: "Mensual",
  quarterly: "Trimestral",
  biannual: "Semestral",
  annual: "Anual",
};

export const REMINDER_STATUSES = reminderStatus.enumValues;
export type ReminderStatusValue = (typeof REMINDER_STATUSES)[number];

export const REMINDER_STATUS_LABEL: Record<ReminderStatusValue, string> = {
  pending: "Pendiente",
  notified: "Notificado",
  done: "Hecho",
  dismissed: "Descartado",
};

// Default de la bandeja sin filtro explícito (paso 9.1, punto 1): los
// recordatorios VIGENTES, no todos -- mismo criterio que "abiertos" en la
// bandeja de reclamos (CLAUDE.md > Bandeja de reclamos con filtros).
// "notified" ya se dejó de lado por el barrido de notificaciones (etapa 9,
// pasos siguientes) pero sigue siendo algo que requiere atención, así que
// cuenta como vigente igual que "pending".
export const REMINDER_ACTIVE_STATUSES: ReminderStatusValue[] = [
  "pending",
  "notified",
];

// Color decorativo del evento (paso 1 de "color por evento"). Enum de
// nombres de color, SIN relación con la urgencia -- son dos sistemas
// separados a propósito (ver `reminderColor` en db/schema/reminders.ts y
// los tokens `--evento-*` de globals.css, aparte de `--urgente`/`--alta`/
// etc.). Los eventos ya existentes quedan en el default de la base
// ("pizarra") tras la migración.
export const REMINDER_COLORS = reminderColor.enumValues;
export type ReminderColorValue = (typeof REMINDER_COLORS)[number];

export const REMINDER_COLOR_LABEL: Record<ReminderColorValue, string> = {
  pizarra: "Pizarra",
  rojo: "Rojo",
  naranja: "Naranja",
  ambar: "Ámbar",
  verde: "Verde",
  azul: "Azul",
  violeta: "Violeta",
  rosa: "Rosa",
};

// Default al CREAR un evento nuevo -- mismo valor que el default de la
// columna: nace "sin clasificar" y la persona le pone color si quiere.
export const DEFAULT_REMINDER_COLOR: ReminderColorValue = "pizarra";

// yyyy-mm-dd -- formato nativo de <input type="date">, mismo patrón que
// occupancyFieldsSchema en people/person-schema.ts. `reminders.due_date` es
// una columna `date` pura (sin hora ni zona horaria, ver reminders.ts): una
// fecha civil, no un instante -- por eso esta validación no pasa por
// zonedDayBoundsToUtc ni ningún helper de timezone, a diferencia de
// reported_at/created_at en otras partes del panel.
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;
const DATE_HELP = "Ingresá una fecha válida.";

// Rango de anticipación: 0 (avisar el mismo día) a 365 (un año antes) --
// tope de sanidad, no un límite de negocio real (ver BULK_MAX_UNITS en
// unit-schema.ts para el mismo criterio: protege contra un typo, no
// restringe un caso de uso legítimo de este dominio).
const NOTICE_DAYS_MIN = 0;
const NOTICE_DAYS_MAX = 365;

// Un recordatorio puede tener entre 1 y 3 umbrales de aviso en días
// (paso 2 de "múltiples umbrales"): "avisame 7 días antes, 3 días antes, y
// el mismo día". Reemplaza al único `noticeDays` de antes. El tope de 3 es
// una decisión de producto (no de base -- la tabla `reminder_notice_thresholds`
// no cuenta filas hijas, mismo criterio que MAX_TICKET_PHOTOS).
export const MIN_NOTICE_THRESHOLDS = 1;
export const MAX_NOTICE_THRESHOLDS = 3;

export const reminderFieldsSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "Ingresá un título.")
    .max(200, "Como máximo 200 caracteres."),
  description: z
    .string()
    .trim()
    .max(2000, "Como máximo 2000 caracteres.")
    .nullish()
    .transform((value) => (value ? value : null)),
  dueDate: z.string().regex(DATE_REGEX, DATE_HELP),
  // Array de 1 a 3 enteros, cada uno 0..365 (mismo rango que validaba el
  // `noticeDays` único). z.number() (no z.coerce.number()): mismo motivo
  // que antes -- el <input type="number"> del formulario entrega numbers
  // reales. El .refine() ataja los duplicados ANTES de que lleguen a la
  // base: el índice único parcial (reminder_id, notice_days) de
  // `reminder_notice_thresholds` los rechazaría igual, pero con un error
  // crudo de Postgres en vez de este mensaje en español.
  noticeDaysThresholds: z
    .array(
      z
        .number({ message: "Ingresá los días de anticipación." })
        .int("Los días de anticipación tienen que ser un número entero.")
        .min(NOTICE_DAYS_MIN, `Como mínimo ${NOTICE_DAYS_MIN} días.`)
        .max(NOTICE_DAYS_MAX, `Como máximo ${NOTICE_DAYS_MAX} días.`),
    )
    .min(MIN_NOTICE_THRESHOLDS, "Dejá al menos un umbral de aviso.")
    .max(
      MAX_NOTICE_THRESHOLDS,
      `Como máximo ${MAX_NOTICE_THRESHOLDS} umbrales de aviso.`,
    )
    .refine((days) => new Set(days).size === days.length, {
      message: "No repitas la misma cantidad de días en más de un umbral.",
    }),
  // Color decorativo del evento -- enum, cualquiera de la paleta. El
  // selector del formulario siempre manda un valor válido (arranca en un
  // default, cada click pone otro válido), pero se valida igual en el
  // servidor (CLAUDE.md > Reglas de seguridad).
  color: z.enum(REMINDER_COLORS, {
    message: "Elegí un color para el evento.",
  }),
});

export type ReminderFieldsInput = z.input<typeof reminderFieldsSchema>;
export type ReminderFieldsOutput = z.output<typeof reminderFieldsSchema>;

// Tope DINÁMICO de los días de anticipación: cada umbral, como mucho, la
// cantidad de días entre HOY y la fecha de vencimiento -- no tiene sentido
// "avisar 10 días antes" de un evento que es en 5 días. `today` lo inyecta
// la Server Action con la fecha civil en la zona de la organización
// (formatDateSlug), mismo criterio que page.tsx y los barridos -- nunca
// `new Date()` adentro del schema. Reusa `daysBetween` de
// reminder-urgency.ts, no reimplementa el cálculo.
//
// Fecha ya vencida (daysBetween < 0): el tope se acota a 0. Un evento con
// fecha pasada nace "vencido" y ningún "N días antes" positivo tiene
// sentido, pero "avisar el mismo día" (0) sí -- así sigue siendo posible
// crear un evento con fecha pasada (con un único umbral de 0), sin agregar
// ninguna restricción nueva sobre la fecha en sí.
//
// Vive en `create/updateReminderFormSchema` (que juntan dueDate,
// noticeDaysThresholds y el `today` inyectado), no en `reminderFieldsSchema`
// -- así ese esquema base sigue siendo un `z.object` plano y
// `reminderClientFieldsSchema` puede seguir usando `.omit()`.
//
// Exportado: el cliente (ReminderForm, parte 1 de "tope en vivo") muestra
// exactamente este mismo texto cuando ataja el error antes del submit, sin
// esperar a que el servidor lo rechace.
export const DUE_DATE_NOTICE_MESSAGE =
  "Un umbral no puede superar los días que faltan para el vencimiento del evento.";

function noticeThresholdsWithinDueDate(data: {
  dueDate: string;
  noticeDaysThresholds: number[];
  today: string;
}): boolean {
  const maxAllowed = Math.max(0, daysBetween(data.today, data.dueDate));
  return data.noticeDaysThresholds.every((days) => days <= maxAllowed);
}

// `today` no es un campo del formulario: lo agrega la Server Action antes
// de parsear (mismo criterio que `buildingId`, que tampoco lo tipea la
// persona). El cliente no lo manda -- por eso `reminderClientFieldsSchema`
// lo omite junto con `noticeDaysThresholds`.
const serverTodaySchema = z.string().regex(DATE_REGEX);

// El formulario (ReminderForm) maneja `noticeDaysThresholds` y `color` con
// estado propio, NO react-hook-form -- mismo criterio que `buildingId`/
// `status` (ver el comentario largo en reminder-form.tsx): el selector de
// color son botones custom, no un input que `register()` pueda atar. Este
// subconjunto es el que valida el zodResolver del cliente: los campos que
// sí viven en RHF. Umbrales y color se validan en el servidor con
// `reminderFieldsSchema` completo (vía create/updateReminderFormSchema).
export const reminderClientFieldsSchema = reminderFieldsSchema.omit({
  noticeDaysThresholds: true,
  color: true,
});
export type ReminderClientFieldsInput = z.input<
  typeof reminderClientFieldsSchema
>;

// `buildingId` va DENTRO del esquema, no como argumento aparte -- mismo
// criterio que createUnitFormSchema (unit-schema.ts): se valida en la misma
// pasada que el resto, aunque no sea algo que la persona tipee directo (sale
// ya resuelto del edificio seleccionado en el header, o de un <select>
// cuando la vista es "todos los edificios" -- ver ReminderForm). `today` lo
// inyecta la Server Action (nunca lo tipea la persona) para el tope
// dinámico de `noticeDaysThresholds` -- ver noticeThresholdsWithinDueDate.
export const createReminderFormSchema = reminderFieldsSchema
  .extend({
    buildingId: z.uuid("Elegí un edificio."),
    today: serverTodaySchema,
  })
  .refine(noticeThresholdsWithinDueDate, {
    message: DUE_DATE_NOTICE_MESSAGE,
    path: ["noticeDaysThresholds"],
  });
export type CreateReminderFormInput = z.input<typeof createReminderFormSchema>;

// El estado SÍ es editable acá (a diferencia de la creación, que siempre
// nace "pending" del lado del servidor, nunca elegido a mano) -- es la
// única forma que tiene este paso de mover un recordatorio fuera de
// "pending"/"notified" sin construir el flujo de recurrencia/notificaciones
// (fuera de alcance del paso 9.1, ver el comentario de `seriesId` en
// reminders.ts: crear la fila siguiente de una serie recurrente es etapa 9,
// pero un paso posterior, no este). Sin esto, el filtro por estado del
// listado (punto 1) no tendría ninguna forma real de mostrar algo más que
// "pending".
export const updateReminderFormSchema = reminderFieldsSchema
  .extend({
    id: z.uuid(),
    buildingId: z.uuid(),
    status: z.enum(REMINDER_STATUSES, { message: "Elegí un estado." }),
    today: serverTodaySchema,
  })
  .refine(noticeThresholdsWithinDueDate, {
    message: DUE_DATE_NOTICE_MESSAGE,
    path: ["noticeDaysThresholds"],
  });
export type UpdateReminderFormInput = z.input<typeof updateReminderFormSchema>;

export type ReminderFieldErrors = Partial<
  Record<keyof UpdateReminderFormInput, string>
>;

export type ReminderFormState = {
  ok: boolean;
  formError: string | null;
  fieldErrors: ReminderFieldErrors;
};

export const initialReminderFormState: ReminderFormState = {
  ok: false,
  formError: null,
  fieldErrors: {},
};

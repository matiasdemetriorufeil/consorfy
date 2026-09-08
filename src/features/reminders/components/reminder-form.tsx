"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Check, Plus, X } from "lucide-react";
import { useForm } from "react-hook-form";

import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import type { ActiveBuildingOption } from "@/features/buildings/queries";
import { formatDateSlug } from "@/lib/format-date";
import { cn } from "@/lib/utils";

import { createReminderAction, updateReminderAction } from "../actions";
import type { ReminderListRow } from "../queries";
import {
  DEFAULT_REMINDER_COLOR,
  DUE_DATE_NOTICE_MESSAGE,
  initialReminderFormState,
  MAX_NOTICE_THRESHOLDS,
  reminderClientFieldsSchema,
  REMINDER_COLOR_LABEL,
  REMINDER_COLORS,
  REMINDER_STATUS_LABEL,
  REMINDER_STATUSES,
  type ReminderClientFieldsInput,
  type ReminderColorValue,
  type ReminderStatusValue,
} from "../reminder-schema";
import { daysBetween } from "../reminder-urgency";
import { REMINDER_COLOR_BG } from "./reminder-color";

// Campos que sí viven en react-hook-form -- ver el comentario de más abajo
// sobre por qué `buildingId`/`status`/`noticeDaysThresholds` quedan afuera.
const RHF_MANAGED_FIELDS = new Set<keyof ReminderClientFieldsInput>([
  "title",
  "description",
  "dueDate",
]);

// La lista de umbrales se maneja como estado propio (strings, lo que
// entrega un <input type="number"> vacío o a medio tipear), no en
// react-hook-form -- mismo motivo que `buildingId`/`status`. Se convierten
// a numbers recién al armar el payload; un campo vacío -> NaN, que el
// esquema del servidor rechaza con un mensaje claro.
function parseThresholdInputs(values: string[]): number[] {
  return values.map((value) =>
    value.trim() === "" ? Number.NaN : Number(value),
  );
}

// Tope dinámico en el CLIENTE (parte 1): cada umbral, como mucho, la
// cantidad de días que van de HOY a la fecha de vencimiento -- para que la
// persona vea el problema mientras completa el formulario, sin esperar al
// submit. La validación del servidor (noticeThresholdsWithinDueDate en
// reminder-schema.ts) NO cambia y sigue siendo la autoridad final; esto
// solo hace que casi nunca se llegue a ver su error.
//
// Es la MISMA cuenta que el servidor: se reusa `daysBetween` de
// reminder-urgency.ts (función pura, sin `server-only`), no se reimplementa
// el cálculo de días. Lo único propio del cliente es el "hoy": la fecha
// civil local del navegador (`formatDateSlug` con la zona del navegador),
// porque acá no se conoce la zona de la organización que usa el servidor
// -- diferencia intencional, sin efecto práctico salvo en la ventana de
// pocas horas alrededor de la medianoche.
function browserTodaySlug(): string {
  return formatDateSlug(
    new Date(),
    Intl.DateTimeFormat().resolvedOptions().timeZone,
  );
}

// `null` mientras la fecha de vencimiento no sea una fecha completa y
// válida (campo vacío o a medio tipear): sin fecha no hay tope que aplicar.
// Vencida (daysBetween < 0) -> 0, igual que el servidor.
function maxNoticeDaysFor(dueDate: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) {
    return null;
  }
  return Math.max(0, daysBetween(browserTodaySlug(), dueDate));
}

// Un solo formulario para alta y edición (mismo criterio que UnitForm,
// paso 4.3). `buildingId`/`status` viven FUERA de react-hook-form (estado
// propio, no Controller sobre el resolver) a propósito -- mismo motivo que
// UnitForm con `buildingId`: el resolver de Zod (`reminderFieldsSchema`) no
// los incluye, así que si viajaran como parte de los `values` que maneja
// react-hook-form, zodResolver los descartaría del objeto que llega a
// `onSubmit` (strip de campos no declarados en el schema que valida). Se
// mezclan recién en el payload final, después de `handleSubmit`.
//
// `lockedBuildingId`: el edificio elegido en el header (o el de la fila que
// se está editando) -- cuando es `null` (vista "todos los edificios"
// creando un recordatorio nuevo), el formulario pide el edificio con un
// <select> propio en vez de asumir uno. En edición, `reminder.buildingId`
// SIEMPRE gana sobre el edificio seleccionado en el header -- un
// recordatorio no cambia de edificio al editarlo, ni siquiera mirando la
// vista agregada.
export function ReminderForm({
  buildingOptions,
  lockedBuildingId,
  reminder,
  onSuccess,
}: {
  buildingOptions: ActiveBuildingOption[];
  lockedBuildingId: string | null;
  reminder?: ReminderListRow;
  onSuccess: () => void;
}) {
  const mode = reminder ? "edit" : "create";
  const action = mode === "edit" ? updateReminderAction : createReminderAction;
  const [state, dispatch, isPending] = useActionState(
    action,
    initialReminderFormState,
  );

  const [buildingId, setBuildingId] = useState(
    reminder?.buildingId ?? lockedBuildingId ?? "",
  );
  const [status, setStatus] = useState<ReminderStatusValue>(
    reminder?.status ?? "pending",
  );
  // Color decorativo. Estado propio (no react-hook-form) -- mismo criterio
  // que `status`: el selector son botones custom, no un input. En edición
  // se precarga el color REAL del evento; al crear, el default de la
  // paleta.
  const [color, setColor] = useState<ReminderColorValue>(
    reminder?.color ?? DEFAULT_REMINDER_COLOR,
  );
  // Umbrales de aviso (1 a 3). En edición se precargan desde los umbrales
  // REALES del recordatorio (`reminder.noticeDaysThresholds`, ya resueltos
  // por getReminderList -- que además cubre el caso borde del recordatorio
  // sin ninguna fila hija cayendo a `[notice_days]`), no desde
  // `reminder.noticeDays`. En alta, un solo umbral de 7 días (el default
  // que tenía el campo único).
  const [thresholds, setThresholds] = useState<string[]>(
    reminder
      ? reminder.noticeDaysThresholds.map((days) => String(days))
      : ["7"],
  );

  function updateThreshold(index: number, value: string) {
    setThresholds((current) =>
      current.map((entry, i) => (i === index ? value : entry)),
    );
  }
  function addThreshold() {
    setThresholds((current) =>
      current.length < MAX_NOTICE_THRESHOLDS ? [...current, ""] : current,
    );
  }
  function removeThreshold(index: number) {
    setThresholds((current) =>
      current.length > 1 ? current.filter((_, i) => i !== index) : current,
    );
  }

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    watch,
    formState: { errors },
  } = useForm<ReminderClientFieldsInput>({
    resolver: zodResolver(reminderClientFieldsSchema),
    defaultValues: reminder
      ? {
          title: reminder.title,
          description: reminder.description ?? "",
          dueDate: reminder.dueDate,
        }
      : {
          title: "",
          description: "",
          dueDate: "",
        },
  });

  // Mismo patrón que BuildingForm/UnitForm: reacciona a cada resolución
  // nueva de la Server Action.
  useEffect(() => {
    if (state.ok) {
      onSuccess();
      return;
    }

    const entries = Object.entries(state.fieldErrors) as [
      keyof ReminderClientFieldsInput,
      string,
    ][];
    let firstField: keyof ReminderClientFieldsInput | null = null;
    for (const [field, message] of entries) {
      // `buildingId`/`status` no son campos de react-hook-form (ver el
      // comentario de arriba) -- sus errores de servidor se leen aparte
      // (`buildingError` más abajo; `status` no tiene validación propia
      // más allá del enum del <select>, no necesita este mecanismo).
      if (!RHF_MANAGED_FIELDS.has(field)) {
        continue;
      }
      setError(field, { type: "server", message });
      firstField ??= field;
    }
    if (firstField) {
      setFocus(firstField);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const buildingError = !state.ok ? state.fieldErrors.buildingId : undefined;
  const thresholdsError = !state.ok
    ? state.fieldErrors.noticeDaysThresholds
    : undefined;

  // Tope dinámico, recalculado en cada render a partir de la fecha de
  // vencimiento ACTUAL del formulario -- si la persona la cambia después de
  // cargar umbrales, esto se rehace solo y los que quedaron por encima del
  // nuevo tope pasan a estar marcados (punto 4).
  const maxNoticeDays = maxNoticeDaysFor(watch("dueDate"));
  const parsedThresholds = parseThresholdInputs(thresholds);

  // Punto 2/4: un umbral queda inválido AL INSTANTE si supera el tope --
  // ya sea porque se tipeó de más, o porque se movió la fecha de
  // vencimiento. Se MARCA (mismo mensaje que el servidor,
  // DUE_DATE_NOTICE_MESSAGE), no se autocorrige: pisar en silencio un
  // número que la persona escribió a propósito es peor que mostrarle cuál
  // corregir, y es lo mismo que hace el resto del formulario con sus
  // errores. `min`/`max` del <input> ya frenan el spinner; esto ataja lo
  // que se tipea a mano.
  const overCapIndexes = new Set<number>(
    maxNoticeDays === null
      ? []
      : parsedThresholds.flatMap((days, index) =>
          Number.isFinite(days) && days > maxNoticeDays ? [index] : [],
        ),
  );
  const clientThresholdsError =
    overCapIndexes.size > 0 ? DUE_DATE_NOTICE_MESSAGE : null;

  // Punto 3: "Agregar otro umbral" se apaga al llegar a 3 (como ya pasaba)
  // y TAMBIÉN cuando ya no queda ningún valor entero válido y sin repetir
  // para sumar -- p. ej. si al evento le faltan 0 días, el único valor
  // posible es 0: con un umbral ya en 0, un segundo sería duplicado y fuera
  // de rango. Con 2 o más días de margen esto nunca se nota (siempre
  // alcanza para 3 umbrales distintos).
  const usedValuesInRange = new Set(
    maxNoticeDays === null
      ? []
      : parsedThresholds.filter(
          (days) =>
            Number.isInteger(days) && days >= 0 && days <= maxNoticeDays,
        ),
  );
  const cannotAddThreshold =
    thresholds.length >= MAX_NOTICE_THRESHOLDS ||
    (maxNoticeDays !== null && usedValuesInRange.size >= maxNoticeDays + 1);

  return (
    <form
      noValidate
      onSubmit={handleSubmit((data) => {
        const noticeDaysThresholds = parseThresholdInputs(thresholds);
        // Defensa en profundidad: el botón ya está deshabilitado con un
        // umbral fuera del tope, pero si algo lo saltea no se dispara la
        // acción (el servidor lo rechazaría igual, con este mismo mensaje).
        const cap = maxNoticeDaysFor(data.dueDate);
        if (
          cap !== null &&
          noticeDaysThresholds.some(
            (days) => Number.isFinite(days) && days > cap,
          )
        ) {
          return;
        }
        const payload = reminder
          ? {
              ...data,
              id: reminder.id,
              buildingId: reminder.buildingId,
              status,
              color,
              noticeDaysThresholds,
            }
          : { ...data, buildingId, color, noticeDaysThresholds };
        startTransition(() => dispatch(payload));
      })}
    >
      <FieldGroup>
        {state.formError && (
          <Alert variant="destructive">
            <AlertDescription>{state.formError}</AlertDescription>
          </Alert>
        )}

        {/* Sin edificio fijo (vista "todos los edificios", solo al crear):
            el formulario tiene que pedirlo, un recordatorio siempre
            pertenece a UN edificio puntual (reminders.building_id NOT
            NULL). En edición, o con un edificio elegido en el header, esto
            no se muestra -- el contexto ya lo deja claro. */}
        {mode === "create" && !lockedBuildingId && (
          <Field data-invalid={!!buildingError}>
            <FieldLabel htmlFor="reminder-building">Edificio</FieldLabel>
            <Select
              value={buildingId}
              onValueChange={setBuildingId}
              disabled={isPending}
            >
              <SelectTrigger
                id="reminder-building"
                aria-invalid={!!buildingError}
                className="w-full"
              >
                <SelectValue placeholder="Elegí un edificio" />
              </SelectTrigger>
              <SelectContent>
                {buildingOptions.map((building) => (
                  <SelectItem key={building.id} value={building.id}>
                    {building.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldError
              errors={[buildingError ? { message: buildingError } : undefined]}
            />
          </Field>
        )}

        <Field data-invalid={!!errors.title}>
          <FieldLabel htmlFor="reminder-title">Título</FieldLabel>
          <Input
            id="reminder-title"
            autoComplete="off"
            placeholder="Ej: Fumigación, service del ascensor"
            aria-invalid={!!errors.title}
            disabled={isPending}
            {...register("title")}
          />
          <FieldError errors={[errors.title]} />
        </Field>

        <Field data-invalid={!!errors.description}>
          <FieldLabel htmlFor="reminder-description">Descripción</FieldLabel>
          <Textarea
            id="reminder-description"
            placeholder="Opcional"
            aria-invalid={!!errors.description}
            disabled={isPending}
            {...register("description")}
          />
          <FieldError errors={[errors.description]} />
        </Field>

        {/* Color decorativo/organizativo (paso 1 de 2). Selector visual --
            un círculo por color de la paleta, el elegido lleva un anillo.
            No hay precedente de "elegir una opción mostrada visualmente"
            como control de formulario en el proyecto (los chips de estado
            son <Link> de navegación), así que es un radiogroup ARIA a mano:
            role="radiogroup" + botones role="radio", un click cambia la
            selección. SIN relación con la urgencia. */}
        <Field>
          <FieldLabel id="reminder-color-label" htmlFor="reminder-color">
            Color
          </FieldLabel>
          <FieldDescription>
            Para organizar los eventos a ojo. No cambia los avisos ni la
            urgencia.
          </FieldDescription>
          <div
            id="reminder-color"
            role="radiogroup"
            aria-labelledby="reminder-color-label"
            className="flex flex-wrap gap-2"
          >
            {REMINDER_COLORS.map((value) => {
              const selected = color === value;
              return (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  aria-label={REMINDER_COLOR_LABEL[value]}
                  title={REMINDER_COLOR_LABEL[value]}
                  disabled={isPending}
                  onClick={() => setColor(value)}
                  className={cn(
                    "border-border/60 flex size-8 items-center justify-center rounded-full border transition outline-none",
                    "focus-visible:ring-ring focus-visible:ring-offset-background focus-visible:ring-2 focus-visible:ring-offset-2",
                    "disabled:opacity-50",
                    REMINDER_COLOR_BG[value],
                    selected &&
                      "ring-ring ring-offset-background ring-2 ring-offset-2",
                  )}
                >
                  {selected && (
                    <Check
                      className="size-4 text-white drop-shadow-sm"
                      aria-hidden="true"
                    />
                  )}
                </button>
              );
            })}
          </div>
        </Field>

        <Field data-invalid={!!errors.dueDate}>
          <FieldLabel htmlFor="reminder-due-date">
            Fecha de vencimiento
          </FieldLabel>
          <Input
            id="reminder-due-date"
            type="date"
            aria-invalid={!!errors.dueDate}
            disabled={isPending}
            {...register("dueDate")}
          />
          <FieldError errors={[errors.dueDate]} />
        </Field>

        {/* Días de anticipación -- de 1 a 3 umbrales ("avisame 7 días
            antes, 3 días antes, y el mismo día"). Lista con estado propio
            + botones agregar/quitar, mismo estilo de "lista de hasta N
            elementos" que ya usa AnnouncementSegmentForm (personas
            puntuales) y los adjuntos de TicketForm: <Button variant=
            "outline"> para agregar, un botón-ícono por fila para quitar. */}
        <Field data-invalid={!!thresholdsError || !!clientThresholdsError}>
          <FieldLabel htmlFor="reminder-notice-days-0">
            Días de anticipación
          </FieldLabel>
          <FieldDescription>
            Cuántos días antes del vencimiento querés que le llegue un mail al
            administrador. Se envía uno por cada umbral, el día que corresponde.
            Podés cargar hasta {MAX_NOTICE_THRESHOLDS}.
          </FieldDescription>
          <div className="flex flex-col gap-2">
            {thresholds.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  id={`reminder-notice-days-${index}`}
                  type="number"
                  min={0}
                  max={maxNoticeDays ?? 365}
                  className="flex-1"
                  aria-label={`Umbral de aviso ${index + 1}, en días`}
                  aria-invalid={!!thresholdsError || overCapIndexes.has(index)}
                  disabled={isPending}
                  value={value}
                  onChange={(event) =>
                    updateThreshold(index, event.target.value)
                  }
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label={`Quitar el umbral de aviso ${index + 1}`}
                  disabled={isPending || thresholds.length <= 1}
                  onClick={() => removeThreshold(index)}
                >
                  <X />
                </Button>
              </div>
            ))}
          </div>
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="mt-1 w-fit"
            disabled={isPending || cannotAddThreshold}
            onClick={addThreshold}
          >
            <Plus />
            Agregar otro umbral
          </Button>
          <FieldError
            errors={[
              thresholdsError
                ? { message: thresholdsError }
                : clientThresholdsError
                  ? { message: clientThresholdsError }
                  : undefined,
            ]}
          />
        </Field>

        {/* Estado: solo editable en edición -- un recordatorio nuevo
            siempre nace "pending" del lado del servidor (ver actions.ts).
            Es la única forma que tiene este paso de moverlo a otro estado
            sin construir el flujo de recurrencia/notificaciones, fuera de
            alcance acá (ver reminder-schema.ts). */}
        {mode === "edit" && (
          <Field>
            <FieldLabel htmlFor="reminder-status">Estado</FieldLabel>
            <Select
              value={status}
              onValueChange={(value) => setStatus(value as ReminderStatusValue)}
              disabled={isPending}
            >
              <SelectTrigger id="reminder-status" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {REMINDER_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {REMINDER_STATUS_LABEL[value]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        )}

        <Button
          type="submit"
          disabled={isPending || !!clientThresholdsError}
          className="w-full"
        >
          {isPending
            ? "Guardando…"
            : mode === "edit"
              ? "Guardar cambios"
              : "Crear evento"}
        </Button>
      </FieldGroup>
    </form>
  );
}

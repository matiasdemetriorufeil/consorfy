"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, X } from "lucide-react";
import { Controller, useForm } from "react-hook-form";

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

import { createReminderAction, updateReminderAction } from "../actions";
import type { ReminderListRow } from "../queries";
import {
  initialReminderFormState,
  MAX_NOTICE_THRESHOLDS,
  RECURRENCE_LABEL,
  reminderClientFieldsSchema,
  REMINDER_RECURRENCES,
  REMINDER_STATUS_LABEL,
  REMINDER_STATUSES,
  type ReminderClientFieldsInput,
  type ReminderStatusValue,
} from "../reminder-schema";

// Campos que sí viven en react-hook-form -- ver el comentario de más abajo
// sobre por qué `buildingId`/`status`/`noticeDaysThresholds` quedan afuera.
const RHF_MANAGED_FIELDS = new Set<keyof ReminderClientFieldsInput>([
  "title",
  "description",
  "dueDate",
  "recurrence",
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
    control,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<ReminderClientFieldsInput>({
    resolver: zodResolver(reminderClientFieldsSchema),
    defaultValues: reminder
      ? {
          title: reminder.title,
          description: reminder.description ?? "",
          dueDate: reminder.dueDate,
          recurrence: reminder.recurrence,
        }
      : {
          title: "",
          description: "",
          dueDate: "",
          recurrence: "none",
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
  const atMaxThresholds = thresholds.length >= MAX_NOTICE_THRESHOLDS;

  return (
    <form
      noValidate
      onSubmit={handleSubmit((data) => {
        const noticeDaysThresholds = parseThresholdInputs(thresholds);
        const payload = reminder
          ? {
              ...data,
              id: reminder.id,
              buildingId: reminder.buildingId,
              status,
              noticeDaysThresholds,
            }
          : { ...data, buildingId, noticeDaysThresholds };
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
        <Field data-invalid={!!thresholdsError}>
          <FieldLabel htmlFor="reminder-notice-days-0">
            Días de anticipación
          </FieldLabel>
          <FieldDescription>
            Cuántos días antes del vencimiento querés que te avisemos. Podés
            cargar hasta {MAX_NOTICE_THRESHOLDS}.
          </FieldDescription>
          <div className="flex flex-col gap-2">
            {thresholds.map((value, index) => (
              <div key={index} className="flex items-center gap-2">
                <Input
                  id={`reminder-notice-days-${index}`}
                  type="number"
                  min={0}
                  max={365}
                  className="flex-1"
                  aria-label={`Umbral de aviso ${index + 1}, en días`}
                  aria-invalid={!!thresholdsError}
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
            disabled={isPending || atMaxThresholds}
            onClick={addThreshold}
          >
            <Plus />
            Agregar otro umbral
          </Button>
          <FieldError
            errors={[
              thresholdsError ? { message: thresholdsError } : undefined,
            ]}
          />
        </Field>

        <Field data-invalid={!!errors.recurrence}>
          <FieldLabel htmlFor="reminder-recurrence">Recurrencia</FieldLabel>
          <Controller
            control={control}
            name="recurrence"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isPending}
              >
                <SelectTrigger
                  id="reminder-recurrence"
                  aria-invalid={!!errors.recurrence}
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {REMINDER_RECURRENCES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {RECURRENCE_LABEL[value]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.recurrence]} />
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

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending
            ? "Guardando…"
            : mode === "edit"
              ? "Guardar cambios"
              : "Crear recordatorio"}
        </Button>
      </FieldGroup>
    </form>
  );
}

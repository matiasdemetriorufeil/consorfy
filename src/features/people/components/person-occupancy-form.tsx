"use client";

import { startTransition, useActionState, useEffect, useState } from "react";
import { Controller, useForm } from "react-hook-form";

import { PhoneNumberInput } from "@/components/phone-number-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
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
import { AR_WHATSAPP_HELP } from "@/lib/phone";
import type { BuildingUnitRow } from "@/features/units/queries";

import {
  checkPersonByPhoneAction,
  createPersonWithOccupancyAction,
} from "../actions";
import { OCCUPANCY_ROLE_LABEL } from "../occupancy-role";
import {
  initialPersonFormState,
  OCCUPANCY_ROLES,
  type CreatePersonWithOccupancyInput,
} from "../person-schema";
import type { PersonPhoneMatch } from "../queries";

// Mismo umbral que UnitForm (paso 4.3) para el chequeo en vivo del
// teléfono.
const PHONE_DEBOUNCE_MS = 400;

type PhoneLookupState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "no-match" }
  | { status: "match"; person: PersonPhoneMatch };

type FormValues = {
  firstName: string;
  lastName: string;
  phoneE164: string;
  email: string;
  notes: string;
  unitId: string;
  role: (typeof OCCUPANCY_ROLES)[number];
  isPrimary: boolean;
  startedOn: string;
};

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

// Alta combinada de vecino + asignación a unidad (paso 4.4). El teléfono es
// el dato que decide el modo (decisión 1 del reporte, "cómo evitar cargar a
// la misma persona dos veces"): apenas tiene formato de WhatsApp argentino
// válido, se busca en vivo contra la organización
// (checkPersonByPhoneAction, mismo patrón de debounce que
// checkUnitAvailableAction en UnitForm). Si hay coincidencia, los campos de
// datos personales se esconden -- no tiene sentido volver a pedir nombre o
// email de alguien que ya está cargado -- y el formulario pasa a asignar
// esa misma persona a la unidad elegida.
export function PersonOccupancyForm({
  buildingId,
  units,
  onSuccess,
}: {
  buildingId: string;
  units: BuildingUnitRow[];
  onSuccess: () => void;
}) {
  const [state, dispatch, isPending] = useActionState(
    createPersonWithOccupancyAction,
    initialPersonFormState,
  );

  const {
    register,
    handleSubmit,
    control,
    watch,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<FormValues>({
    defaultValues: {
      firstName: "",
      lastName: "",
      phoneE164: "",
      email: "",
      notes: "",
      unitId: "",
      role: "owner",
      isPrimary: false,
      startedOn: today(),
    },
  });

  const [lookup, setLookup] = useState<PhoneLookupState>({ status: "idle" });
  const phoneValue = watch("phoneE164");

  useEffect(() => {
    const phone = phoneValue.trim();
    if (!phone) {
      setLookup({ status: "idle" });
      return;
    }

    setLookup({ status: "checking" });
    const timeout = setTimeout(() => {
      startTransition(async () => {
        const result = await checkPersonByPhoneAction(phone);
        setLookup(
          result.match
            ? { status: "match", person: result.match }
            : { status: "no-match" },
        );
      });
    }, PHONE_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [phoneValue]);

  useEffect(() => {
    if (state.ok) {
      onSuccess();
      return;
    }

    const entries = Object.entries(state.fieldErrors) as [
      keyof FormValues,
      string,
    ][];
    let firstField: keyof FormValues | null = null;
    for (const [field, message] of entries) {
      setError(field, { type: "server", message });
      firstField ??= field;
    }
    if (firstField) {
      setFocus(firstField);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  const matchedPerson = lookup.status === "match" ? lookup.person : null;

  function submit(data: FormValues) {
    const shared = {
      buildingId,
      unitId: data.unitId,
      role: data.role,
      isPrimary: data.isPrimary,
      startedOn: data.startedOn,
    };

    const payload: CreatePersonWithOccupancyInput = matchedPerson
      ? { mode: "existing", personId: matchedPerson.id, ...shared }
      : {
          mode: "new",
          firstName: data.firstName,
          lastName: data.lastName || null,
          phoneE164: data.phoneE164 || null,
          email: data.email || null,
          notes: data.notes || null,
          ...shared,
        };

    startTransition(() => dispatch(payload));
  }

  return (
    <form noValidate onSubmit={handleSubmit(submit)}>
      <FieldGroup>
        {state.formError && (
          <Alert variant="destructive">
            <AlertDescription>{state.formError}</AlertDescription>
          </Alert>
        )}

        <Field data-invalid={!!errors.phoneE164}>
          <FieldLabel htmlFor="person-phone">Teléfono</FieldLabel>
          <Controller
            control={control}
            name="phoneE164"
            render={({ field }) => (
              <PhoneNumberInput
                id="person-phone"
                name={field.name}
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                disabled={isPending}
                placeholder="93515551234"
                aria-invalid={!!errors.phoneE164}
              />
            )}
          />
          {!errors.phoneE164 && lookup.status === "checking" && (
            <FieldDescription>Buscando…</FieldDescription>
          )}
          {!errors.phoneE164 && lookup.status !== "checking" && (
            <FieldDescription>{AR_WHATSAPP_HELP}</FieldDescription>
          )}
          <FieldError errors={[errors.phoneE164]} />
        </Field>

        {matchedPerson && (
          <Card className="border-primary/30 bg-primary/5">
            <CardContent className="text-sm">
              Ya existe un vecino con este teléfono:{" "}
              <strong>
                {matchedPerson.firstName} {matchedPerson.lastName ?? ""}
              </strong>
              . Vas a asignar a esta misma persona a la unidad elegida, en vez
              de crear un vecino nuevo.
            </CardContent>
          </Card>
        )}

        {!matchedPerson && (
          <>
            <Field data-invalid={!!errors.firstName}>
              <FieldLabel htmlFor="person-first-name">Nombre</FieldLabel>
              <Input
                id="person-first-name"
                autoComplete="off"
                aria-invalid={!!errors.firstName}
                disabled={isPending}
                {...register("firstName", { required: "Ingresá un nombre." })}
              />
              <FieldError errors={[errors.firstName]} />
            </Field>

            <Field data-invalid={!!errors.lastName}>
              <FieldLabel htmlFor="person-last-name">Apellido</FieldLabel>
              <Input
                id="person-last-name"
                autoComplete="off"
                placeholder="Opcional"
                aria-invalid={!!errors.lastName}
                disabled={isPending}
                {...register("lastName")}
              />
              <FieldError errors={[errors.lastName]} />
            </Field>

            <Field data-invalid={!!errors.email}>
              <FieldLabel htmlFor="person-email">Email</FieldLabel>
              <Input
                id="person-email"
                type="email"
                autoComplete="off"
                placeholder="Opcional"
                aria-invalid={!!errors.email}
                disabled={isPending}
                {...register("email")}
              />
              <FieldError errors={[errors.email]} />
            </Field>

            <Field data-invalid={!!errors.notes}>
              <FieldLabel htmlFor="person-notes">Notas</FieldLabel>
              <Textarea
                id="person-notes"
                placeholder="Opcional"
                aria-invalid={!!errors.notes}
                disabled={isPending}
                {...register("notes")}
              />
              <FieldError errors={[errors.notes]} />
            </Field>
          </>
        )}

        <Field data-invalid={!!errors.unitId}>
          <FieldLabel htmlFor="person-unit">Unidad</FieldLabel>
          <Controller
            control={control}
            name="unitId"
            rules={{ required: "Elegí una unidad." }}
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isPending}
              >
                <SelectTrigger
                  id="person-unit"
                  aria-invalid={!!errors.unitId}
                  className="w-full"
                >
                  <SelectValue placeholder="Elegí una unidad" />
                </SelectTrigger>
                <SelectContent>
                  {units.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id}>
                      {unit.tower ? `${unit.tower} - ` : ""}
                      {unit.floor}°{unit.number}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
          <FieldError errors={[errors.unitId]} />
        </Field>

        <Field data-invalid={!!errors.role}>
          <FieldLabel htmlFor="person-role">Rol</FieldLabel>
          <Controller
            control={control}
            name="role"
            render={({ field }) => (
              <Select
                value={field.value}
                onValueChange={field.onChange}
                disabled={isPending}
              >
                <SelectTrigger id="person-role" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {OCCUPANCY_ROLES.map((role) => (
                    <SelectItem key={role} value={role}>
                      {OCCUPANCY_ROLE_LABEL[role]}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
          />
        </Field>

        <Field data-invalid={!!errors.startedOn}>
          <FieldLabel htmlFor="person-started-on">Desde</FieldLabel>
          <Input
            id="person-started-on"
            type="date"
            aria-invalid={!!errors.startedOn}
            disabled={isPending}
            {...register("startedOn", { required: "Ingresá una fecha." })}
          />
          <FieldError errors={[errors.startedOn]} />
        </Field>

        <Field orientation="horizontal">
          <Controller
            control={control}
            name="isPrimary"
            render={({ field }) => (
              <Checkbox
                id="person-is-primary"
                checked={field.value}
                onCheckedChange={(checked) => field.onChange(checked === true)}
                disabled={isPending}
              />
            )}
          />
          <FieldLabel htmlFor="person-is-primary" className="font-normal">
            Es el contacto principal de esta unidad
          </FieldLabel>
        </Field>
        <FieldDescription>
          Si esta unidad ya tiene otro contacto principal, deja de serlo -- solo
          puede haber uno vigente por unidad.
        </FieldDescription>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Guardando…" : "Agregar vecino"}
        </Button>
      </FieldGroup>
    </form>
  );
}

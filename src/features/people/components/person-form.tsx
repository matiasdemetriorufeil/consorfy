"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { startTransition, useActionState, useEffect } from "react";
import { Controller, useForm } from "react-hook-form";

import { PhoneNumberInput } from "@/components/phone-number-input";
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
import { Textarea } from "@/components/ui/textarea";
import { AR_WHATSAPP_HELP } from "@/lib/phone";

import { updatePersonAction } from "../actions";
import type { BuildingOccupancyRow } from "../queries";
import {
  initialPersonFormState,
  updatePersonFormSchema,
  type UpdatePersonFormInput,
} from "../person-schema";

// Edición de los datos propios de un vecino (paso 4.4) -- nunca su
// asignación a una unidad, eso es un flujo separado (PersonOccupancyForm
// para alta, CloseOccupancyDialog para cierre). Mismo patrón que
// UnitForm/BuildingForm: zodResolver + useActionState, reacciona a cada
// resolución nueva de la Server Action.
export function PersonForm({
  person,
  onSuccess,
}: {
  person: BuildingOccupancyRow;
  onSuccess: () => void;
}) {
  const [state, dispatch, isPending] = useActionState(
    updatePersonAction,
    initialPersonFormState,
  );

  const {
    register,
    control,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<UpdatePersonFormInput>({
    resolver: zodResolver(updatePersonFormSchema),
    defaultValues: {
      id: person.personId,
      firstName: person.firstName,
      lastName: person.lastName ?? "",
      phoneE164: person.phoneE164 ?? "",
      email: person.email ?? "",
      notes: person.notes ?? "",
    },
  });

  useEffect(() => {
    if (state.ok) {
      onSuccess();
      return;
    }

    const entries = Object.entries(state.fieldErrors) as [
      keyof UpdatePersonFormInput,
      string,
    ][];
    let firstField: keyof UpdatePersonFormInput | null = null;
    for (const [field, message] of entries) {
      setError(field, { type: "server", message });
      firstField ??= field;
    }
    if (firstField) {
      setFocus(firstField);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  return (
    <form
      noValidate
      onSubmit={handleSubmit((data) => {
        startTransition(() => dispatch(data));
      })}
    >
      <FieldGroup>
        {state.formError && (
          <Alert variant="destructive">
            <AlertDescription>{state.formError}</AlertDescription>
          </Alert>
        )}

        <Field data-invalid={!!errors.firstName}>
          <FieldLabel htmlFor="edit-person-first-name">Nombre</FieldLabel>
          <Input
            id="edit-person-first-name"
            autoComplete="off"
            aria-invalid={!!errors.firstName}
            disabled={isPending}
            {...register("firstName")}
          />
          <FieldError errors={[errors.firstName]} />
        </Field>

        <Field data-invalid={!!errors.lastName}>
          <FieldLabel htmlFor="edit-person-last-name">Apellido</FieldLabel>
          <Input
            id="edit-person-last-name"
            autoComplete="off"
            placeholder="Opcional"
            aria-invalid={!!errors.lastName}
            disabled={isPending}
            {...register("lastName")}
          />
          <FieldError errors={[errors.lastName]} />
        </Field>

        <Field data-invalid={!!errors.phoneE164}>
          <FieldLabel htmlFor="edit-person-phone">Teléfono</FieldLabel>
          <Controller
            control={control}
            name="phoneE164"
            render={({ field }) => (
              <PhoneNumberInput
                id="edit-person-phone"
                name={field.name}
                ref={field.ref}
                value={field.value ?? ""}
                onChange={field.onChange}
                onBlur={field.onBlur}
                disabled={isPending}
                placeholder="93515551234"
                aria-invalid={!!errors.phoneE164}
              />
            )}
          />
          {!errors.phoneE164 && (
            <FieldDescription>{AR_WHATSAPP_HELP}</FieldDescription>
          )}
          <FieldError errors={[errors.phoneE164]} />
        </Field>

        <Field data-invalid={!!errors.email}>
          <FieldLabel htmlFor="edit-person-email">Email</FieldLabel>
          <Input
            id="edit-person-email"
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
          <FieldLabel htmlFor="edit-person-notes">Notas</FieldLabel>
          <Textarea
            id="edit-person-notes"
            placeholder="Opcional"
            aria-invalid={!!errors.notes}
            disabled={isPending}
            {...register("notes")}
          />
          <FieldError errors={[errors.notes]} />
        </Field>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending ? "Guardando…" : "Guardar cambios"}
        </Button>
      </FieldGroup>
    </form>
  );
}

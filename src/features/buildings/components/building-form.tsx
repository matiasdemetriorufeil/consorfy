"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import {
  startTransition,
  useActionState,
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
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

import {
  checkCodePrefixAvailableAction,
  createBuildingAction,
  updateBuildingAction,
} from "../actions";
import {
  AR_WHATSAPP_HELP,
  buildingFormSchema,
  initialBuildingFormState,
  slugify,
  suggestCodePrefix,
  type BuildingFormInput,
} from "../building-schema";
import type { BuildingEditableFields } from "../queries";

// Cuánto esperar después de la última tecla antes de preguntarle al
// servidor si el prefijo está libre (paso 4.1, punto 2): ni tan corto que
// dispare una consulta por cada letra, ni tan largo que se sienta
// desconectado de lo que la persona acaba de escribir.
const PREFIX_CHECK_DEBOUNCE_MS = 400;
const CODE_PREFIX_FORMAT_REGEX = /^[A-Z]{2,4}$/;

type PrefixCheckState =
  | { status: "idle" }
  | { status: "checking" }
  | { status: "available" }
  | { status: "taken"; usedBy: string };

export function BuildingForm({
  building,
  onSuccess,
}: {
  building?: BuildingEditableFields;
  onSuccess: () => void;
}) {
  const mode = building ? "edit" : "create";
  const action = mode === "edit" ? updateBuildingAction : createBuildingAction;
  const [state, dispatch, isPending] = useActionState(
    action,
    initialBuildingFormState,
  );

  const {
    register,
    control,
    handleSubmit,
    watch,
    setValue,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<BuildingFormInput>({
    resolver: zodResolver(buildingFormSchema),
    defaultValues: building
      ? {
          name: building.name,
          slug: building.slug,
          codePrefix: building.codePrefix,
          address: building.address,
          city: building.city,
          adminWhatsappE164: building.adminWhatsappE164,
          notes: building.notes ?? "",
        }
      : {
          name: "",
          slug: "",
          codePrefix: "",
          address: "",
          city: "",
          adminWhatsappE164: "",
          notes: "",
        },
  });

  // Slug y prefijo se autogeneran a partir del nombre SOLO hasta que la
  // persona los edita a mano (paso 4.1, punto 2) -- una vez tocados, dejan
  // de seguir al nombre, para no pisarle una corrección deliberada. Al
  // editar un edificio existente arrancan ya "tocados": no tiene sentido
  // regenerar el slug o el prefijo de un edificio que ya los tiene fijados
  // solo porque alguien corrigió el nombre.
  const slugTouched = useRef(mode === "edit");
  const codePrefixTouched = useRef(mode === "edit");

  const [prefixCheck, setPrefixCheck] = useState<PrefixCheckState>({
    status: "idle",
  });

  const codePrefixValue = watch("codePrefix");

  // Validación en vivo del prefijo (paso 4.1, punto 2), con debounce.
  useEffect(() => {
    const normalized = (codePrefixValue ?? "").trim().toUpperCase();
    if (!CODE_PREFIX_FORMAT_REGEX.test(normalized)) {
      setPrefixCheck({ status: "idle" });
      return;
    }

    setPrefixCheck({ status: "checking" });
    const timeout = setTimeout(() => {
      startTransition(async () => {
        const result = await checkCodePrefixAvailableAction(
          normalized,
          building?.id,
        );
        setPrefixCheck(
          result.available
            ? { status: "available" }
            : { status: "taken", usedBy: result.usedBy ?? "" },
        );
      });
    }, PREFIX_CHECK_DEBOUNCE_MS);

    return () => clearTimeout(timeout);
  }, [codePrefixValue, building?.id]);

  // Reacciona a cada resolución nueva de la Server Action -- éxito (cierra
  // el diálogo) o errores de campo (los vuelca en react-hook-form para que
  // salgan por el mismo FieldError que ya usan los errores de validación
  // del cliente, y enfoca el primero). Depende solo de `state` a propósito
  // -- ese objeto cambia de referencia en cada dispatch, así que esto
  // corre una vez por cada resolución nueva. onSuccess/setError/setFocus
  // no hacen falta en las deps: si cambiaran de referencia entre renders
  // no hay nada nuevo que procesar mientras `state` siga siendo el mismo
  // objeto que ya se procesó.
  useEffect(() => {
    if (state.ok) {
      onSuccess();
      return;
    }

    const entries = Object.entries(state.fieldErrors) as [
      keyof BuildingFormInput,
      string,
    ][];
    let firstField: keyof BuildingFormInput | null = null;
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
        if (prefixCheck.status === "taken") {
          setError("codePrefix", {
            type: "live",
            message: `Ese prefijo ya lo usa "${prefixCheck.usedBy}".`,
          });
          setFocus("codePrefix");
          return;
        }
        const payload = building ? { ...data, id: building.id } : data;
        startTransition(() => dispatch(payload));
      })}
    >
      <FieldGroup>
        {state.formError && (
          <Alert variant="destructive">
            <AlertDescription>{state.formError}</AlertDescription>
          </Alert>
        )}

        <Field data-invalid={!!errors.name}>
          <FieldLabel htmlFor="building-name">Nombre</FieldLabel>
          <Input
            id="building-name"
            autoComplete="off"
            aria-invalid={!!errors.name}
            disabled={isPending}
            {...register("name", {
              onChange: (event: ChangeEvent<HTMLInputElement>) => {
                const name = event.target.value;
                if (!slugTouched.current) {
                  setValue("slug", slugify(name), { shouldValidate: true });
                }
                if (!codePrefixTouched.current) {
                  setValue("codePrefix", suggestCodePrefix(name), {
                    shouldValidate: true,
                  });
                }
              },
            })}
          />
          <FieldError errors={[errors.name]} />
        </Field>

        <Field data-invalid={!!errors.slug}>
          <FieldLabel htmlFor="building-slug">Identificador</FieldLabel>
          <Input
            id="building-slug"
            autoComplete="off"
            aria-invalid={!!errors.slug}
            disabled={isPending}
            {...register("slug", {
              onChange: () => {
                slugTouched.current = true;
              },
            })}
          />
          <FieldDescription>
            Se genera solo a partir del nombre, pero podés cambiarlo.
          </FieldDescription>
          <FieldError errors={[errors.slug]} />
        </Field>

        <Field data-invalid={!!errors.codePrefix}>
          <FieldLabel htmlFor="building-code-prefix">
            Prefijo de código
          </FieldLabel>
          <Input
            id="building-code-prefix"
            autoComplete="off"
            className="uppercase"
            aria-invalid={!!errors.codePrefix}
            disabled={isPending}
            {...register("codePrefix", {
              onChange: () => {
                codePrefixTouched.current = true;
              },
            })}
          />
          {mode === "edit" && (
            <FieldDescription>
              Cambiarlo no afecta los códigos de reclamos ya emitidos con el
              prefijo anterior.
            </FieldDescription>
          )}
          {!errors.codePrefix && prefixCheck.status === "checking" && (
            <FieldDescription>Verificando disponibilidad…</FieldDescription>
          )}
          {!errors.codePrefix && prefixCheck.status === "available" && (
            <FieldDescription className="text-resuelto">
              Prefijo disponible.
            </FieldDescription>
          )}
          {!errors.codePrefix && prefixCheck.status === "taken" && (
            <FieldDescription className="text-destructive">
              Ese prefijo ya lo usa &quot;{prefixCheck.usedBy}&quot;.
            </FieldDescription>
          )}
          <FieldError errors={[errors.codePrefix]} />
        </Field>

        <Field data-invalid={!!errors.address}>
          <FieldLabel htmlFor="building-address">Dirección</FieldLabel>
          <Input
            id="building-address"
            autoComplete="off"
            aria-invalid={!!errors.address}
            disabled={isPending}
            {...register("address")}
          />
          <FieldError errors={[errors.address]} />
        </Field>

        <Field data-invalid={!!errors.city}>
          <FieldLabel htmlFor="building-city">Ciudad</FieldLabel>
          <Input
            id="building-city"
            autoComplete="off"
            aria-invalid={!!errors.city}
            disabled={isPending}
            {...register("city")}
          />
          <FieldError errors={[errors.city]} />
        </Field>

        <Field data-invalid={!!errors.adminWhatsappE164}>
          <FieldLabel htmlFor="building-admin-whatsapp">
            WhatsApp del administrador
          </FieldLabel>
          <Controller
            control={control}
            name="adminWhatsappE164"
            render={({ field }) => (
              <PhoneNumberInput
                id="building-admin-whatsapp"
                name={field.name}
                ref={field.ref}
                value={field.value}
                onChange={field.onChange}
                onBlur={field.onBlur}
                disabled={isPending}
                placeholder="93515551234"
                aria-invalid={!!errors.adminWhatsappE164}
              />
            )}
          />
          {/* La ayuda estática y el error de formato dicen lo mismo -- se
              esconde una cuando aparece la otra para no repetir el mismo
              texto dos veces en pantalla. */}
          {!errors.adminWhatsappE164 && (
            <FieldDescription>{AR_WHATSAPP_HELP}</FieldDescription>
          )}
          <FieldError errors={[errors.adminWhatsappE164]} />
        </Field>

        <Field data-invalid={!!errors.notes}>
          <FieldLabel htmlFor="building-notes">Notas</FieldLabel>
          <Textarea
            id="building-notes"
            aria-invalid={!!errors.notes}
            disabled={isPending}
            {...register("notes")}
          />
          <FieldError errors={[errors.notes]} />
        </Field>

        <Button type="submit" disabled={isPending} className="w-full">
          {isPending
            ? "Guardando…"
            : mode === "edit"
              ? "Guardar cambios"
              : "Crear edificio"}
        </Button>
      </FieldGroup>
    </form>
  );
}

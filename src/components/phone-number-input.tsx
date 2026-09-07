"use client";

import { forwardRef } from "react";

import { AR_PHONE_PREFIX, joinArPhone, splitArPhone } from "@/lib/phone";
import { cn } from "@/lib/utils";

// Campo de teléfono con el código de país "+54" como etiqueta FIJA: no se
// puede editar, borrar ni seleccionar como texto (es un <span> aparte, no
// parte del <input>). La persona escribe solo lo que va después -- el "9",
// el código de área y el número, sin el 0 ni el 15 (ver AR_WHATSAPP_HELP).
//
// Es un componente CONTROLADO (value/onChange sobre el valor E.164
// completo), pensado para envolverse en un <Controller> de react-hook-form
// -- misma convención que ya usan los otros campos compuestos del proyecto
// (categoría en TicketForm, unidad/rol en PersonOccupancyForm). No usa
// `register` porque necesita transformar entre "valor guardado" y "parte
// visible" en las dos direcciones (ver splitArPhone/joinArPhone en
// src/lib/phone.ts).
//
// `value` vacío  -> la parte editable se muestra vacía (solo el "+54").
// Parte editable vacía -> `onChange("")`, NUNCA `onChange("+54")`: en los
// formularios donde el teléfono es opcional, "sin escribir nada" tiene que
// seguir llegando como vacío al esquema (que lo vuelve null). En el
// formulario público, donde es obligatorio, un valor vacío lo rechaza la
// validación igual que antes.

type PhoneNumberInputProps = {
  id?: string;
  name?: string;
  /** Valor E.164 completo ("+5493511234567") o "" si no hay teléfono. */
  value: string;
  onChange: (next: string) => void;
  onBlur?: () => void;
  disabled?: boolean;
  /** Placeholder de la parte editable (sin el "+54"). */
  placeholder?: string;
  "aria-invalid"?: boolean;
  "aria-describedby"?: string;
};

export const PhoneNumberInput = forwardRef<
  HTMLInputElement,
  PhoneNumberInputProps
>(function PhoneNumberInput(
  {
    id,
    name,
    value,
    onChange,
    onBlur,
    disabled,
    placeholder,
    "aria-invalid": ariaInvalid,
    "aria-describedby": ariaDescribedby,
  },
  ref,
) {
  const { rest } = splitArPhone(value);

  return (
    // El wrapper es el que "parece" un input: mismas clases visuales que
    // src/components/ui/input.tsx (borde, foco, aria-invalid, disabled),
    // pero con `focus-within`/`has-[input:disabled]` en vez de las
    // pseudoclases directas, porque el foco real vive en el <input> de
    // adentro. `data-slot="input"` a propósito: así el selector de
    // touch-targets de TicketForm (`[&_[data-slot=input]]:min-h-11`) lo
    // agranda en el formulario público sin que este componente tenga que
    // saber nada de ese contexto.
    <div
      data-slot="input"
      aria-invalid={ariaInvalid}
      className={cn(
        "border-input focus-within:border-ring focus-within:ring-ring/50 has-[input:disabled]:bg-input/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:bg-input/30 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 flex h-8 w-full min-w-0 items-center gap-1 rounded-lg border bg-transparent px-2.5 py-1 text-base transition-colors focus-within:ring-3 has-[input:disabled]:pointer-events-none has-[input:disabled]:cursor-not-allowed has-[input:disabled]:opacity-50 aria-invalid:ring-3 md:text-sm",
      )}
    >
      <span
        aria-hidden="true"
        className="text-muted-foreground pointer-events-none shrink-0 select-none"
      >
        {AR_PHONE_PREFIX}
      </span>
      <input
        ref={ref}
        id={id}
        name={name}
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        disabled={disabled}
        placeholder={placeholder}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedby}
        value={rest}
        onChange={(event) => onChange(joinArPhone(event.target.value))}
        onBlur={onBlur}
        className="placeholder:text-muted-foreground w-full min-w-0 flex-1 bg-transparent p-0 outline-none disabled:cursor-not-allowed"
      />
    </div>
  );
});

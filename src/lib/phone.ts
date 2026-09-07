// Validación del WhatsApp argentino, compartida entre el teléfono del
// administrador de un edificio (buildings, paso 4.1) y el teléfono de un
// vecino (people, paso 4.4) -- extraída acá en cuanto apareció el segundo
// consumidor, mismo criterio que BuildingEditableFields en el paso 4.2
// (extraer recién cuando hay una segunda necesidad real, no antes). Antes
// vivía solo en building-schema.ts; people/person-schema.ts la reutiliza tal
// cual en vez de escribir una segunda validación distinta para el mismo
// formato.
//
// Argentina, no E.164 genérico: la base acepta cualquier E.164 válido (ver
// los CHECK de buildings.ts y people.ts, más permisivos), pero el WhatsApp
// de un administrador o un vecino en esta app siempre es un celular
// argentino -- +54 9, código de área, número, sin espacios. Validarlo acá
// más estricto que la base es a propósito: un E.164 de otro país pasaría el
// CHECK de la base pero el link wa.me que se arma con este número (ver
// CLAUDE.md > Reglas de WhatsApp) dejaría de tener sentido para el flujo
// real de la app.
export const AR_WHATSAPP_E164_REGEX = /^\+549\d{10}$/;
export const AR_WHATSAPP_HELP =
  "Escribilo con código de país y de área, sin el 0 ni el 15, por ejemplo +5493515551234 para un celular de Córdoba (351) 555-1234.";

// Código de país que TODOS los teléfonos de la app comparten (celular
// argentino, ver AR_WHATSAPP_E164_REGEX). PhoneNumberInput
// (src/components/phone-number-input.tsx) lo muestra como etiqueta fija no
// editable y deja que la persona tipee solo lo que va después. Estas dos
// funciones son el puente entre "valor E.164 completo" (lo que se guarda y
// valida) y "parte editable" (lo que se ve en el input).
export const AR_PHONE_PREFIX = "+54";

// Valor guardado -> parte editable (sin el prefijo). Si el valor no
// arranca con AR_PHONE_PREFIX -- no debería pasar para un dato ya validado
// con AR_WHATSAPP_E164_REGEX, pero un import viejo, un seed o una edición
// fuera de la UI podrían -- se devuelve entero como `rest`, sin recortar
// nada, para no perder ni corromper el dato en silencio; `hadPrefix` deja
// que el caller detecte ese caso.
export function splitArPhone(value: string): {
  rest: string;
  hadPrefix: boolean;
} {
  if (value.startsWith(AR_PHONE_PREFIX)) {
    return { rest: value.slice(AR_PHONE_PREFIX.length), hadPrefix: true };
  }
  return { rest: value, hadPrefix: false };
}

// Parte editable -> valor E.164 completo. Editable vacío (o solo espacios)
// -> string vacío, NUNCA "+54" solo: en los formularios donde el teléfono
// es opcional, "no escribió nada" tiene que seguir significando "sin
// teléfono" y llegar como vacío al esquema (que lo transforma a null). El
// contenido tipeado se pasa tal cual: la normalización de espacios/guiones
// ya la hace normalizePhoneInput en el esquema.
export function joinArPhone(rest: string): string {
  return rest.trim() === "" ? "" : `${AR_PHONE_PREFIX}${rest}`;
}

// Espacios, guiones, puntos y paréntesis son ruido habitual al tipear un
// teléfono a mano ("351 555-1234", "(351) 555.1234") -- se descartan antes
// de validar el formato, para no rebotar por puntuación en vez de por el
// número en sí.
export function normalizePhoneInput(value: string): string {
  return value.replace(/[\s().-]/g, "");
}

// Paso 8.7 -- distingue los dos motivos por los que un teléfono no sirve
// para un comunicado: nunca se cargó (`null`) vs. se cargó pero no matchea
// el formato argentino exigido acá arriba. Antes de este paso, todo el
// flujo de comunicados (queries.ts, actions.ts) trataba los dos casos
// igual con un simple `!!phoneE164` -- un valor cargado por una vía que no
// pasa por `personFieldsSchema.refine()` (import CSV, un seed, una edición
// futura fuera de la UI) contaba como "con teléfono" sin que nadie lo
// validara, así que un comunicado podía intentar armar un link de
// WhatsApp con un número que nunca iba a funcionar. Prueba contra el
// valor CRUDO tal como está guardado, sin normalizar primero -- si hiciera
// falta normalizar para que matchee, ya cuenta como "mal formateado" desde
// la perspectiva de esta app (mismo criterio que exige el formulario de
// alta/edición al guardar).
export type PhoneIssue = "missing" | "invalid_format";

export function getPhoneIssue(phone: string | null): PhoneIssue | null {
  if (!phone) {
    return "missing";
  }
  return AR_WHATSAPP_E164_REGEX.test(phone) ? null : "invalid_format";
}

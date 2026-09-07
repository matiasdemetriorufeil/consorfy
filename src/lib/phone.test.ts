import { describe, expect, it } from "vitest";

import { getPhoneIssue, joinArPhone, splitArPhone } from "./phone";

// Paso 8.7 -- primer test de este archivo. getPhoneIssue distingue los
// dos motivos por los que un teléfono no sirve para un comunicado
// (faltante vs. formato inválido), reemplazando el `!!phoneE164` que
// trataba los dos casos igual en todo el flujo de comunicados.
describe("getPhoneIssue", () => {
  it("devuelve 'missing' para null", () => {
    expect(getPhoneIssue(null)).toBe("missing");
  });

  it("devuelve null (válido) para un E.164 argentino real", () => {
    expect(getPhoneIssue("+5493511234567")).toBeNull();
  });

  it("devuelve 'invalid_format' para un teléfono sin el prefijo +549", () => {
    expect(getPhoneIssue("+5411234567")).toBe("invalid_format");
    expect(getPhoneIssue("3511234567")).toBe("invalid_format");
  });

  it("devuelve 'invalid_format' para un teléfono demasiado corto", () => {
    expect(getPhoneIssue("+54123456")).toBe("invalid_format");
  });

  it("devuelve 'invalid_format' para un teléfono con espacios o guiones sin normalizar", () => {
    // getPhoneIssue prueba el valor CRUDO tal como está guardado -- no
    // normaliza primero (ver el comentario de la función): si necesita
    // normalizarse para matchear, ya cuenta como mal formateado desde la
    // perspectiva de esta app.
    expect(getPhoneIssue("+549 351 123-4567")).toBe("invalid_format");
  });

  it("devuelve 'missing' para un string vacío", () => {
    expect(getPhoneIssue("")).toBe("missing");
  });
});

// El puente entre "valor E.164 completo" (lo que se guarda/valida) y la
// "parte editable" que muestra PhoneNumberInput
// (src/components/phone-number-input.tsx), con el "+54" como etiqueta fija.
describe("splitArPhone", () => {
  it("saca el prefijo +54 de un teléfono argentino real", () => {
    expect(splitArPhone("+5493511234567")).toEqual({
      rest: "93511234567",
      hadPrefix: true,
    });
  });

  it("un valor vacío queda como parte editable vacía", () => {
    expect(splitArPhone("")).toEqual({ rest: "", hadPrefix: false });
  });

  it("'+54' solo queda como parte editable vacía (hadPrefix true)", () => {
    expect(splitArPhone("+54")).toEqual({ rest: "", hadPrefix: true });
  });

  it("un valor que NO arranca con +54 se devuelve entero, sin recortar", () => {
    // Caso defensivo: un dato viejo/mal cargado no se pierde ni se corta a
    // ciegas -- se muestra completo en la parte editable y la validación
    // del formulario lo rechaza como cualquier formato inválido.
    expect(splitArPhone("3511234567")).toEqual({
      rest: "3511234567",
      hadPrefix: false,
    });
  });
});

describe("joinArPhone", () => {
  it("antepone +54 a lo que se tipeó", () => {
    expect(joinArPhone("93511234567")).toBe("+5493511234567");
  });

  it("parte editable vacía -> string vacío, NUNCA '+54' solo", () => {
    expect(joinArPhone("")).toBe("");
    expect(joinArPhone("   ")).toBe("");
  });

  it("round-trip: split y join devuelven el valor original", () => {
    const original = "+5493511234567";
    expect(joinArPhone(splitArPhone(original).rest)).toBe(original);
  });

  it("round-trip: '+54' solo y '' colapsan los dos a ''", () => {
    expect(joinArPhone(splitArPhone("+54").rest)).toBe("");
    expect(joinArPhone(splitArPhone("").rest)).toBe("");
  });
});

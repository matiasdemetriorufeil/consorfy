import { cn } from "@/lib/utils";

import type { ReminderColorValue } from "../reminder-schema";

// Relleno sólido de cada color de la paleta de EVENTOS (paso 1). Clases
// literales para que el scanner de Tailwind v4 las genere (mismo motivo que
// PRIORITY_CLASS y compañía). Los hex viven en globals.css (`--evento-*`),
// un conjunto aparte del semáforo de urgencia (`--urgencia-*`).
//
// Vive acá (y no en cada componente) desde que apareció el segundo
// consumidor: el selector del formulario (paso 1) y los puntos por evento
// del calendario grande (paso 2). Mismo criterio de extracción que
// format-due-date.ts.
export const REMINDER_COLOR_BG: Record<ReminderColorValue, string> = {
  pizarra: "bg-evento-pizarra",
  rojo: "bg-evento-rojo",
  naranja: "bg-evento-naranja",
  ambar: "bg-evento-ambar",
  verde: "bg-evento-verde",
  azul: "bg-evento-azul",
  violeta: "bg-evento-violeta",
  rosa: "bg-evento-rosa",
};

// Punto sólido del color de un evento -- para la celda del calendario y el
// título en el panel de detalle del día. Decorativo, `aria-hidden`: el
// color no comunica nada por sí solo (el título/edificio ya identifican al
// evento).
export function ReminderColorDot({
  color,
  className,
}: {
  color: ReminderColorValue;
  className?: string;
}) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "size-2 shrink-0 rounded-full",
        REMINDER_COLOR_BG[color],
        className,
      )}
    />
  );
}

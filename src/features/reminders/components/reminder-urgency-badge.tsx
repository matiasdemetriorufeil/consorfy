import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

import type { ReminderUrgency } from "../reminder-urgency";

// Mismo criterio que ReminderStatusBadge/StatusBadge (paso 9.1/6.1) -- un
// mapa de label y un mapa de color por nivel. Ver CLAUDE.md > Semáforo de
// vencimientos para los umbrales que definen cada nivel.
//
// El semáforo vive SOLO acá (lista + "Próximos vencimientos"); el calendario
// ya no muestra urgencia. Los colores salen de los tokens `--urgencia-*`
// (globals.css), un set aislado: "por vencer" en AMARILLO
// (`--urgencia-amarillo`, token nuevo -- antes era el naranja `--alta`, que
// comparten prioridad de reclamos y estados de comunicados y no se toca),
// "al día" en VERDE, "vencido" en ROJO (el más grave, se mantiene distinto).
export const URGENCY_LABEL: Record<ReminderUrgency, string> = {
  overdue: "Vencido",
  upcoming: "Próximo",
  ok: "Tranquilo",
};

const URGENCY_CLASS: Record<ReminderUrgency, string> = {
  overdue: "bg-urgencia-rojo/10 text-urgencia-rojo",
  upcoming: "bg-urgencia-amarillo/10 text-urgencia-amarillo",
  ok: "bg-urgencia-verde/10 text-urgencia-verde",
};

export function ReminderUrgencyBadge({
  urgency,
  className,
}: {
  urgency: ReminderUrgency;
  className?: string;
}) {
  return (
    <Badge
      variant="outline"
      className={cn(
        "font-body border-transparent",
        URGENCY_CLASS[urgency],
        className,
      )}
    >
      {URGENCY_LABEL[urgency]}
    </Badge>
  );
}

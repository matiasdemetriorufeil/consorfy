import { CalendarClock } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

// Placeholder a propósito (paso 4.2, punto 3) -- mismo criterio que
// documents/page.tsx: la gestión de recordatorios es una etapa futura del
// plan (la 9, según el esquema de `reminders`), sin Server Actions ni UI
// de gestión todavía. Ninguna consulta acá.
export default function BuildingRemindersPage() {
  return (
    <EmptyState
      icon={CalendarClock}
      title="Los eventos todavía no están disponibles"
      description="Vas a poder programar avisos de vencimientos (como fumigaciones o mantenimiento) acá más adelante."
    />
  );
}

import { CircleCheck } from "lucide-react";

import { EmptyState } from "@/components/empty-state";

import { formatDueDate } from "../format-due-date";
import type { ReminderListRow } from "../queries";
import {
  describeReminderDueDate,
  getReminderUrgency,
} from "../reminder-urgency";
import { ReminderUrgencyBadge } from "./reminder-urgency-badge";

// Vista de "próximos vencimientos" (paso 9.2, punto 2) -- de SOLO LECTURA a
// propósito, sin diálogos de edición/baja: es una vista de orientación
// ("¿qué necesita atención pronto?"), la gestión completa (crear, editar,
// dar de baja) sigue viviendo en la pestaña "Lista" (paso 9.1), que ya la
// resuelve -- duplicar esos diálogos acá no agrega nada, solo estado de
// cliente de más. Server Component puro, sin `"use client"`.
//
// Recibe SOLO recordatorios activos (`REMINDER_ACTIVE_STATUSES`, filtrados
// por page.tsx antes de pasarlos) -- "próximos vencimientos" no tiene
// sentido para uno ya "Hecho"/"Descartado". Ya vienen ordenados por
// `due_date` ascendente (mismo `ORDER BY` de getReminderList) -- "más
// cerca de vencer" primero, tanto para uno vencido (más días de atraso
// primero) como para uno futuro (más próximo primero), sin ninguna lógica
// de orden aparte.
export function UpcomingRemindersList({
  reminders,
  today,
  showBuildingColumn,
}: {
  reminders: ReminderListRow[];
  today: string;
  showBuildingColumn: boolean;
}) {
  if (reminders.length === 0) {
    return (
      <EmptyState
        icon={CircleCheck}
        title="No hay vencimientos próximos"
        description="Todos los eventos activos están tranquilos por ahora -- acá vas a ver los que se acercan a su fecha límite."
      />
    );
  }

  return (
    <ul className="border-border divide-border divide-y rounded-lg border">
      {reminders.map((reminder) => {
        const urgency = getReminderUrgency(
          reminder.dueDate,
          reminder.noticeDays,
          today,
        );
        return (
          <li
            key={reminder.id}
            className="flex flex-col gap-2 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4"
          >
            <div className="flex min-w-0 flex-col gap-1">
              <p className="text-ink font-medium">{reminder.title}</p>
              {showBuildingColumn && (
                <p className="text-ink-muted text-sm">
                  {reminder.buildingName ?? "General"}
                </p>
              )}
            </div>
            <div className="flex shrink-0 flex-col items-start gap-1 sm:items-end">
              <ReminderUrgencyBadge urgency={urgency} />
              <p className="text-ink-muted text-sm">
                {describeReminderDueDate(reminder.dueDate, today)} ·{" "}
                {formatDueDate(reminder.dueDate)}
              </p>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

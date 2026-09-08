"use client";

import { es } from "date-fns/locale";
import { useMemo, useState } from "react";

import { Calendar } from "@/components/ui/calendar";

import { formatDueDate } from "../format-due-date";
import type { ReminderListRow } from "../queries";
import { getReminderUrgency, type ReminderUrgency } from "../reminder-urgency";
import { ReminderStatusBadge } from "./reminder-status-badge";
import {
  ReminderUrgencyBadge,
  ReminderUrgencyDot,
  URGENCY_LABEL,
} from "./reminder-urgency-badge";

// "YYYY-MM-DD" -> Date LOCAL (constructor de 3 argumentos, sin UTC) --
// a propósito, DISTINTO del resto del feature (`daysBetween`/`formatDueDate`
// usan UTC para evitar corrimientos en aritmética de días). Acá el
// consumidor es react-day-picker, que compara/renderiza sus propias celdas
// por año/mes/día en la zona LOCAL del navegador -- un Date construido con
// `Date.UTC` marcaría un día distinto en cualquier navegador con offset
// negativo (todo el uso horario de Argentina, por ejemplo). Es la única
// función de este archivo que necesita esto; el resto del feature nunca
// construye un `Date` a partir de `due_date`.
function dateKeyToLocalDate(dateKey: string): Date {
  const [year, month, day] = dateKey.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  return new Date(year, month - 1, day);
}

function localDateToDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// Orden de severidad para quedarse con la PEOR urgencia del día, cuando hay
// más de un recordatorio en la misma fecha.
const URGENCY_SEVERITY: Record<ReminderUrgency, number> = {
  overdue: 2,
  upcoming: 1,
  ok: 0,
};

// Vista de calendario mensual (paso 9.2, punto 1). Client Component --
// necesita estado (mes visible, día elegido) que no puede vivir en un
// Server Component. Recibe TODOS los recordatorios del alcance ya
// resueltos por page.tsx (cualquier estado, no solo los activos -- ver
// CLAUDE.md > Vistas de calendario y próximos vencimientos sobre por qué
// acá sí se muestran done/dismissed, a diferencia de "Próximos
// vencimientos") y arma la grilla/agrupación en memoria: mismo criterio de
// "tabla chica, sin round-trip por mes" ya documentado para
// getReminderList (paso 9.1) -- un mes nuevo no pide nada al servidor, solo
// cambia qué parte de los datos ya cargados se muestra.
export function ReminderCalendar({
  reminders,
  today,
  showBuildingColumn,
}: {
  reminders: ReminderListRow[];
  today: string;
  showBuildingColumn: boolean;
}) {
  const todayDate = useMemo(() => dateKeyToLocalDate(today), [today]);
  const [month, setMonth] = useState(todayDate);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(todayDate);

  const remindersByDay = useMemo(() => {
    const map = new Map<string, ReminderListRow[]>();
    for (const reminder of reminders) {
      const list = map.get(reminder.dueDate) ?? [];
      list.push(reminder);
      map.set(reminder.dueDate, list);
    }
    return map;
  }, [reminders]);

  // Peor urgencia por día, y las tres listas de fechas que necesita el
  // prop `modifiers` de DayPicker (un array de Date por modificador, ver
  // el comentario de la celda del día más abajo).
  const { overdueDates, upcomingDates, okDates } = useMemo(() => {
    const overdue: Date[] = [];
    const upcoming: Date[] = [];
    const ok: Date[] = [];
    for (const [dayKey, dayReminders] of remindersByDay) {
      let worst: ReminderUrgency = "ok";
      for (const reminder of dayReminders) {
        const urgency = getReminderUrgency(dayKey, reminder.noticeDays, today);
        if (URGENCY_SEVERITY[urgency] > URGENCY_SEVERITY[worst]) {
          worst = urgency;
        }
      }
      const date = dateKeyToLocalDate(dayKey);
      (worst === "overdue"
        ? overdue
        : worst === "upcoming"
          ? upcoming
          : ok
      ).push(date);
    }
    return { overdueDates: overdue, upcomingDates: upcoming, okDates: ok };
  }, [remindersByDay, today]);

  const selectedDayKey = selectedDate ? localDateToDateKey(selectedDate) : null;
  const selectedDayReminders = selectedDayKey
    ? (remindersByDay.get(selectedDayKey) ?? [])
    : [];

  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="flex flex-col gap-3">
        <Calendar
          mode="single"
          month={month}
          onMonthChange={setMonth}
          selected={selectedDate}
          onSelect={setSelectedDate}
          today={todayDate}
          locale={es}
          modifiers={{
            reminderOverdue: overdueDates,
            reminderUpcoming: upcomingDates,
            reminderOk: okDates,
          }}
          modifiersClassNames={{
            reminderOverdue:
              "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-urgente",
            reminderUpcoming:
              "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-alta",
            reminderOk:
              "after:absolute after:bottom-1 after:left-1/2 after:size-1.5 after:-translate-x-1/2 after:rounded-full after:bg-resuelto",
          }}
          className="border-border rounded-lg border"
        />
        <ul className="text-ink-muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
          <li className="flex items-center gap-1.5">
            <ReminderUrgencyDot urgency="overdue" /> {URGENCY_LABEL.overdue}
          </li>
          <li className="flex items-center gap-1.5">
            <ReminderUrgencyDot urgency="upcoming" /> {URGENCY_LABEL.upcoming}
          </li>
          <li className="flex items-center gap-1.5">
            <ReminderUrgencyDot urgency="ok" /> {URGENCY_LABEL.ok}
          </li>
        </ul>
      </div>

      <div className="border-border min-w-0 flex-1 rounded-lg border p-4">
        {selectedDayKey ? (
          <>
            <h3 className="text-ink mb-3 font-medium">
              {formatDueDate(selectedDayKey)}
            </h3>
            {selectedDayReminders.length === 0 ? (
              <p className="text-ink-muted text-sm">Sin eventos este día.</p>
            ) : (
              <ul className="flex flex-col gap-3">
                {selectedDayReminders.map((reminder) => (
                  <li
                    key={reminder.id}
                    className="border-border flex flex-col gap-1 border-b pb-3 last:border-0 last:pb-0"
                  >
                    <p className="text-ink font-medium">{reminder.title}</p>
                    <div className="flex flex-wrap items-center gap-2">
                      {showBuildingColumn && (
                        <span className="text-ink-muted text-sm">
                          {reminder.buildingName}
                        </span>
                      )}
                      <ReminderStatusBadge status={reminder.status} />
                      <ReminderUrgencyBadge
                        urgency={getReminderUrgency(
                          reminder.dueDate,
                          reminder.noticeDays,
                          today,
                        )}
                      />
                    </div>
                    {reminder.description && (
                      <p className="text-ink-muted text-sm">
                        {reminder.description}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : (
          <p className="text-ink-muted text-sm">
            Tocá un día del calendario para ver sus eventos.
          </p>
        )}
      </div>
    </div>
  );
}

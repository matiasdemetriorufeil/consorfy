"use client";

import { es } from "date-fns/locale";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import { type DayButton } from "react-day-picker";

import { Calendar } from "@/components/ui/calendar";
import type { ActiveBuildingOption } from "@/features/buildings/queries";
import { cn } from "@/lib/utils";

import { formatDueDate } from "../format-due-date";
import type { ReminderListRow } from "../queries";
import { ReminderColorDot } from "./reminder-color";
import { ReminderFormDialog } from "./reminder-form-dialog";
import { ReminderStatusBadge } from "./reminder-status-badge";

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

// Cuántos puntos de color entran cómodos en una celda del calendario grande
// antes de resumir el resto como "+N". No hay un precedente exacto de
// "indicador de desborde" compacto en el proyecto (lo más cercano es el
// "N más" en texto de announcement-segment-form): se elige "+N" por ser lo
// más corto para una celda de calendario.
const MAX_DOTS_PER_DAY = 4;

// Celda de día del calendario. Reemplaza al DayButton por defecto de
// components/ui/calendar.tsx para meterle, además del número, un punto por
// cada evento de ese día con su `reminders.color`. YA NO muestra urgencia
// (vencido/próximo/al día): ese semáforo vive solo en la lista y en
// "Próximos vencimientos".
function CalendarDay({
  className,
  day,
  modifiers,
  remindersByDay,
  children,
  ...props
}: ComponentProps<typeof DayButton> & {
  remindersByDay: Map<string, ReminderListRow[]>;
}) {
  const ref = useRef<HTMLButtonElement>(null);
  // Mismo manejo de foco que el DayButton por defecto -- necesario para que
  // la navegación con flechas del teclado siga moviendo el foco de celda.
  useEffect(() => {
    if (modifiers.focused) ref.current?.focus();
  }, [modifiers.focused]);

  const dayReminders = remindersByDay.get(localDateToDateKey(day.date)) ?? [];
  const visible = dayReminders.slice(0, MAX_DOTS_PER_DAY);
  const overflow = dayReminders.length - visible.length;
  const selectedSingle =
    modifiers.selected &&
    !modifiers.range_start &&
    !modifiers.range_end &&
    !modifiers.range_middle;

  return (
    <button
      ref={ref}
      type="button"
      data-selected-single={selectedSingle || undefined}
      className={cn(
        "relative flex h-full w-full flex-col items-center justify-start gap-1 rounded-(--cell-radius) p-1 text-sm leading-none outline-none",
        "hover:bg-accent focus-visible:ring-ring focus-visible:z-10 focus-visible:ring-2",
        "data-[selected-single=true]:bg-primary data-[selected-single=true]:text-primary-foreground",
        className,
      )}
      {...props}
    >
      <span className={cn("tabular-nums", modifiers.today && "font-semibold")}>
        {children}
      </span>
      {dayReminders.length > 0 && (
        <span className="flex max-w-full flex-wrap items-center justify-center gap-0.5">
          {visible.map((reminder) => (
            <ReminderColorDot key={reminder.id} color={reminder.color} />
          ))}
          {overflow > 0 && (
            <span className="text-ink-muted text-[0.625rem] leading-none">
              +{overflow}
            </span>
          )}
        </span>
      )}
    </button>
  );
}

// Vista de calendario mensual (paso 9.2, punto 1; agrandada y con color por
// evento en el paso 2). Client Component -- necesita estado (mes visible,
// día elegido, diálogo de edición abierto) que no puede vivir en un Server
// Component. Recibe TODOS los recordatorios del alcance ya resueltos por
// page.tsx (cualquier estado, no solo los activos -- ver CLAUDE.md > Vistas
// de calendario y próximos vencimientos) y arma la agrupación en memoria:
// un mes nuevo no pide nada al servidor, solo cambia qué parte de los datos
// ya cargados se muestra.
//
// Layout (paso 2): el calendario ocupa TODO el ancho arriba y el panel de
// detalle del día queda abajo (antes era lado a lado con un calendario
// chico) -- así cada celda tiene lugar para varios puntos de color.
export function ReminderCalendar({
  reminders,
  today,
  showBuildingColumn,
  buildingOptions,
  lockedBuildingId,
}: {
  reminders: ReminderListRow[];
  today: string;
  showBuildingColumn: boolean;
  buildingOptions: ActiveBuildingOption[];
  lockedBuildingId: string | null;
}) {
  const todayDate = useMemo(() => dateKeyToLocalDate(today), [today]);
  const [month, setMonth] = useState(todayDate);
  const [selectedDate, setSelectedDate] = useState<Date | undefined>(todayDate);
  // Evento cuyo diálogo de edición está abierto -- mismo mecanismo exacto
  // que RemindersList (estado que guarda la fila, `open` derivado,
  // `onOpenChange` que lo limpia). Guardar un cambio revalida
  // `/panel/reminders` (revalidateReminderPaths en actions.ts) y el
  // calendario se repinta con los datos nuevos sin recargar.
  const [editReminder, setEditReminder] = useState<ReminderListRow | undefined>(
    undefined,
  );

  const remindersByDay = useMemo(() => {
    const map = new Map<string, ReminderListRow[]>();
    for (const reminder of reminders) {
      const list = map.get(reminder.dueDate) ?? [];
      list.push(reminder);
      map.set(reminder.dueDate, list);
    }
    return map;
  }, [reminders]);

  // `components` estable mientras no cambien los datos -- si su identidad
  // cambiara en cada render, react-day-picker remontaría todas las celdas
  // (y se perdería el foco) al navegar de mes o elegir un día.
  const dayComponents = useMemo(
    () => ({
      DayButton: (props: ComponentProps<typeof DayButton>) => (
        <CalendarDay {...props} remindersByDay={remindersByDay} />
      ),
    }),
    [remindersByDay],
  );

  const selectedDayKey = selectedDate ? localDateToDateKey(selectedDate) : null;
  const selectedDayReminders = selectedDayKey
    ? (remindersByDay.get(selectedDayKey) ?? [])
    : [];

  return (
    <div className="flex flex-col gap-6">
      <Calendar
        mode="single"
        month={month}
        onMonthChange={setMonth}
        selected={selectedDate}
        onSelect={setSelectedDate}
        today={todayDate}
        locale={es}
        components={dayComponents}
        className="border-border rounded-lg border p-3 [--cell-size:--spacing(10)]"
        classNames={{
          root: "w-full",
          day: "relative h-full w-full min-h-14 rounded-(--cell-radius) p-0 text-center select-none sm:min-h-20 lg:min-h-24",
        }}
      />

      <div className="border-border rounded-lg border p-4">
        {selectedDayKey ? (
          <>
            <h3 className="text-ink mb-3 font-medium">
              {formatDueDate(selectedDayKey)}
            </h3>
            {selectedDayReminders.length === 0 ? (
              <p className="text-ink-muted text-sm">Sin eventos este día.</p>
            ) : (
              <ul className="flex flex-col gap-2">
                {selectedDayReminders.map((reminder) => (
                  <li key={reminder.id}>
                    <button
                      type="button"
                      onClick={() => setEditReminder(reminder)}
                      className="border-border hover:bg-accent focus-visible:ring-ring flex w-full flex-col gap-1 rounded-lg border p-3 text-left outline-none focus-visible:ring-2"
                    >
                      <div className="flex items-center gap-2">
                        <ReminderColorDot color={reminder.color} />
                        <span className="text-ink font-medium">
                          {reminder.title}
                        </span>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {showBuildingColumn && (
                          <span className="text-ink-muted text-sm">
                            {reminder.buildingName}
                          </span>
                        )}
                        <ReminderStatusBadge status={reminder.status} />
                      </div>
                      {reminder.description && (
                        <p className="text-ink-muted text-sm">
                          {reminder.description}
                        </p>
                      )}
                    </button>
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

      <ReminderFormDialog
        open={editReminder !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setEditReminder(undefined);
          }
        }}
        buildingOptions={buildingOptions}
        lockedBuildingId={lockedBuildingId}
        reminder={editReminder}
      />
    </div>
  );
}

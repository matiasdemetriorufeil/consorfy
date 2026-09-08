"use client";

import { CalendarClock, MoreHorizontal, SearchX } from "lucide-react";
import { useState } from "react";

import { EmptyState } from "@/components/empty-state";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ActiveBuildingOption } from "@/features/buildings/queries";

import { formatDueDate } from "../format-due-date";
import type { ReminderListRow } from "../queries";
import { buildReminderListHref } from "../reminder-list-schema";
import { getReminderUrgency } from "../reminder-urgency";
import { DeleteReminderDialog } from "./delete-reminder-dialog";
import { ReminderFormDialog } from "./reminder-form-dialog";
import { ReminderStatusBadge } from "./reminder-status-badge";
import { ReminderUrgencyBadge } from "./reminder-urgency-badge";

type DialogState =
  | { type: "closed" }
  | { type: "create" }
  | { type: "edit"; reminder: ReminderListRow }
  | { type: "delete"; reminder: ReminderListRow };

// Texto de la columna "Anticipación": todos los umbrales del recordatorio,
// ya ordenados de mayor a menor por getReminderList. "7, 3 y 0 días antes"
// -- coma entre todos menos el último, "y" antes del último. Con un solo
// umbral se lee igual que cuando el campo era único ("7 días antes", y
// "1 día antes" en singular).
function formatNoticeThresholds(days: number[]): string {
  if (days.length === 1) {
    return days[0] === 1 ? "1 día antes" : `${days[0]} días antes`;
  }
  const allButLast = days.slice(0, -1).join(", ");
  const last = days[days.length - 1];
  return `${allButLast} y ${last} días antes`;
}

// Listado de recordatorios (paso 9.1) -- mismo patrón que UnitsList (paso
// 4.3): Client Component solo para manejar el estado de los diálogos, sin
// paginación (ver el comentario de getReminderList) ni búsqueda de texto
// (no pedida en este paso).
export function RemindersList({
  reminders,
  totalCount,
  buildingOptions,
  lockedBuildingId,
  showBuildingColumn,
  today,
}: {
  reminders: ReminderListRow[];
  totalCount: number;
  buildingOptions: ActiveBuildingOption[];
  lockedBuildingId: string | null;
  showBuildingColumn: boolean;
  // Fecha civil de HOY en la zona de la organización (page.tsx) -- para el
  // semáforo de urgencia, que a partir del paso 2 vive SOLO en esta lista y
  // en "Próximos vencimientos" (ya no en el calendario).
  today: string;
}) {
  const [dialog, setDialog] = useState<DialogState>({ type: "closed" });

  const editDialogReminder =
    dialog.type === "edit" ? dialog.reminder : undefined;
  const isFormDialogOpen = dialog.type === "create" || dialog.type === "edit";

  const newReminderButton = (
    <Button onClick={() => setDialog({ type: "create" })}>Nuevo evento</Button>
  );

  // Dos vacíos distintos, mismo criterio que la bandeja de reclamos
  // (CLAUDE.md > Bandeja de reclamos con filtros): "este alcance no tiene
  // NINGÚN recordatorio todavía" (invitación a cargar el primero) vs. "hay
  // recordatorios, pero ninguno con este filtro" (invitación a limpiarlo) --
  // dos mensajes que no deberían confundirse entre sí.
  if (totalCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        <EmptyState
          icon={CalendarClock}
          title="Todavía no hay eventos cargados"
          description="Cargá el primero -- una fumigación, un service, un vencimiento -- con su fecha límite, para que no se te pase."
          action={{
            label: "Cargar el primer evento",
            onClick: () => setDialog({ type: "create" }),
          }}
        />
        <ReminderFormDialog
          open={isFormDialogOpen}
          onOpenChange={(open) => {
            if (!open) {
              setDialog({ type: "closed" });
            }
          }}
          buildingOptions={buildingOptions}
          lockedBuildingId={lockedBuildingId}
        />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex justify-end">{newReminderButton}</div>

      {reminders.length === 0 ? (
        <EmptyState
          icon={SearchX}
          title="No encontramos eventos con este filtro"
          description="Probá con otro estado, o mostrá todos los eventos de nuevo."
          action={{ label: "Ver todos", href: buildReminderListHref("all") }}
        />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Título</TableHead>
              {showBuildingColumn && <TableHead>Edificio</TableHead>}
              <TableHead>Vencimiento</TableHead>
              <TableHead>Urgencia</TableHead>
              <TableHead>Anticipación</TableHead>
              <TableHead>Estado</TableHead>
              <TableHead className="w-10">
                <span className="sr-only">Acciones</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {reminders.map((reminder) => (
              <TableRow key={reminder.id}>
                <TableCell className="max-w-64 truncate font-medium">
                  {reminder.title}
                </TableCell>
                {showBuildingColumn && (
                  <TableCell>{reminder.buildingName}</TableCell>
                )}
                <TableCell>{formatDueDate(reminder.dueDate)}</TableCell>
                <TableCell>
                  <ReminderUrgencyBadge
                    urgency={getReminderUrgency(
                      reminder.dueDate,
                      reminder.noticeDays,
                      today,
                    )}
                  />
                </TableCell>
                <TableCell>
                  {formatNoticeThresholds(reminder.noticeDaysThresholds)}
                </TableCell>
                <TableCell>
                  <ReminderStatusBadge status={reminder.status} />
                </TableCell>
                <TableCell>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Acciones para ${reminder.title}`}
                      >
                        <MoreHorizontal />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem
                        onSelect={() => setDialog({ type: "edit", reminder })}
                      >
                        Editar
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        variant="destructive"
                        onSelect={() => setDialog({ type: "delete", reminder })}
                      >
                        Dar de baja
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}

      <ReminderFormDialog
        open={isFormDialogOpen}
        onOpenChange={(open) => {
          if (!open) {
            setDialog({ type: "closed" });
          }
        }}
        buildingOptions={buildingOptions}
        lockedBuildingId={lockedBuildingId}
        reminder={editDialogReminder}
      />

      {dialog.type === "delete" && (
        <DeleteReminderDialog
          reminder={dialog.reminder}
          open
          onOpenChange={(open) => {
            if (!open) {
              setDialog({ type: "closed" });
            }
          }}
        />
      )}
    </div>
  );
}

"use client";

import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ActiveBuildingOption } from "@/features/buildings/queries";

import type { ReminderListRow } from "../queries";
import { ReminderForm } from "./reminder-form";

// Un solo diálogo para alta y edición, mismo criterio que UnitFormDialog
// (paso 4.3). `key={reminder?.id ?? "new"}` fuerza a ReminderForm a
// remontarse al cambiar de recordatorio objetivo -- necesario para que su
// estado de `buildingId`/`status` (fuera de react-hook-form, ver el
// comentario de ReminderForm) arranque de nuevo con los valores correctos.
export function ReminderFormDialog({
  open,
  onOpenChange,
  buildingOptions,
  lockedBuildingId,
  reminder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  buildingOptions: ActiveBuildingOption[];
  lockedBuildingId: string | null;
  reminder?: ReminderListRow;
}) {
  const mode = reminder ? "edit" : "create";

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {mode === "edit" ? "Editar evento" : "Nuevo evento"}
          </DialogTitle>
          <DialogDescription>
            {mode === "edit"
              ? "Los cambios se guardan para este evento únicamente."
              : "Cargá los datos del evento."}
          </DialogDescription>
        </DialogHeader>
        <ReminderForm
          key={reminder?.id ?? "new"}
          buildingOptions={buildingOptions}
          lockedBuildingId={lockedBuildingId}
          reminder={reminder}
          onSuccess={() => {
            onOpenChange(false);
            toast.success(
              mode === "edit" ? "Evento actualizado." : "Evento creado.",
            );
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

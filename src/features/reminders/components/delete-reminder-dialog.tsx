"use client";

import { useTransition } from "react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

import { softDeleteReminderAction } from "../actions";
import type { ReminderListRow } from "../queries";

// Confirmación de baja (paso 9.1, punto 3) -- más simple que
// DeleteUnitDialog: nada referencia a un recordatorio con una FK que
// bloquee (ver el comentario de softDeleteReminderAction en actions.ts), así
// que no hace falta pedir conteos de dependencias antes de confirmar.
export function DeleteReminderDialog({
  reminder,
  open,
  onOpenChange,
}: {
  reminder: ReminderListRow;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [isPending, startTransition] = useTransition();

  function handleConfirm() {
    startTransition(async () => {
      const result = await softDeleteReminderAction(
        reminder.buildingId,
        reminder.id,
      );
      if (result.ok) {
        onOpenChange(false);
        toast.success(`Evento "${reminder.title}" dado de baja.`);
      } else {
        toast.error(result.error ?? "No pudimos dar de baja el evento.");
      }
    });
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader>
          <DialogTitle>Dar de baja &quot;{reminder.title}&quot;</DialogTitle>
          <DialogDescription>
            Deja de aparecer en el listado de eventos. Esta acción se puede
            revertir solo por soporte técnico.
          </DialogDescription>
        </DialogHeader>

        <DialogFooter>
          <Button
            type="button"
            variant="outline"
            disabled={isPending}
            onClick={() => onOpenChange(false)}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            variant="destructive"
            disabled={isPending}
            onClick={handleConfirm}
          >
            {isPending ? "Dando de baja…" : "Dar de baja"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

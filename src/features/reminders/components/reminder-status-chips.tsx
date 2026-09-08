import Link from "next/link";

import { cn } from "@/lib/utils";

import {
  buildReminderListHref,
  type ReminderStatusFilterValue,
} from "../reminder-list-schema";
import { REMINDER_STATUS_LABEL, REMINDER_STATUSES } from "../reminder-schema";

// Mismo criterio que TicketStatusChips (paso 6.6): Server Component puro,
// sin JS de cliente -- el servidor ya conoce filtros y conteos al
// renderizar, cada chip es un <Link> con el href ya resuelto. Sin consulta
// aparte por chip: `counts` sale de contar en memoria sobre la MISMA lista
// completa que ya trajo getReminderList() para la página (ver page.tsx) --
// la tabla de recordatorios de un edificio es chica (ver el comentario de
// esa función), así que no hace falta un `GROUP BY` en la base como sí lo
// necesita la bandeja de reclamos.
export function ReminderStatusChips({
  counts,
  activeCount,
  total,
  activeStatus,
}: {
  counts: Record<string, number>;
  activeCount: number;
  total: number;
  activeStatus: ReminderStatusFilterValue;
}) {
  return (
    <nav
      aria-label="Filtrar eventos por estado"
      className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max min-w-full gap-2 sm:flex-wrap">
        <StatusChip
          href={buildReminderListHref("active")}
          label="Vigentes"
          count={activeCount}
          active={activeStatus === "active"}
        />
        {REMINDER_STATUSES.map((status) => (
          <StatusChip
            key={status}
            href={buildReminderListHref(status)}
            label={REMINDER_STATUS_LABEL[status]}
            count={counts[status] ?? 0}
            active={activeStatus === status}
          />
        ))}
        <StatusChip
          href={buildReminderListHref("all")}
          label="Todos"
          count={total}
          active={activeStatus === "all"}
        />
      </ul>
    </nav>
  );
}

function StatusChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <li>
      <Link
        href={href}
        aria-current={active || undefined}
        className={cn(
          "border-border text-ink-muted hover:bg-muted hover:text-ink focus-visible:ring-ring/50 inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium whitespace-nowrap transition-colors outline-none focus-visible:ring-3",
          active &&
            "border-primary bg-primary text-primary-foreground hover:bg-primary/80 hover:text-primary-foreground",
        )}
      >
        {label}
        <span
          className={cn(
            "text-xs tabular-nums",
            active ? "text-primary-foreground/80" : "text-ink-muted",
          )}
        >
          {count}
        </span>
      </Link>
    </li>
  );
}

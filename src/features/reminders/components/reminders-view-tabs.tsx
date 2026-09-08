import Link from "next/link";

import { cn } from "@/lib/utils";

import {
  buildReminderViewHref,
  REMINDER_VIEWS,
  type ReminderView,
} from "../reminder-list-schema";

const VIEW_LABEL: Record<ReminderView, string> = {
  list: "Lista",
  upcoming: "Próximos vencimientos",
  calendar: "Calendario",
};

// Navegación entre las tres vistas del paso 9.2 -- mismo criterio visual que
// BuildingDetailTabs (paso 4.2), pero Server Component puro (no
// "use client"/usePathname): acá el "activo" no sale de la URL del
// navegador, sale de `activeView` ya resuelto por page.tsx a partir de
// `?view=` (mismo dato, calculado una vez, sin duplicar el parseo). Cada
// pestaña es un <Link> con el href ya armado (buildReminderViewHref) --
// mismo patrón que los chips de estado, sin JS de cliente para algo que no
// lo necesita.
export function RemindersViewTabs({
  activeView,
}: {
  activeView: ReminderView;
}) {
  return (
    <nav
      aria-label="Vistas de eventos"
      className="border-border -mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max min-w-full gap-1">
        {REMINDER_VIEWS.map((view) => {
          const active = view === activeView;
          return (
            <li key={view}>
              <Link
                href={buildReminderViewHref(view)}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-ink-muted hover:text-ink focus-visible:ring-ring/50 inline-flex items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3",
                  active && "border-primary text-ink",
                )}
              >
                {VIEW_LABEL[view]}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

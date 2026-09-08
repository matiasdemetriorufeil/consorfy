import { Building2 } from "lucide-react";

import { EmptyState } from "@/components/empty-state";
import { getActiveBuildings } from "@/features/buildings/queries";
import { getSelectedBuilding } from "@/features/buildings/selected-building";
import { ReminderCalendar } from "@/features/reminders/components/reminder-calendar";
import { ReminderStatusChips } from "@/features/reminders/components/reminder-status-chips";
import { RemindersList } from "@/features/reminders/components/reminders-list";
import { RemindersViewTabs } from "@/features/reminders/components/reminders-view-tabs";
import { UpcomingRemindersList } from "@/features/reminders/components/upcoming-reminders-list";
import { getReminderList } from "@/features/reminders/queries";
import { reminderListSearchParamsSchema } from "@/features/reminders/reminder-list-schema";
import {
  REMINDER_ACTIVE_STATUSES,
  REMINDER_STATUSES,
} from "@/features/reminders/reminder-schema";
import { requireUser } from "@/lib/auth";
import { formatDateSlug } from "@/lib/format-date";

// Recordatorios por edificio (paso 9.1: CRUD + lista; paso 9.2: calendario +
// próximos vencimientos, ver CLAUDE.md > Vistas de calendario y próximos
// vencimientos) -- usa el MISMO selector de edificio del header que el
// resto del panel (ver CLAUDE.md > Selector de edificio activo), no un
// filtro propio: `getSelectedBuilding()` es el patrón ya fijado (dashboard,
// paso 3.5), no uno inventado para esta pantalla. "Todos los edificios"
// (selección ausente) es una vista agregada legítima acá también -- un
// recordatorio siempre pertenece a UN edificio (reminders.building_id NOT
// NULL), pero el LISTADO puede mostrar los de todos a la vez, con la
// columna Edificio para distinguirlos.
export default async function RemindersPage({
  searchParams,
}: PageProps<"/panel/reminders">) {
  const { organization } = await requireUser();
  const rawParams = await searchParams;
  const parsed = reminderListSearchParamsSchema.safeParse(rawParams);
  // Mismo criterio que el resto del panel: una URL con un valor inválido
  // (`?status=banana`) no rompe la pantalla, cae al default.
  const filters = parsed.success
    ? parsed.data
    : reminderListSearchParamsSchema.parse({});

  // getActiveBuildings() ya está resuelta (cache()) desde que la llamó el
  // layout para el selector del header -- reusarla acá no cuesta una
  // consulta nueva (mismo criterio que PanelHomePage, paso 3.5).
  const [buildings, selectedBuilding] = await Promise.all([
    getActiveBuildings(organization.id),
    getSelectedBuilding(organization.id),
  ]);

  if (buildings.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="Todavía no tenés ningún edificio cargado"
        description="Los eventos se cargan por edificio -- creá el primero para empezar a programar vencimientos."
        action={{
          label: "Cargar mi primer edificio",
          href: "/panel/buildings",
        }}
      />
    );
  }

  const buildingId = selectedBuilding?.id ?? null;

  // Todos los estados de este alcance, sin filtrar -- una sola consulta que
  // alimenta a la vez el listado filtrado y los conteos de los chips (ver
  // ReminderStatusChips), sin un GROUP BY aparte: la tabla de recordatorios
  // de un edificio es chica (ver el comentario de getReminderList).
  const allReminders = await getReminderList(organization.id, buildingId, null);

  const counts: Record<string, number> = {};
  for (const status of REMINDER_STATUSES) {
    counts[status] = 0;
  }
  for (const reminder of allReminders) {
    counts[reminder.status] = (counts[reminder.status] ?? 0) + 1;
  }
  const activeCount = REMINDER_ACTIVE_STATUSES.reduce(
    (sum, status) => sum + (counts[status] ?? 0),
    0,
  );

  const filteredReminders =
    filters.status === "all"
      ? allReminders
      : filters.status === "active"
        ? allReminders.filter((reminder) =>
            REMINDER_ACTIVE_STATUSES.includes(reminder.status),
          )
        : allReminders.filter((reminder) => reminder.status === filters.status);

  // "Próximos vencimientos" (9.2, punto 2): siempre recordatorios ACTIVOS,
  // sin filtro de estado propio (ver CLAUDE.md) -- ya vienen ordenados por
  // `due_date` ascendente porque `allReminders` sale así de getReminderList
  // y `.filter()` preserva el orden.
  const activeReminders = allReminders.filter((reminder) =>
    REMINDER_ACTIVE_STATUSES.includes(reminder.status),
  );

  // "today" en la zona horaria de la ORGANIZACIÓN, nunca UTC ni la del
  // navegador (CLAUDE.md > Convenciones) -- una sola vez acá, compartida
  // por el semáforo de la lista de próximos vencimientos y por el
  // resaltado de "hoy" del calendario.
  const today = formatDateSlug(new Date(), organization.timezone);

  const showBuildingColumn = buildingId === null;

  return (
    <div className="flex flex-col gap-4">
      <RemindersViewTabs activeView={filters.view} />

      {filters.view === "list" && (
        <>
          <ReminderStatusChips
            counts={counts}
            activeCount={activeCount}
            total={allReminders.length}
            activeStatus={filters.status}
          />

          <RemindersList
            reminders={filteredReminders}
            totalCount={allReminders.length}
            buildingOptions={buildings}
            lockedBuildingId={buildingId}
            showBuildingColumn={showBuildingColumn}
          />
        </>
      )}

      {filters.view === "upcoming" && (
        <UpcomingRemindersList
          reminders={activeReminders}
          today={today}
          showBuildingColumn={showBuildingColumn}
        />
      )}

      {filters.view === "calendar" && (
        <ReminderCalendar
          reminders={allReminders}
          today={today}
          showBuildingColumn={showBuildingColumn}
        />
      )}
    </div>
  );
}

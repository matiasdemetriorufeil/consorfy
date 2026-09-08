import { describe, expect, it } from "vitest";

import {
  buildDailySummaryEmail,
  buildReminderThresholdsEmail,
  buildUrgentTicketAlertEmail,
} from "./email-content";

describe("buildUrgentTicketAlertEmail", () => {
  it("arma subject y html con los datos del reclamo", () => {
    const result = buildUrgentTicketAlertEmail({
      buildingName: "Torre Central",
      ticketTitle: "Pérdida de agua en el subsuelo",
      ticketPublicCode: "TC-2026-0042",
      ticketUrl: "https://consorfy.com.ar/panel/tickets/abc-123",
    });

    expect(result.subject).toBe("Reclamo urgente en Torre Central");
    expect(result.html).toContain("Torre Central");
    expect(result.html).toContain("TC-2026-0042");
    expect(result.html).toContain("Pérdida de agua en el subsuelo");
    expect(result.html).toContain(
      "https://consorfy.com.ar/panel/tickets/abc-123",
    );
  });
});

describe("buildDailySummaryEmail", () => {
  it("arma subject exacto con organización y fecha", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [],
      urgentUnresolvedTickets: [],
      overdueTickets: [],
      remindersNeedingAttention: [],
    });

    expect(result.subject).toBe(
      "Resumen diario de Rivadavia Administraciones -- 27 de agosto de 2026",
    );
  });

  it("muestra 'Sin novedades' cuando las cuatro listas están vacías", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [],
      urgentUnresolvedTickets: [],
      overdueTickets: [],
      remindersNeedingAttention: [],
    });

    expect(result.html).toContain("Sin novedades para hoy.");
    expect(result.html).toContain("Reclamos nuevos hoy (0)");
    expect(result.html).toContain("Reclamos urgentes sin resolver (0)");
    expect(result.html).toContain(
      "Reclamos sin resolver hace más de 3 días (0)",
    );
    expect(result.html).toContain("Eventos que necesitan atención (0)");
  });

  it("no muestra 'Sin novedades' si hay al menos un ítem en alguna lista", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          title: "Pérdida de agua",
          buildingName: "Torre Central",
          publicCode: "TC-2026-0042",
        },
      ],
      urgentUnresolvedTickets: [],
      overdueTickets: [],
      remindersNeedingAttention: [],
    });

    expect(result.html).not.toContain("Sin novedades para hoy.");
  });

  it("lista los reclamos nuevos con código, título, edificio y link", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [
        {
          id: "11111111-1111-1111-1111-111111111111",
          title: "Pérdida de agua",
          buildingName: "Torre Central",
          publicCode: "TC-2026-0042",
        },
      ],
      urgentUnresolvedTickets: [],
      overdueTickets: [],
      remindersNeedingAttention: [],
    });

    expect(result.html).toContain("TC-2026-0042");
    expect(result.html).toContain("Pérdida de agua");
    expect(result.html).toContain("Torre Central");
    expect(result.html).toContain(
      "https://consorfy.com.ar/panel/tickets/11111111-1111-1111-1111-111111111111",
    );
    expect(result.html).toContain("Reclamos nuevos hoy (1)");
  });

  it("lista los reclamos urgentes sin resolver por separado de los nuevos", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [],
      urgentUnresolvedTickets: [
        {
          id: "22222222-2222-2222-2222-222222222222",
          title: "Ascensor sin funcionar",
          buildingName: "Los Álamos",
          publicCode: "LA-2026-0007",
        },
      ],
      overdueTickets: [],
      remindersNeedingAttention: [],
    });

    expect(result.html).toContain("Reclamos urgentes sin resolver (1)");
    expect(result.html).toContain("LA-2026-0007");
    expect(result.html).toContain("Ascensor sin funcionar");
  });

  // Decisión tomada con la persona (ver CLAUDE.md > Cron diario): los
  // vencidos no urgentes se repiten día a día en el resumen, mismo
  // criterio que los urgentes -- este es el test de esa sección nueva,
  // por separado de "urgentes" (paso 9.6, corrección posterior).
  it("lista los reclamos vencidos no urgentes por separado de los urgentes", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [],
      urgentUnresolvedTickets: [],
      overdueTickets: [
        {
          id: "55555555-5555-5555-5555-555555555555",
          title: "Falta pintura en el hall",
          buildingName: "Edificio Cabildo",
          publicCode: "EC-2026-0099",
        },
      ],
      remindersNeedingAttention: [],
    });

    expect(result.html).toContain(
      "Reclamos sin resolver hace más de 3 días (1)",
    );
    expect(result.html).toContain("EC-2026-0099");
    expect(result.html).toContain("Falta pintura en el hall");
    expect(result.html).toContain(
      "https://consorfy.com.ar/panel/tickets/55555555-5555-5555-5555-555555555555",
    );
    // La sección de urgentes sigue en 0 -- las dos listas son
    // independientes, esta función no las mezcla.
    expect(result.html).toContain("Reclamos urgentes sin resolver (0)");
  });

  it("distingue eventos vencidos de próximos a vencer", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [],
      urgentUnresolvedTickets: [],
      overdueTickets: [],
      remindersNeedingAttention: [
        {
          id: "33333333-3333-3333-3333-333333333333",
          title: "Service del ascensor",
          buildingName: "Torre Central",
          urgency: "overdue",
        },
        {
          id: "44444444-4444-4444-4444-444444444444",
          title: "Fumigación",
          buildingName: "Los Álamos",
          urgency: "upcoming",
        },
      ],
    });

    expect(result.html).toContain("Eventos que necesitan atención (2)");
    expect(result.html).toContain("[Vencido]");
    expect(result.html).toContain("Service del ascensor");
    expect(result.html).toContain("[Próximo]");
    expect(result.html).toContain("Fumigación");
  });

  it("evento General (buildingName null): la línea no muestra '(null)'", () => {
    const result = buildDailySummaryEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      newTickets: [],
      urgentUnresolvedTickets: [],
      overdueTickets: [],
      remindersNeedingAttention: [
        {
          id: "55555555-5555-5555-5555-555555555555",
          title: "Renovación de la póliza de seguro",
          buildingName: null,
          urgency: "upcoming",
        },
      ],
    });

    expect(result.html).toContain("Renovación de la póliza de seguro");
    expect(result.html).not.toContain("(null)");
    expect(result.html).not.toContain("Renovación de la póliza de seguro (");
  });
});

describe("buildReminderThresholdsEmail", () => {
  it("arma subject con organización y fecha", () => {
    const result = buildReminderThresholdsEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      thresholds: [
        {
          reminderTitle: "Fumigación trimestral",
          buildingName: "Los Álamos",
          noticeDays: 7,
          dueDateLabel: "03/09/2026",
        },
      ],
    });

    expect(result.subject).toBe(
      "Avisos de eventos de Rivadavia Administraciones -- 27 de agosto de 2026",
    );
  });

  it("junta varios umbrales (de eventos distintos) en un solo mail", () => {
    const result = buildReminderThresholdsEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      thresholds: [
        {
          reminderTitle: "Fumigación trimestral",
          buildingName: "Los Álamos",
          noticeDays: 7,
          dueDateLabel: "03/09/2026",
        },
        {
          reminderTitle: "Service anual de ascensores",
          buildingName: "Torre Central",
          noticeDays: 3,
          dueDateLabel: "30/08/2026",
        },
      ],
    });

    expect(result.html).toContain("2 avisos de eventos entraron hoy");
    expect(result.html).toContain("Fumigación trimestral");
    expect(result.html).toContain("Los Álamos");
    expect(result.html).toContain("aviso de 7 días antes");
    expect(result.html).toContain("Service anual de ascensores");
    expect(result.html).toContain("Torre Central");
    expect(result.html).toContain("aviso de 3 días antes");
    expect(result.html).toContain("https://consorfy.com.ar/panel/reminders");
  });

  it("usa singular y 'mismo día' para los umbrales de 1 y 0 días", () => {
    const result = buildReminderThresholdsEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      thresholds: [
        {
          reminderTitle: "Recarga de matafuegos",
          buildingName: "Torre Central",
          noticeDays: 1,
          dueDateLabel: "28/08/2026",
        },
        {
          reminderTitle: "Limpieza de tanque",
          buildingName: "Edificio Cabildo",
          noticeDays: 0,
          dueDateLabel: "27/08/2026",
        },
      ],
    });

    expect(result.html).toContain("aviso de 1 día antes");
    expect(result.html).toContain("aviso del mismo día");
    expect(result.html).not.toContain("aviso de 1 días antes");
    expect(result.html).not.toContain("aviso de 0 días antes");
  });

  it("evento General (buildingName null): la fila no muestra '(null)'", () => {
    const result = buildReminderThresholdsEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      thresholds: [
        {
          reminderTitle: "Renovación de la póliza de seguro",
          buildingName: null,
          noticeDays: 7,
          dueDateLabel: "03/09/2026",
        },
      ],
    });

    expect(result.html).toContain("Renovación de la póliza de seguro");
    expect(result.html).not.toContain("(null)");
    expect(result.html).toContain(
      "Renovación de la póliza de seguro</strong> -- vence el 03/09/2026",
    );
  });

  it("con un solo umbral usa el intro en singular", () => {
    const result = buildReminderThresholdsEmail({
      organizationName: "Rivadavia Administraciones",
      dateLabel: "27 de agosto de 2026",
      appUrl: "https://consorfy.com.ar",
      thresholds: [
        {
          reminderTitle: "Fumigación trimestral",
          buildingName: "Los Álamos",
          noticeDays: 7,
          dueDateLabel: "03/09/2026",
        },
      ],
    });

    expect(result.html).toContain("Un evento entró hoy en su plazo");
    expect(result.html).not.toContain("avisos de eventos entraron");
  });
});

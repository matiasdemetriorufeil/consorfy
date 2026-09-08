import { describe, expect, it } from "vitest";

import {
  buildIncidentMultiUnitNotification,
  buildIncidentResolvedNotification,
  buildNewTicketNotification,
  buildReminderDueNotification,
  buildTicketOverdueNotification,
  buildUrgentTicketNotification,
  TICKET_OVERDUE_THRESHOLD_DAYS,
  ticketQualifiesAsOverdue,
} from "./notification-content";

describe("buildNewTicketNotification", () => {
  it("arma título, body y link a partir del edificio y el reclamo", () => {
    const result = buildNewTicketNotification({
      ticketId: "11111111-1111-1111-1111-111111111111",
      buildingName: "Torre Central",
      ticketTitle: "Pérdida de agua en el subsuelo",
    });
    expect(result).toEqual({
      type: "new_ticket",
      title: "Nuevo reclamo en Torre Central",
      body: "Pérdida de agua en el subsuelo",
      link: "/panel/tickets/11111111-1111-1111-1111-111111111111",
    });
  });
});

describe("buildUrgentTicketNotification", () => {
  it("arma título, body y link con type urgent_ticket", () => {
    const result = buildUrgentTicketNotification({
      ticketId: "11111111-1111-1111-1111-111111111111",
      buildingName: "Torre Central",
      ticketTitle: "Pérdida de agua en el subsuelo",
    });
    expect(result).toEqual({
      type: "urgent_ticket",
      title: "Reclamo urgente en Torre Central",
      body: "Pérdida de agua en el subsuelo",
      link: "/panel/tickets/11111111-1111-1111-1111-111111111111",
    });
  });
});

describe("ticketQualifiesAsOverdue", () => {
  const now = new Date("2026-08-27T12:00:00.000Z");
  const daysAgo = (days: number) =>
    new Date(now.getTime() - days * 24 * 60 * 60 * 1000);

  it("califica un ticket abierto (new) reportado hace más de 3 días", () => {
    expect(
      ticketQualifiesAsOverdue({ status: "new", reportedAt: daysAgo(4) }, now),
    ).toBe(true);
  });

  it("califica un ticket abierto (in_progress) reportado hace más de 3 días", () => {
    expect(
      ticketQualifiesAsOverdue(
        { status: "in_progress", reportedAt: daysAgo(10) },
        now,
      ),
    ).toBe(true);
  });

  it("no califica un ticket abierto reportado hace menos de 3 días", () => {
    expect(
      ticketQualifiesAsOverdue({ status: "new", reportedAt: daysAgo(2) }, now),
    ).toBe(false);
  });

  it("no califica en el límite exacto de 3 días (tiene que ser MÁS de 3)", () => {
    expect(
      ticketQualifiesAsOverdue(
        { status: "new", reportedAt: daysAgo(TICKET_OVERDUE_THRESHOLD_DAYS) },
        now,
      ),
    ).toBe(false);
  });

  it("califica apenas se cruza el límite de 3 días", () => {
    const justOver = new Date(
      daysAgo(TICKET_OVERDUE_THRESHOLD_DAYS).getTime() - 60_000,
    );
    expect(
      ticketQualifiesAsOverdue({ status: "new", reportedAt: justOver }, now),
    ).toBe(true);
  });

  it.each(["resolved", "closed", "discarded"] as const)(
    "nunca califica un ticket %s, sin importar cuánto tiempo pasó",
    (status) => {
      expect(
        ticketQualifiesAsOverdue({ status, reportedAt: daysAgo(30) }, now),
      ).toBe(false);
    },
  );
});

describe("buildTicketOverdueNotification", () => {
  it("arma título (con el umbral), body y link", () => {
    const result = buildTicketOverdueNotification({
      ticketId: "11111111-1111-1111-1111-111111111111",
      buildingName: "Torre Central",
      ticketTitle: "Pérdida de agua en el subsuelo",
    });
    expect(result).toEqual({
      type: "ticket_overdue",
      title: "Reclamo sin resolver hace más de 3 días en Torre Central",
      body: "Pérdida de agua en el subsuelo",
      link: "/panel/tickets/11111111-1111-1111-1111-111111111111",
    });
  });
});

describe("buildReminderDueNotification", () => {
  it("arma título, body (con la frase de vencimiento) y link a la lista de recordatorios", () => {
    const result = buildReminderDueNotification({
      buildingName: "Torre Central",
      reminderTitle: "Fumigación",
      dueDate: "2026-09-01",
      today: "2026-08-29",
    });
    expect(result).toEqual({
      type: "reminder_due",
      title: "Vencimiento próximo en Torre Central",
      body: "Fumigación (Vence en 3 días)",
      link: "/panel/reminders",
    });
  });

  it("evento General (sin edificio): el título omite el ' en {edificio}'", () => {
    const result = buildReminderDueNotification({
      buildingName: null,
      reminderTitle: "Renovación de la póliza de seguro",
      dueDate: "2026-09-01",
      today: "2026-08-29",
    });
    expect(result).toEqual({
      type: "reminder_due",
      title: "Vencimiento próximo",
      body: "Renovación de la póliza de seguro (Vence en 3 días)",
      link: "/panel/reminders",
    });
  });
});

describe("buildIncidentResolvedNotification", () => {
  it("arma título, body y link a partir del incidente", () => {
    const result = buildIncidentResolvedNotification({
      incidentId: "22222222-2222-2222-2222-222222222222",
      incidentTitle: "Plomería en Torre Central",
    });
    expect(result).toEqual({
      type: "incident_updated",
      title: "Problema en común resuelto",
      body: "Plomería en Torre Central",
      link: "/panel/incidents/22222222-2222-2222-2222-222222222222",
    });
  });
});

describe("buildIncidentMultiUnitNotification", () => {
  it("arma título, body y link con type incident_multi_unit", () => {
    const result = buildIncidentMultiUnitNotification({
      incidentId: "22222222-2222-2222-2222-222222222222",
      incidentTitle: "Plomería en Torre Central",
    });
    expect(result).toEqual({
      type: "incident_multi_unit",
      title: "Problema en común afecta a varias unidades",
      body: "Plomería en Torre Central",
      link: "/panel/incidents/22222222-2222-2222-2222-222222222222",
    });
  });
});

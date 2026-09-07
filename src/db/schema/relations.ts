import { relations } from "drizzle-orm";

import { announcementRecipients } from "./announcement-recipients";
import { announcements } from "./announcements";
import { appUsers } from "./app-users";
import { buildings } from "./buildings";
import { categories } from "./categories";
import { documents } from "./documents";
import { incidents } from "./incidents";
import { notifications } from "./notifications";
import { organizations } from "./organizations";
import { people } from "./people";
import { reminderNoticeThresholds } from "./reminder-notice-thresholds";
import { reminders } from "./reminders";
import { ticketAttachments } from "./ticket-attachments";
import { ticketEvents } from "./ticket-events";
import { tickets } from "./tickets";
import { unitOccupancies } from "./unit-occupancies";
import { units } from "./units";

export const organizationsRelations = relations(organizations, ({ many }) => ({
  appUsers: many(appUsers),
  buildings: many(buildings),
  people: many(people),
  categories: many(categories),
  tickets: many(tickets),
  incidents: many(incidents),
  announcements: many(announcements),
  reminders: many(reminders),
  documents: many(documents),
  notifications: many(notifications),
}));

export const buildingsRelations = relations(buildings, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [buildings.organizationId],
    references: [organizations.id],
  }),
  units: many(units),
  tickets: many(tickets),
  incidents: many(incidents),
  announcements: many(announcements),
  reminders: many(reminders),
  documents: many(documents),
}));

export const unitsRelations = relations(units, ({ one, many }) => ({
  building: one(buildings, {
    fields: [units.buildingId],
    references: [buildings.id],
  }),
  occupancies: many(unitOccupancies),
  tickets: many(tickets),
}));

export const peopleRelations = relations(people, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [people.organizationId],
    references: [organizations.id],
  }),
  occupancies: many(unitOccupancies),
  tickets: many(tickets),
  announcementRecipients: many(announcementRecipients),
}));

// units <-> people es muchos-a-muchos a través de unit_occupancies. Drizzle
// no tiene un helper directo para M:N: se modela con un one() a cada lado
// en la tabla puente, y se navega unit -> occupancies -> person (o al
// revés) con la query relacional.
export const unitOccupanciesRelations = relations(
  unitOccupancies,
  ({ one }) => ({
    unit: one(units, {
      fields: [unitOccupancies.unitId],
      references: [units.id],
    }),
    person: one(people, {
      fields: [unitOccupancies.personId],
      references: [people.id],
    }),
  }),
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [categories.organizationId],
    references: [organizations.id],
  }),
  tickets: many(tickets),
  incidents: many(incidents),
}));

export const ticketsRelations = relations(tickets, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [tickets.organizationId],
    references: [organizations.id],
  }),
  building: one(buildings, {
    fields: [tickets.buildingId],
    references: [buildings.id],
  }),
  unit: one(units, {
    fields: [tickets.unitId],
    references: [units.id],
  }),
  person: one(people, {
    fields: [tickets.personId],
    references: [people.id],
  }),
  category: one(categories, {
    fields: [tickets.categoryId],
    references: [categories.id],
  }),
  incident: one(incidents, {
    fields: [tickets.incidentId],
    references: [incidents.id],
  }),
  attachments: many(ticketAttachments),
  events: many(ticketEvents),
  notifications: many(notifications),
}));

export const ticketAttachmentsRelations = relations(
  ticketAttachments,
  ({ one }) => ({
    ticket: one(tickets, {
      fields: [ticketAttachments.ticketId],
      references: [tickets.id],
    }),
  }),
);

export const ticketEventsRelations = relations(ticketEvents, ({ one }) => ({
  ticket: one(tickets, {
    fields: [ticketEvents.ticketId],
    references: [tickets.id],
  }),
}));

export const incidentsRelations = relations(incidents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [incidents.organizationId],
    references: [organizations.id],
  }),
  building: one(buildings, {
    fields: [incidents.buildingId],
    references: [buildings.id],
  }),
  category: one(categories, {
    fields: [incidents.categoryId],
    references: [categories.id],
  }),
  tickets: many(tickets),
  notifications: many(notifications),
}));

export const announcementsRelations = relations(
  announcements,
  ({ one, many }) => ({
    organization: one(organizations, {
      fields: [announcements.organizationId],
      references: [organizations.id],
    }),
    building: one(buildings, {
      fields: [announcements.buildingId],
      references: [buildings.id],
    }),
    recipients: many(announcementRecipients),
  }),
);

export const announcementRecipientsRelations = relations(
  announcementRecipients,
  ({ one }) => ({
    announcement: one(announcements, {
      fields: [announcementRecipients.announcementId],
      references: [announcements.id],
    }),
    person: one(people, {
      fields: [announcementRecipients.personId],
      references: [people.id],
    }),
  }),
);

export const remindersRelations = relations(reminders, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [reminders.organizationId],
    references: [organizations.id],
  }),
  building: one(buildings, {
    fields: [reminders.buildingId],
    references: [buildings.id],
  }),
  notifications: many(notifications),
  noticeThresholds: many(reminderNoticeThresholds),
}));

export const reminderNoticeThresholdsRelations = relations(
  reminderNoticeThresholds,
  ({ one }) => ({
    reminder: one(reminders, {
      fields: [reminderNoticeThresholds.reminderId],
      references: [reminders.id],
    }),
  }),
);

// supersedes/supersededBy son la misma relación autorreferenciada mirada
// desde los dos lados -- relationName las distingue porque Drizzle no puede
// inferir sola cuál de las dos FK compuestas hacia documents corresponde a
// cada una.
export const documentsRelations = relations(documents, ({ one, many }) => ({
  organization: one(organizations, {
    fields: [documents.organizationId],
    references: [organizations.id],
  }),
  building: one(buildings, {
    fields: [documents.buildingId],
    references: [buildings.id],
  }),
  supersedes: one(documents, {
    fields: [documents.supersedesId],
    references: [documents.id],
    relationName: "document_supersedes",
  }),
  supersededBy: many(documents, { relationName: "document_supersedes" }),
}));

export const notificationsRelations = relations(notifications, ({ one }) => ({
  organization: one(organizations, {
    fields: [notifications.organizationId],
    references: [organizations.id],
  }),
  ticket: one(tickets, {
    fields: [notifications.relatedTicketId],
    references: [tickets.id],
  }),
  reminder: one(reminders, {
    fields: [notifications.relatedReminderId],
    references: [reminders.id],
  }),
  incident: one(incidents, {
    fields: [notifications.relatedIncidentId],
    references: [incidents.id],
  }),
}));

export const appUsersRelations = relations(appUsers, ({ one }) => ({
  organization: one(organizations, {
    fields: [appUsers.organizationId],
    references: [organizations.id],
  }),
}));

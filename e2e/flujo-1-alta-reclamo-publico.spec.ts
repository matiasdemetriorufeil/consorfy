import path from "node:path";

import { expect, test } from "@playwright/test";

import { countActiveTickets, sql } from "./helpers/db";
import { removePendingAttachments } from "./helpers/storage";

// --- Datos del seed (base de desarrollo) ---
const TORRE_CENTRAL_TOKEN = "af6201f8-9be0-4258-9fa8-444476d821f9";
const TORRE_CENTRAL_WHATSAPP_DIGITS = "5493511234567";
const OTRO_BUILDING_TOKEN = "b3338ad1-0512-4498-91b1-7db3885a31fb"; // Edificio Cabildo
const FIXTURE_PNG = path.resolve(
  process.cwd(),
  "e2e/fixtures/reclamo-foto.png",
);

// Marca identificable + teléfono único por corrida -- CLAUDE.md > Reglas de
// entorno: todo dato de prueba lleva prefijo y se limpia al terminar.
const RUN_ID = Date.now();
const RUN_TAG = `PRUEBA-E2E-12.2-${RUN_ID}`;
const NEIGHBOR_PHONE = `+549351${String(RUN_ID).slice(-7)}`;
// El campo #ticket-phone ahora es solo la parte editable: el "+54" es una
// etiqueta fija de PhoneNumberInput, no se tipea. Se completa con el resto
// del número (todo lo que va después de "+54"); el valor guardado en la
// base sigue siendo NEIGHBOR_PHONE completo.
const NEIGHBOR_PHONE_NATIONAL = NEIGHBOR_PHONE.slice("+54".length);

// El pool de `helpers/db.ts` es un singleton compartido por todos los
// specs de este worker (workers: 1) -- no se cierra en un afterAll de spec
// porque el spec siguiente lo necesitaría abierto. `idle_timeout` lo cierra
// solo cuando el worker queda inactivo.

test.describe("Flujo 1 - Alta de reclamo desde el formulario público", () => {
  test("camino feliz: 4 pasos + foto real + confirmación, verificado contra la base", async ({
    page,
  }) => {
    const descripcion = `${RUN_TAG} - se escucha un zumbido constante en el pasillo del tercer piso desde anoche y nadie sabe de dónde sale.`;

    await page.goto(`/r/${TORRE_CENTRAL_TOKEN}`);
    await expect(
      page.getByRole("heading", { name: "Torre Central" }),
    ).toBeVisible();

    // --- Paso 1: identificación ---
    await expect(page.getByText("Paso 1 de 4")).toBeVisible();
    await page.locator("#ticket-first-name").fill("Prueba E2E 12.2");
    await page.locator("#ticket-last-name").fill("Vecino");
    await page.locator("#ticket-phone").fill(NEIGHBOR_PHONE_NATIONAL);

    // Unidad: combobox con las unidades reales del edificio.
    await page.locator("#ticket-unit").click();
    await page.getByRole("option", { name: "Norte - 1°A" }).click();
    await expect(page.locator("#ticket-unit")).toContainText("Norte - 1°A");

    await page.getByRole("button", { name: "Continuar" }).click();

    // --- Paso 2: problema ---
    await expect(page.getByText("Paso 2 de 4")).toBeVisible();
    await page.locator("#ticket-category").click();
    await page.getByRole("option", { name: "Otro" }).click();
    await page.locator("#ticket-description").fill(descripcion);
    await page.getByRole("button", { name: "Continuar" }).click();

    // --- Paso 3: fotos (subida real a Storage) ---
    await expect(page.getByText("Paso 3 de 4")).toBeVisible();
    await page.locator("#ticket-photos").setInputFiles(FIXTURE_PNG);
    await expect(page.getByText("reclamo-foto.png")).toBeVisible();
    // El botón Continuar está deshabilitado mientras un adjunto está en
    // vuelo -- se habilita cuando termina de subir.
    await expect(page.getByRole("button", { name: "Continuar" })).toBeEnabled({
      timeout: 60_000,
    });
    await expect(page.getByText("Subiendo…")).toHaveCount(0);
    await page.getByRole("button", { name: "Continuar" }).click();

    // --- Paso 4: confirmación ---
    await expect(page.getByText("Paso 4 de 4")).toBeVisible();
    await expect(page.getByText(descripcion)).toBeVisible();
    await page.getByRole("button", { name: "Enviar reclamo" }).click();

    // --- Pantalla de confirmación ---
    await expect(
      page.getByRole("heading", {
        name: "Listo, tu reclamo ya quedó registrado",
      }),
    ).toBeVisible({ timeout: 60_000 });

    const codeRaw = await page.locator("p.font-mono").first().textContent();
    const publicCode = (codeRaw ?? "").trim();
    expect(publicCode).toMatch(/^TC-\d{4}-\d{4}$/);

    await expect(
      page.getByRole("link", { name: "Ver el estado de tu reclamo" }),
    ).toBeVisible();

    const whatsappLink = page.getByRole("link", {
      name: "Enviar por WhatsApp",
    });
    await expect(whatsappLink).toBeVisible();
    const whatsappHref = await whatsappLink.getAttribute("href");
    expect(whatsappHref).toContain(
      `https://api.whatsapp.com/send?phone=${TORRE_CENTRAL_WHATSAPP_DIGITS}`,
    );
    expect(whatsappHref).toContain(encodeURIComponent(publicCode));

    // --- Verificación contra la BASE (no solo la UI) ---
    const ticketRows = await sql<
      {
        id: string;
        person_id: string | null;
        status: string;
        source: string;
        priority: string;
        description: string;
        category_name: string;
        building_name: string;
        unit_label: string | null;
        first_name: string | null;
        last_name: string | null;
        phone_e164: string | null;
      }[]
    >`
      select
        t.id, t.person_id, t.status, t.source, t.priority, t.description,
        c.name as category_name,
        b.name as building_name,
        case when u.id is null then null
             else coalesce(u.tower || ' - ', '') || u.floor || '°' || u.number
        end as unit_label,
        p.first_name, p.last_name, p.phone_e164
      from tickets t
        join categories c on c.id = t.category_id
        join buildings b on b.id = t.building_id
        left join units u on u.id = t.unit_id
        left join people p on p.id = t.person_id
      where t.public_code = ${publicCode}
    `;

    expect(ticketRows).toHaveLength(1);
    const ticket = ticketRows[0]!;
    expect(ticket.status).toBe("new");
    expect(ticket.source).toBe("public_form");
    expect(ticket.priority).toBe("low"); // categoría "Otro"
    expect(ticket.category_name).toBe("Otro");
    expect(ticket.building_name).toBe("Torre Central");
    expect(ticket.unit_label).toBe("Norte - 1°A");
    expect(ticket.description).toBe(descripcion);
    expect(ticket.first_name).toBe("Prueba E2E 12.2");
    expect(ticket.last_name).toBe("Vecino");
    expect(ticket.phone_e164).toBe(NEIGHBOR_PHONE);

    const events = await sql<{ type: string; actor_type: string }[]>`
      select type, actor_type from ticket_events where ticket_id = ${ticket.id}
    `;
    expect(events.map((e) => e.type)).toContain("created");

    const attachments = await sql<
      { storage_path: string; original_filename: string; mime_type: string }[]
    >`
      select storage_path, original_filename, mime_type
      from ticket_attachments where ticket_id = ${ticket.id}
    `;
    expect(attachments.length).toBeGreaterThanOrEqual(1);
    expect(attachments[0]!.storage_path).toMatch(/^pending\//);

    // --- Limpieza: borrado lógico en tablas de negocio; físico en el log
    // append-only, en candidatos de similitud, notificaciones y Storage ---
    await sql`update tickets set deleted_at = now() where id = ${ticket.id}`;
    if (ticket.person_id) {
      await sql`update people set deleted_at = now() where id = ${ticket.person_id}`;
    }
    await sql`delete from ticket_events where ticket_id = ${ticket.id}`;
    await sql`delete from ticket_attachments where ticket_id = ${ticket.id}`;
    await sql`
      update ticket_similarity_candidates set deleted_at = now()
      where ticket_id = ${ticket.id} or candidate_ticket_id = ${ticket.id}
    `;
    await sql`update notifications set deleted_at = now() where related_ticket_id = ${ticket.id}`;
    await removePendingAttachments(attachments.map((a) => a.storage_path));

    const stillActive = await sql<{ n: number }[]>`
      select count(*)::int as n from tickets
      where public_code = ${publicCode} and deleted_at is null
    `;
    expect(stillActive[0]!.n).toBe(0);
  });

  test("token inválido y token mal formado muestran la pantalla de error, sin crear ningún ticket", async ({
    page,
  }) => {
    const before = await countActiveTickets();

    // uuid válido pero inexistente
    await page.goto("/r/00000000-0000-0000-0000-000000000000");
    await expect(
      page.getByRole("heading", { name: "No encontramos este enlace" }),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "Continuar" })).toHaveCount(
      0,
    );

    // token mal formado (ni siquiera es un uuid)
    await page.goto("/r/esto-no-es-un-token");
    await expect(
      page.getByRole("heading", { name: "No encontramos este enlace" }),
    ).toBeVisible();

    const after = await countActiveTickets();
    expect(after).toBe(before);
  });

  test("edificio en pausa (active=false) muestra el aviso propio y no el formulario", async ({
    page,
  }) => {
    // Muta un edificio del seed temporalmente y lo restaura al final --
    // Edificio Cabildo, distinto del que usa el resto de la suite.
    await sql`update buildings set active = false where public_token = ${OTRO_BUILDING_TOKEN}`;
    try {
      await page.goto(`/r/${OTRO_BUILDING_TOKEN}`);
      await expect(
        page.getByText("Este edificio no está recibiendo reclamos por acá"),
      ).toBeVisible();
      await expect(page.getByRole("button", { name: "Continuar" })).toHaveCount(
        0,
      );
      await expect(page.getByText("Paso 1 de 4")).toHaveCount(0);
    } finally {
      await sql`update buildings set active = true where public_token = ${OTRO_BUILDING_TOKEN}`;
    }

    const restored = await sql<{ active: boolean }[]>`
      select active from buildings where public_token = ${OTRO_BUILDING_TOKEN}
    `;
    expect(restored[0]!.active).toBe(true);
  });
});

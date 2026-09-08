import readline from "node:readline/promises";

import { inArray } from "drizzle-orm";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema";

// =============================================================================
// SALVAGUARDAS
// =============================================================================
// Este script borra TODO el contenido de las tablas de negocio y lo recrea.
// Cuatro capas independientes, ninguna salteable salvo la explícitamente
// marcada como tal:
//
// 1. Aborta si NODE_ENV=production. No hay forma de saltear esto -- si algún
//    día existe un entorno de producción real, este chequeo por sí solo ya
//    lo protege sin depender de que nadie recuerde nada más.
// 2. Aborta si el project ref de DATABASE_URL no es el del proyecto de
//    DESARROLLO (ver ALLOWED_DEV_PROJECT_REF más abajo). Agregada en la
//    separación de bases dev/producción: hasta esa separación, dev y
//    producción compartían un único proyecto de Supabase, así que esta
//    capa no podía existir -- no había ningún project ref "de producción"
//    del que distinguirse. Con dos proyectos separados sí hay una señal
//    confiable, y esta es la única capa de las cuatro que no depende de
//    que nadie haya seteado nada a mano en ese momento: es correcta por
//    default, sin acción humana.
// 3. Exige SEED_CONFIRM con un valor EXACTO y específico (no "true"/"1", que
//    alguien podría dejar seteado en el shell por otro motivo y disparar el
//    seed sin querer). Tiene que ser una decisión consciente en el momento.
// 4. Muestra a qué host y base se va a conectar y pide confirmación
//    interactiva escrita a mano -- salteable con --yes, para uso en scripts
//    o CI, pero ni la nº2 ni la nº3 se saltean NUNCA: --yes solo saltea el
//    "prompt", no las dos capas de arriba.
const SEED_CONFIRM_VALUE = "si-quiero-borrar-y-recrear-los-datos-de-desarrollo";

// Único proyecto de Supabase contra el que este script puede correr. Un
// valor hardcodeado a propósito, no una variable de entorno más: si viviera
// en una env var, un `.env.local` mal armado (ej. con las credenciales de
// producción pegadas por error) podría traer también un
// "SEED_ALLOWED_PROJECT_REF" que combine con esas credenciales y el chequeo
// nunca dispararía. Hardcodeado en el código, el único forma de que este
// script alguna vez apunte a otro proyecto es cambiar esta línea a mano y
// commitear el cambio -- una acción deliberada y visible en el diff, no
// algo que un archivo de entorno pueda alterar en silencio.
const ALLOWED_DEV_PROJECT_REF = "ytvhanvwkmvyqjeoysab";

// El project ref de Supabase aparece en DOS lugares posibles de una
// connection string, según el tipo de conexión (ver .env.example):
// - Conexión directa: en el HOSTNAME, "db.<ref>.supabase.co".
// - Pooler (sesión o transacciones): en el USUARIO, "postgres.<ref>".
// Si no matchea ninguno de los dos patrones, se trata como "no se pudo
// determinar" -- NUNCA como "entonces debe ser dev": fallar cerrado (abortar
// cuando hay duda) es la opción segura acá, fallar abierto no.
function extractSupabaseProjectRef(databaseUrl: string): string | null {
  const url = new URL(databaseUrl);

  const directMatch = url.hostname.match(/^db\.([a-z0-9]+)\.supabase\.co$/);
  if (directMatch) {
    return directMatch[1] ?? null;
  }

  const poolerMatch = url.username.match(/^postgres\.([a-z0-9]+)$/);
  if (poolerMatch) {
    return poolerMatch[1] ?? null;
  }

  return null;
}

async function runSafetyChecks(databaseUrl: string) {
  if (process.env.NODE_ENV === "production") {
    console.error(
      "ABORTADO: NODE_ENV=production. Este script nunca corre contra producción.",
    );
    process.exit(1);
  }

  const projectRef = extractSupabaseProjectRef(databaseUrl);
  if (projectRef !== ALLOWED_DEV_PROJECT_REF) {
    console.error(
      `ABORTADO: DATABASE_URL apunta al proyecto de Supabase ` +
        `"${projectRef ?? "no se pudo determinar"}", y este script SOLO ` +
        `puede correr contra el proyecto de desarrollo ` +
        `("${ALLOWED_DEV_PROJECT_REF}"). Revisá qué DATABASE_URL está ` +
        `cargado -- si es el de producción, ni se te ocurra forzar esto.`,
    );
    process.exit(1);
  }

  if (process.env.SEED_CONFIRM !== SEED_CONFIRM_VALUE) {
    console.error(
      `ABORTADO: falta la variable de entorno de confirmación.\n` +
        `Corré con SEED_CONFIRM=${SEED_CONFIRM_VALUE} si estás seguro de que` +
        ` querés borrar y recrear los datos.`,
    );
    process.exit(1);
  }

  const skipPrompt =
    process.argv.includes("--yes") || process.argv.includes("-y");
  const url = new URL(databaseUrl);
  console.log(
    `Este script va a BORRAR y RECREAR todos los datos de negocio en:\n` +
      `  host: ${url.hostname}\n` +
      `  base: ${url.pathname.replace("/", "")}\n`,
  );

  if (skipPrompt) {
    console.log("(--yes presente, salteando la confirmación interactiva)\n");
    return;
  }

  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer = await rl.question("Escribí 'si' para continuar: ");
  rl.close();
  if (answer.trim().toLowerCase() !== "si") {
    console.log("Cancelado por el usuario.");
    process.exit(1);
  }
  console.log("");
}

// =============================================================================
// GENERADOR DETERMINISTA
// =============================================================================
// mulberry32: PRNG de 32 bits, determinista dado el mismo seed. Nada de
// Math.random() en este archivo -- correr el seed dos veces con la misma
// SEED produce exactamente la misma secuencia de "aleatorios", que es lo que
// hace posible que los dos runs generen el mismo contenido (ver el punto 3
// del paso: "mismos datos en cada corrida"). Las excepciones deliberadas son
// reported_at/due_date, que se calculan relativos a `NOW` (la hora real de
// cada corrida) porque el enunciado pide fechas "de los últimos 90 días" --
// eso es, por definición, relativo al momento de la corrida, no un valor
// congelado. Lo determinista ahí es el OFFSET en días (siempre el mismo),
// no la fecha calendario resultante.
const SEED = 20260810;
function mulberry32(seed: number) {
  let state = seed;
  return function random() {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rng = mulberry32(SEED);
function randInt(min: number, max: number): number {
  return Math.floor(rng() * (max - min + 1)) + min;
}

const NOW = new Date();
function reportedAtDaysAgo(days: number, hour: number): Date {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(hour, randInt(0, 59), 0, 0);
  return d;
}
function reportedAtHoursAgo(hours: number): Date {
  return new Date(NOW.getTime() - hours * 60 * 60 * 1000);
}
function dueDateOffsetDays(days: number): string {
  const d = new Date(NOW);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function stripAccents(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "");
}

// =============================================================================
// CONEXIÓN
// =============================================================================
// Cliente propio, no el de src/db/index.ts: ese módulo importa
// src/lib/env.ts, que a su vez importa "server-only" -- un paquete de
// Next.js que tira una excepción si se lo importa fuera del pipeline de
// build de Next (que es exactamente cómo se ejecuta este script, con tsx
// directo). Un seed es una herramienta de desarrollo, no parte del runtime
// de la app, así que tiene sentido que arme su propia conexión en vez de
// depender de esa cadena de imports.
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Falta DATABASE_URL en el entorno.");
  process.exit(1);
}

async function main() {
  await runSafetyChecks(databaseUrl!);

  const sql = postgres(databaseUrl!, { prepare: false, max: 1 });
  const db = drizzle({ client: sql, schema });

  console.log("--- limpiando datos existentes ---");
  // Orden de borrado: hijos antes que padres. Todas las FK de este esquema
  // son ON DELETE RESTRICT (nunca CASCADE -- ver CLAUDE.md), así que un
  // orden equivocado acá falla con una violación de FK, no borra de más por
  // accidente. Es un orden topológico válido del grafo de FKs completo.
  await db.delete(schema.notifications);
  await db.delete(schema.announcementRecipients);
  await db.delete(schema.ticketEvents);
  await db.delete(schema.ticketAttachments);
  await db.delete(schema.ticketSimilarityCandidates);
  await db.delete(schema.tickets);
  await db.delete(schema.incidents);
  await db.delete(schema.announcements);
  await db.delete(schema.reminderNoticeThresholds);
  await db.delete(schema.reminders);
  await db.delete(schema.documents);
  await db.delete(schema.unitOccupancies);
  await db.delete(schema.ticketCodeCounters);
  await db.delete(schema.categories);
  await db.delete(schema.people);
  await db.delete(schema.units);
  await db.delete(schema.buildings);
  await db.delete(schema.appUsers);
  await db.delete(schema.organizations);
  console.log("listo.\n");

  // ---------------------------------------------------------------------
  // 1 organización
  // ---------------------------------------------------------------------
  const [organization] = await db
    .insert(schema.organizations)
    .values({
      name: "Rivadavia Administraciones",
      timezone: "America/Argentina/Cordoba",
    })
    .returning();
  if (!organization) throw new Error("no se pudo crear la organización");
  console.log(`organización: ${organization.name} (${organization.id})`);

  // ---------------------------------------------------------------------
  // 3 edificios
  // ---------------------------------------------------------------------
  const buildingRows = await db
    .insert(schema.buildings)
    .values([
      {
        organizationId: organization.id,
        name: "Torre Central",
        address: "Av. Poeta Lugones 1230",
        city: "Córdoba",
        slug: "torre-central",
        codePrefix: "TC",
        adminWhatsappE164: "+5493511234567",
      },
      {
        organizationId: organization.id,
        name: "Los Álamos",
        address: "Bv. Illia 872",
        city: "Córdoba",
        slug: "los-alamos",
        codePrefix: "LA",
        adminWhatsappE164: "+5493512345678",
      },
      {
        organizationId: organization.id,
        name: "Edificio Cabildo",
        address: "Av. San Martín 560",
        city: "Villa Carlos Paz",
        slug: "edificio-cabildo",
        codePrefix: "EC",
        adminWhatsappE164: "+5493513456789",
      },
    ])
    .returning();
  const bySlug = Object.fromEntries(buildingRows.map((b) => [b.slug, b]));
  const torreCentral = bySlug["torre-central"]!;
  const losAlamos = bySlug["los-alamos"]!;
  const cabildo = bySlug["edificio-cabildo"]!;
  console.log(
    `edificios: ${buildingRows.map((b) => `${b.name} (${b.codePrefix})`).join(", ")}`,
  );

  // ---------------------------------------------------------------------
  // ~40 unidades
  // ---------------------------------------------------------------------
  type UnitDef = {
    buildingId: string;
    tower: string | null;
    floor: string;
    number: string;
    type: "apartment" | "parking" | "storage" | "commercial" | "other";
  };
  const unitDefs: UnitDef[] = [];

  // Torre Central: dos torres (ejercita el índice único parcial con tower).
  for (const tower of ["Norte", "Sur"]) {
    for (const floor of ["1", "2", "3", "4"]) {
      for (const number of ["A", "B"]) {
        unitDefs.push({
          buildingId: torreCentral.id,
          tower,
          floor,
          number,
          type: "apartment",
        });
      }
    }
  }
  for (const number of ["1", "2", "3"]) {
    unitDefs.push({
      buildingId: torreCentral.id,
      tower: null,
      floor: "Subsuelo 1",
      number,
      type: "parking",
    });
  }
  unitDefs.push({
    buildingId: torreCentral.id,
    tower: null,
    floor: "Subsuelo 1",
    number: "B1",
    type: "storage",
  });

  // Los Álamos: sin torres (tower siempre null -- coalesce(tower,'') en el
  // índice único entra en juego acá).
  for (const floor of ["1", "2", "3", "4"]) {
    for (const number of ["A", "B"]) {
      unitDefs.push({
        buildingId: losAlamos.id,
        tower: null,
        floor,
        number,
        type: "apartment",
      });
    }
  }
  for (const number of ["1", "2", "3"]) {
    unitDefs.push({
      buildingId: losAlamos.id,
      tower: null,
      floor: "PB",
      number,
      type: "parking",
    });
  }
  unitDefs.push({
    buildingId: losAlamos.id,
    tower: null,
    floor: "PB",
    number: "B1",
    type: "storage",
  });

  // Edificio Cabildo: chico, con un local comercial en planta baja.
  for (const floor of ["1", "2", "3"]) {
    for (const number of ["A", "B"]) {
      unitDefs.push({
        buildingId: cabildo.id,
        tower: null,
        floor,
        number,
        type: "apartment",
      });
    }
  }
  unitDefs.push({
    buildingId: cabildo.id,
    tower: null,
    floor: "PB",
    number: "1",
    type: "parking",
  });
  unitDefs.push({
    buildingId: cabildo.id,
    tower: null,
    floor: "PB",
    number: "Local 1",
    type: "commercial",
  });

  const unitRows = await db
    .insert(schema.units)
    .values(
      unitDefs.map((u) => ({
        organizationId: organization.id,
        buildingId: u.buildingId,
        tower: u.tower,
        floor: u.floor,
        number: u.number,
        type: u.type,
      })),
    )
    .returning();
  console.log(`unidades: ${unitRows.length}`);

  const apartmentUnits = unitRows.filter((u) => u.type === "apartment");

  // ---------------------------------------------------------------------
  // ~50 personas
  // ---------------------------------------------------------------------
  const MALE_FIRST_NAMES = [
    "Juan",
    "Carlos",
    "Jorge",
    "Luis",
    "Miguel",
    "Roberto",
    "Diego",
    "Martín",
    "Pablo",
    "Fernando",
    "Sergio",
    "Ricardo",
    "Alejandro",
    "Gustavo",
    "Daniel",
    "Marcelo",
    "Andrés",
    "Facundo",
    "Nicolás",
    "Ezequiel",
    "Rodrigo",
    "Emiliano",
    "Franco",
    "Matías",
    "Leonardo",
  ];
  const FEMALE_FIRST_NAMES = [
    "María",
    "Ana",
    "Laura",
    "Claudia",
    "Silvia",
    "Patricia",
    "Marcela",
    "Gabriela",
    "Valeria",
    "Carolina",
    "Florencia",
    "Lucía",
    "Sofía",
    "Camila",
    "Rosa",
    "Susana",
    "Mónica",
    "Adriana",
    "Verónica",
    "Paula",
    "Julieta",
    "Antonella",
    "Yamila",
    "Noelia",
    "Agustina",
  ];
  const LAST_NAMES = [
    "González",
    "Rodríguez",
    "Fernández",
    "López",
    "Martínez",
    "García",
    "Pérez",
    "Sánchez",
    "Romero",
    "Torres",
    "Álvarez",
    "Ruiz",
    "Díaz",
    "Flores",
    "Acosta",
    "Benítez",
    "Medina",
    "Herrera",
    "Suárez",
    "Ibáñez",
    "Molina",
    "Ortiz",
    "Silva",
    "Núñez",
    "Rojas",
    "Aguirre",
    "Ferreyra",
    "Godoy",
    "Bustos",
    "Correa",
    "Pereyra",
    "Juárez",
    "Sosa",
    "Luna",
    "Vega",
  ];
  const FIRST_NAMES = [...MALE_FIRST_NAMES, ...FEMALE_FIRST_NAMES]; // 50, sin repetidos
  const EMAIL_DOMAINS = ["gmail.com", "hotmail.com", "outlook.com"];
  // Sin teléfono: al menos una persona (pedido explícito). Sin email:
  // "algunas" -- un tercio, aprox, vía i % 3 === 0.
  const NO_PHONE_INDEXES = new Set([12, 27, 44]);

  const peopleDefs = FIRST_NAMES.map((firstName, i) => {
    const lastName = LAST_NAMES[(i * 7 + 3) % LAST_NAMES.length]!;
    const hasPhone = !NO_PHONE_INDEXES.has(i);
    const hasEmail = i % 3 !== 0;
    const emailLocal = stripAccents(`${firstName}.${lastName}`).toLowerCase();
    return {
      firstName,
      lastName,
      phoneE164: hasPhone
        ? `+549351${String(5000000 + i).padStart(7, "0")}`
        : null,
      email: hasEmail
        ? `${emailLocal}@${EMAIL_DOMAINS[i % EMAIL_DOMAINS.length]}`
        : null,
    };
  });

  const peopleRows = await db
    .insert(schema.people)
    .values(
      peopleDefs.map((p) => ({
        organizationId: organization.id,
        firstName: p.firstName,
        lastName: p.lastName,
        phoneE164: p.phoneE164,
        email: p.email,
      })),
    )
    .returning();
  console.log(`personas: ${peopleRows.length}`);

  // ---------------------------------------------------------------------
  // Ocupaciones
  // ---------------------------------------------------------------------
  type OccupancyDef = {
    unitId: string;
    personId: string;
    role: "owner" | "tenant";
    isPrimary: boolean;
    startedOn: string;
    endedOn: string | null;
  };
  const occupancyDefs: OccupancyDef[] = [];

  // Dueños para la mayoría de los departamentos (30 deptos en total: 16 en
  // Torre Central, 8 en Los Álamos, 6 en Cabildo). Se dejan algunos vacíos
  // a propósito (realista: unidades en venta o recién entregadas).
  const OWNER_START = "2019-04-01";
  let personCursor = 0;
  const nextPerson = () => peopleRows[personCursor++ % peopleRows.length]!;

  const ownedApartments = apartmentUnits.slice(0, apartmentUnits.length - 4);
  for (const unit of ownedApartments) {
    occupancyDefs.push({
      unitId: unit.id,
      personId: nextPerson().id,
      role: "owner",
      isPrimary: true,
      startedOn: OWNER_START,
      endedOn: null,
    });
  }

  // Caso pedido: una unidad con propietario E inquilino a la vez (se
  // alquila, el dueño no vive ahí pero sigue figurando). El inquilino pasa
  // a ser el contacto principal.
  const rentedUnit = apartmentUnits[0]!; // Torre Central, torre Norte, piso 1, A
  const rentedOwnerOccupancy = occupancyDefs.find(
    (o) => o.unitId === rentedUnit.id,
  )!;
  rentedOwnerOccupancy.isPrimary = false;
  const tenantForRentedUnit = nextPerson();
  occupancyDefs.push({
    unitId: rentedUnit.id,
    personId: tenantForRentedUnit.id,
    role: "tenant",
    isPrimary: true,
    startedOn: "2024-02-01",
    endedOn: null,
  });

  // Caso pedido: una persona con dos unidades (dueño de su depto y de una
  // cochera en el mismo edificio).
  const ownerWithTwoUnits = ownedApartments[5]!;
  const ownerWithTwoUnitsPersonId = occupancyDefs.find(
    (o) => o.unitId === ownerWithTwoUnits.id,
  )!.personId;
  const extraParking = unitRows.find(
    (u) => u.buildingId === torreCentral.id && u.type === "parking",
  )!;
  occupancyDefs.push({
    unitId: extraParking.id,
    personId: ownerWithTwoUnitsPersonId,
    role: "owner",
    isPrimary: true,
    startedOn: OWNER_START,
    endedOn: null,
  });

  // Caso pedido: una ocupación ya finalizada (ex-inquilino), para tener
  // historial. La unidad ya tiene otro inquilino vigente cargado después --
  // no pisa el índice único parcial porque ended_on IS NOT NULL saca a esta
  // fila del alcance de ese índice.
  const unitWithHistory = apartmentUnits[12]!; // Los Álamos
  const formerTenant = nextPerson();
  occupancyDefs.push({
    unitId: unitWithHistory.id,
    personId: formerTenant.id,
    role: "tenant",
    isPrimary: false,
    startedOn: "2021-06-01",
    endedOn: "2023-05-31",
  });

  const occupancyRows = await db
    .insert(schema.unitOccupancies)
    .values(
      occupancyDefs.map((o) => ({
        organizationId: organization.id,
        unitId: o.unitId,
        personId: o.personId,
        role: o.role,
        isPrimary: o.isPrimary,
        startedOn: o.startedOn,
        endedOn: o.endedOn,
      })),
    )
    .returning();
  console.log(`ocupaciones: ${occupancyRows.length}`);

  // ---------------------------------------------------------------------
  // 8 categorías
  // ---------------------------------------------------------------------
  const categoryRows = await db
    .insert(schema.categories)
    .values([
      {
        organizationId: organization.id,
        name: "Plomería",
        icon: "wrench",
        defaultPriority: "high",
        sortOrder: 1,
      },
      {
        organizationId: organization.id,
        name: "Electricidad",
        icon: "zap",
        defaultPriority: "high",
        sortOrder: 2,
      },
      {
        organizationId: organization.id,
        name: "Ascensores",
        icon: "arrow-up-down",
        defaultPriority: "urgent",
        sortOrder: 3,
      },
      {
        organizationId: organization.id,
        name: "Limpieza y espacios comunes",
        icon: "sparkles",
        defaultPriority: "low",
        sortOrder: 4,
      },
      {
        organizationId: organization.id,
        name: "Seguridad",
        icon: "shield",
        defaultPriority: "high",
        sortOrder: 5,
      },
      {
        organizationId: organization.id,
        name: "Ruidos molestos",
        icon: "volume-2",
        defaultPriority: "medium",
        sortOrder: 6,
      },
      {
        organizationId: organization.id,
        name: "Mantenimiento general",
        icon: "hammer",
        defaultPriority: "medium",
        sortOrder: 7,
      },
      {
        organizationId: organization.id,
        name: "Otro",
        icon: "circle-help",
        defaultPriority: "low",
        sortOrder: 8,
      },
    ])
    .returning();
  const byCategoryName = Object.fromEntries(
    categoryRows.map((c) => [c.name, c]),
  );
  console.log(`categorías: ${categoryRows.length}`);

  // ---------------------------------------------------------------------
  // ~30 reclamos (incluye el cluster de 4 "mismo problema, distinta
  // redacción" del ascensor, para la detección de duplicados de la etapa 7)
  // ---------------------------------------------------------------------
  type TicketDef = {
    building: (typeof buildingRows)[number];
    category: (typeof categoryRows)[number];
    unit?: (typeof unitRows)[number];
    unitLabelRaw?: string;
    person?: (typeof peopleRows)[number];
    title: string;
    description: string;
    priority: "low" | "medium" | "high" | "urgent";
    status: "new" | "in_progress" | "resolved" | "closed" | "discarded";
    source: "public_form" | "admin" | "whatsapp";
    reportedAt: Date;
    resolvedAt?: Date;
    closedAt?: Date;
  };

  const ascensores = byCategoryName["Ascensores"]!;
  const plomeria = byCategoryName["Plomería"]!;
  const electricidad = byCategoryName["Electricidad"]!;
  const limpieza = byCategoryName["Limpieza y espacios comunes"]!;
  const seguridad = byCategoryName["Seguridad"]!;
  const ruidos = byCategoryName["Ruidos molestos"]!;
  const mantenimiento = byCategoryName["Mantenimiento general"]!;
  const otro = byCategoryName["Otro"]!;

  const ticketDefs: TicketDef[] = [
    // --- Cluster de 4 reclamos del ascensor: mismo edificio, misma
    // categoría, dentro de una ventana de 72hs, redactados por vecinos
    // distintos con palabras totalmente distintas entre sí.
    {
      building: torreCentral,
      category: ascensores,
      unit: apartmentUnits[2], // torre Norte, piso 2
      person: peopleRows[0],
      title: "El ascensor se queda trabado entre pisos",
      description:
        "El ascensor de la torre Norte se quedó trabado entre el 3er y 4to piso esta mañana como 20 minutos, tuvimos que ayudar a una vecina a salir por la fuerza. Es la segunda vez este mes que pasa.",
      priority: "urgent",
      source: "public_form",
      status: "in_progress",
      reportedAt: reportedAtHoursAgo(68),
    },
    {
      building: torreCentral,
      category: ascensores,
      unit: apartmentUnits[4], // torre Norte, piso 3
      person: peopleRows[1],
      title: "El ascensor no frena bien al llegar a los pisos",
      description:
        "Hace dos días que el ascensor de la torre Norte no frena bien al llegar a los pisos, se pasa un poco y después corrige solo. Con el changuito del súper da bastante miedo subir.",
      priority: "high",
      source: "whatsapp",
      status: "new",
      reportedAt: reportedAtHoursAgo(51),
    },
    {
      building: torreCentral,
      category: ascensores,
      unitLabelRaw: "Torre Norte, cuarto piso",
      person: peopleRows[2],
      title: "No anda el ascensor desde ayer",
      description:
        "El ascensor de la torre Norte no funciona desde ayer a la tarde. Vivo en el cuarto piso y con la rodilla que tengo se me hace muy difícil subir por escalera todos los días.",
      priority: "urgent",
      source: "public_form",
      status: "in_progress",
      reportedAt: reportedAtHoursAgo(34),
    },
    {
      building: torreCentral,
      category: ascensores,
      unit: apartmentUnits[6], // torre Norte, piso 4
      person: peopleRows[3],
      title: "Ruido raro en el ascensor y se para solo",
      description:
        "El ascensor hace un ruido metálico feo cuando arranca y a veces se detiene solo antes de llegar al piso que pedís. Ya le avisé al encargado pero seguimos igual, alguien se puede lastimar.",
      priority: "high",
      source: "admin",
      status: "new",
      reportedAt: reportedAtHoursAgo(6),
    },

    // --- Plomería
    {
      building: torreCentral,
      category: plomeria,
      unitLabelRaw: "Palier planta baja, torre Sur",
      title: "Mancha de humedad creciendo en el palier",
      description:
        "Hay una mancha de humedad que crece día a día en el techo del palier de planta baja, torre Sur. Parece que gotea de algún caño de arriba.",
      priority: "high",
      source: "admin",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(72, 10),
      resolvedAt: reportedAtDaysAgo(65, 16),
    },
    {
      building: losAlamos,
      category: plomeria,
      unit: apartmentUnits[16],
      person: peopleRows[6],
      title: "Canilla del lavadero pierde sin parar",
      description:
        "La canilla de la pileta del lavadero de mi depto gotea desde hace una semana, ya até una bolsa pero se llena rapidísimo y tengo miedo de que se desborde.",
      priority: "medium",
      source: "public_form",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(40, 9),
      resolvedAt: reportedAtDaysAgo(37, 11),
    },
    {
      building: cabildo,
      category: plomeria,
      unit: apartmentUnits[26],
      person: peopleRows[7],
      title: "Inodoro con pérdida constante",
      description:
        "El inodoro de mi baño principal no deja de tirar agua, escucho el tanque cargando todo el día y la boleta de este mes vino altísima.",
      priority: "medium",
      source: "whatsapp",
      status: "closed",
      reportedAt: reportedAtDaysAgo(55, 14),
      resolvedAt: reportedAtDaysAgo(53, 10),
      closedAt: reportedAtDaysAgo(52, 9),
    },
    {
      building: torreCentral,
      category: plomeria,
      unitLabelRaw: "Subsuelo de cocheras",
      title: "Olor a cloaca en la cochera",
      description:
        "Desde el fin de semana hay un olor fuerte a cloaca cuando entrás al subsuelo de cocheras, cada vez es peor. Ya varios vecinos lo comentaron en el grupo.",
      priority: "high",
      source: "admin",
      status: "in_progress",
      reportedAt: reportedAtDaysAgo(4, 8),
    },
    {
      building: losAlamos,
      category: plomeria,
      unit: apartmentUnits[20],
      person: peopleRows[9],
      title: "Poca presión de agua en los pisos altos",
      description:
        "Desde hace unos días sale muy poca presión de agua en la ducha, sobre todo a la mañana. Vivimos en el piso más alto así que capaz es por eso.",
      priority: "medium",
      source: "public_form",
      status: "new",
      reportedAt: reportedAtDaysAgo(2, 7),
    },

    // --- Electricidad
    {
      building: torreCentral,
      category: electricidad,
      unitLabelRaw: "Pasillo piso 3, torre Sur",
      title: "Se corta la luz del pasillo del tercer piso",
      description:
        "El tacho de luz del pasillo del tercer piso, torre Sur, se corta solo cada dos por tres, a veces quedamos totalmente a oscuras a la noche.",
      priority: "medium",
      source: "admin",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(30, 20),
      resolvedAt: reportedAtDaysAgo(27, 15),
    },
    {
      building: cabildo,
      category: electricidad,
      unit: apartmentUnits[28],
      person: peopleRows[11],
      title: "Tomacorriente quemado en la cocina",
      description:
        "Se quemó un tomacorriente de la cocina, salió humo y un olor feo. Por las dudas desenchufé todo de esa pared, necesito que alguien lo revise urgente.",
      priority: "urgent",
      source: "whatsapp",
      status: "closed",
      reportedAt: reportedAtDaysAgo(20, 19),
      resolvedAt: reportedAtDaysAgo(19, 12),
      closedAt: reportedAtDaysAgo(18, 9),
    },
    {
      building: losAlamos,
      category: electricidad,
      unitLabelRaw: "Entrada principal",
      title: "Timbre y portero eléctrico no funcionan",
      description:
        "El portero eléctrico de la entrada no anda desde el lunes, no me puedo comunicar con las visitas ni con el delivery cuando toca timbre.",
      priority: "high",
      source: "public_form",
      status: "in_progress",
      reportedAt: reportedAtDaysAgo(3, 13),
    },

    // --- Limpieza y espacios comunes
    {
      building: torreCentral,
      category: limpieza,
      unitLabelRaw: "Hall de entrada",
      title: "El palier de entrada está siempre sucio",
      description:
        "Hace más de una semana que no se limpia el hall de entrada, hay tierra acumulada en las esquinas y el piso está pegajoso.",
      priority: "low",
      source: "admin",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(15, 11),
      resolvedAt: reportedAtDaysAgo(13, 10),
    },
    {
      building: cabildo,
      category: limpieza,
      unitLabelRaw: "Cuarto de residuos",
      title: "Falta reponer bolsas en el cuarto de residuos",
      description:
        "El cuarto de basura no tiene bolsas nuevas hace días, la gente está dejando la basura suelta y ya empezó a oler bastante mal.",
      priority: "low",
      source: "whatsapp",
      status: "closed",
      reportedAt: reportedAtDaysAgo(80, 9),
      resolvedAt: reportedAtDaysAgo(79, 14),
      closedAt: reportedAtDaysAgo(78, 9),
    },
    {
      building: losAlamos,
      category: limpieza,
      unitLabelRaw: "Entrada del edificio",
      title: "Los canteros de la entrada están abandonados",
      description:
        "Las plantas de la entrada están todas secas y hay yuyos creciendo entre las baldosas, da mala impresión a cualquiera que llega por primera vez.",
      priority: "low",
      source: "admin",
      status: "new",
      reportedAt: reportedAtDaysAgo(1, 17),
    },

    // --- Seguridad
    {
      building: torreCentral,
      category: seguridad,
      unitLabelRaw: "Garage",
      title: "La puerta del garage no cierra bien",
      description:
        "La puerta automática del garage se queda entreabierta después de que pasa un auto, cualquiera podría entrar caminando sin que nadie se dé cuenta.",
      priority: "high",
      source: "public_form",
      status: "in_progress",
      reportedAt: reportedAtDaysAgo(6, 21),
    },
    {
      building: losAlamos,
      category: seguridad,
      unitLabelRaw: "Entrada principal",
      title: "Cámara de seguridad de la entrada apagada",
      description:
        "Me fijé y la cámara que apunta a la puerta principal tiene la lucecita roja apagada, no sé si está grabando desde cuándo.",
      priority: "high",
      source: "admin",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(25, 12),
      resolvedAt: reportedAtDaysAgo(24, 10),
    },
    {
      building: cabildo,
      category: seguridad,
      unitLabelRaw: "Fondo del edificio",
      title: "Se rompió el cerco perimetral del fondo",
      description:
        "El alambrado del fondo, cerca de los tachos, tiene un agujero grande. Cualquiera podría meterse desde el terreno baldío de al lado.",
      priority: "high",
      source: "whatsapp",
      status: "new",
      reportedAt: reportedAtDaysAgo(5, 18),
    },
    {
      building: torreCentral,
      category: seguridad,
      unitLabelRaw: "Pasillo primer piso, torre Sur",
      title: "Persona desconocida dando vueltas por el edificio",
      description:
        "Vi a una persona que no conozco dando vueltas por el pasillo del primer piso, tocando timbres. No sé si era un vecino nuevo o alguien que no debería estar ahí.",
      priority: "medium",
      source: "public_form",
      status: "discarded",
      reportedAt: reportedAtDaysAgo(45, 20),
    },

    // --- Ruidos molestos
    {
      building: losAlamos,
      category: ruidos,
      unit: apartmentUnits[22],
      person: peopleRows[15],
      title: "Ruidos molestos de noche en el 5to piso",
      description:
        "Todos los fines de semana hay música fuerte y gente gritando en el depto de arriba hasta altas horas, ya no sabemos cómo pedirles que bajen el volumen.",
      priority: "medium",
      source: "public_form",
      status: "in_progress",
      reportedAt: reportedAtDaysAgo(8, 23),
    },
    {
      building: cabildo,
      category: ruidos,
      unit: apartmentUnits[29],
      person: peopleRows[17],
      title: "Obra particular arranca demasiado temprano",
      description:
        "El vecino del 2do está haciendo una reforma y los albañiles llegan a las 7 de la mañana con amoladora, nos despiertan a todos los del edificio.",
      priority: "low",
      source: "whatsapp",
      status: "discarded",
      reportedAt: reportedAtDaysAgo(60, 7),
    },

    // --- Mantenimiento general
    {
      building: torreCentral,
      category: mantenimiento,
      unitLabelRaw: "Escalera, entre 1er y 2do piso",
      title: "Baranda de la escalera floja",
      description:
        "La baranda de la escalera entre el primer y segundo piso está floja, se mueve bastante si te apoyás. Con chicos en el edificio me preocupa bastante.",
      priority: "high",
      source: "admin",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(18, 16),
      resolvedAt: reportedAtDaysAgo(16, 10),
    },
    {
      building: losAlamos,
      category: mantenimiento,
      unitLabelRaw: "Entrada de vehículos",
      title: "Se rompió el portón de entrada de autos",
      description:
        "El motor del portón de entrada de vehículos dejó de funcionar, hay que abrirlo a upper mano y pesa muchísimo, ya varios vecinos se quejaron.",
      priority: "medium",
      source: "public_form",
      status: "in_progress",
      reportedAt: reportedAtDaysAgo(7, 8),
    },
    {
      building: cabildo,
      category: mantenimiento,
      unitLabelRaw: "Terraza",
      title: "Filtración de agua en el techo de la terraza",
      description:
        "Cuando llueve fuerte se filtra agua por una parte del techo de la terraza y gotea justo donde están los tendederos, se moja toda la ropa.",
      priority: "medium",
      source: "whatsapp",
      status: "new",
      reportedAt: reportedAtDaysAgo(3, 15),
    },
    {
      building: torreCentral,
      category: mantenimiento,
      unitLabelRaw: "Pasillo cuarto piso, torre Sur",
      title: "Pintura descascarada en el pasillo",
      description:
        "La pintura del pasillo del cuarto piso, torre Sur, se está descascarando en varias partes, quedan pedazos en el piso todo el tiempo.",
      priority: "low",
      source: "admin",
      status: "closed",
      reportedAt: reportedAtDaysAgo(85, 10),
      resolvedAt: reportedAtDaysAgo(80, 11),
      closedAt: reportedAtDaysAgo(79, 9),
    },
    {
      building: losAlamos,
      category: mantenimiento,
      unitLabelRaw: "Subsuelo, cuarto de bicicletas",
      title: "Puerta del cuarto de bicicletas trabada",
      description:
        "La puerta del cuarto de bicicletas del subsuelo quedó trabada, no puedo sacar la mía para ir a trabajar y ya llegué tarde dos veces por esto.",
      priority: "low",
      source: "public_form",
      status: "new",
      reportedAt: reportedAtHoursAgo(14),
    },

    // --- Otro
    {
      building: torreCentral,
      category: otro,
      unitLabelRaw: "Consulta general",
      title: "Consulta por expensas de este mes",
      description:
        "Quería confirmar si ya está disponible la liquidación de expensas de este mes, todavía no me llegó por mail como los meses anteriores.",
      priority: "low",
      source: "public_form",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(10, 9),
      resolvedAt: reportedAtDaysAgo(9, 14),
    },
    {
      building: cabildo,
      category: otro,
      unitLabelRaw: "Consulta general",
      title: "Sugerencia: bicicletero en el subsuelo",
      description:
        "Somos varios vecinos que usamos bici y no hay dónde dejarlas seguras. ¿Se podría armar un espacio con soportes en el subsuelo del edificio?",
      priority: "low",
      source: "whatsapp",
      status: "new",
      reportedAt: reportedAtDaysAgo(9, 18),
    },
    {
      building: losAlamos,
      category: otro,
      unitLabelRaw: "Consulta general",
      title: "Consulta sobre mascotas en el reglamento",
      description:
        "Estoy por adoptar un perro y quería saber si el reglamento tiene alguna restricción de tamaño o cantidad de mascotas por departamento.",
      priority: "low",
      source: "admin",
      status: "resolved",
      reportedAt: reportedAtDaysAgo(50, 11),
      resolvedAt: reportedAtDaysAgo(49, 16),
    },
    {
      building: cabildo,
      category: otro,
      unitLabelRaw: "Consulta general",
      title: "Pregunta sobre horario de la pileta",
      description:
        "¿Cuál es el horario de uso de la pileta en verano? No lo encuentro en ningún cartel del edificio ni en el grupo de WhatsApp.",
      priority: "low",
      source: "whatsapp",
      status: "new",
      // hoursAgo, no daysAgo(0, hora fija): un offset de días=0 con una hora
      // fija podría caer en el futuro respecto al momento real de la
      // corrida si esa hora todavía no pasó hoy -- un reclamo "reportado" en
      // el futuro no tiene sentido. hoursAgo siempre da un resultado en el
      // pasado, sin importar a qué hora del día se corra el seed.
      reportedAt: reportedAtHoursAgo(2),
    },
  ];

  const ticketRows = await db
    .insert(schema.tickets)
    .values(
      ticketDefs.map((t) => ({
        organizationId: organization.id,
        buildingId: t.building.id,
        unitId: t.unit?.id ?? null,
        personId: t.person?.id ?? null,
        categoryId: t.category.id,
        unitLabelRaw: t.unit ? null : (t.unitLabelRaw ?? null),
        title: t.title,
        description: t.description,
        priority: t.priority,
        status: t.status,
        source: t.source,
        reportedAt: t.reportedAt,
        resolvedAt: t.resolvedAt ?? null,
        closedAt: t.closedAt ?? null,
      })),
    )
    .returning();
  console.log(`reclamos: ${ticketRows.length}`);

  // ---------------------------------------------------------------------
  // Eventos de línea de tiempo (en algunos reclamos) y adjuntos (en al
  // menos uno)
  // ---------------------------------------------------------------------
  const ticketByTitle = Object.fromEntries(
    ticketRows.map((t, i) => [ticketDefs[i]!.title, t]),
  );

  const eventDefs: {
    ticket: (typeof ticketRows)[number];
    type:
      | "created"
      | "status_changed"
      | "priority_changed"
      | "assigned"
      | "note_added"
      | "attachment_added"
      | "merged_into_incident"
      | "whatsapp_handoff_opened";
    actorType: "neighbor" | "admin" | "system";
    actorLabel: string;
    payload?: Record<string, unknown>;
  }[] = [];

  for (const t of ticketRows) {
    eventDefs.push({
      ticket: t,
      type: "created",
      actorType: t.source === "admin" ? "admin" : "neighbor",
      actorLabel: t.source === "admin" ? "Administración" : "Vecino",
    });
  }
  // Un par de reclamos con más historial en la línea de tiempo, para que la
  // vista de detalle tenga algo interesante que mostrar.
  const perdidaAgua =
    ticketByTitle["Mancha de humedad creciendo en el palier"]!;
  eventDefs.push(
    {
      ticket: perdidaAgua,
      type: "assigned",
      actorType: "admin",
      actorLabel: "Administración",
      payload: { assignee: "Plomero Hugo" },
    },
    {
      ticket: perdidaAgua,
      type: "note_added",
      actorType: "admin",
      actorLabel: "Administración",
      payload: {
        note: "El plomero pasó y detectó que era la cañería del depto 3B. Se coordina arreglo.",
      },
    },
    {
      ticket: perdidaAgua,
      type: "status_changed",
      actorType: "admin",
      actorLabel: "Administración",
      payload: { from: "in_progress", to: "resolved" },
    },
  );
  const ascensorTrabado =
    ticketByTitle["El ascensor se queda trabado entre pisos"]!;
  eventDefs.push({
    ticket: ascensorTrabado,
    type: "status_changed",
    actorType: "admin",
    actorLabel: "Administración",
    payload: { from: "new", to: "in_progress" },
  });

  await db.insert(schema.ticketEvents).values(
    eventDefs.map((e) => ({
      organizationId: organization.id,
      ticketId: e.ticket.id,
      type: e.type,
      actorType: e.actorType,
      actorLabel: e.actorLabel,
      payload: e.payload ?? {},
    })),
  );
  console.log(`eventos de reclamos: ${eventDefs.length}`);

  const tomacorriente = ticketByTitle["Tomacorriente quemado en la cocina"]!;
  await db.insert(schema.ticketAttachments).values([
    {
      organizationId: organization.id,
      ticketId: perdidaAgua.id,
      storagePath: "torre-central/tickets/mancha-humedad-palier.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 812_400,
      originalFilename: "foto_mancha_techo.jpg",
    },
    {
      organizationId: organization.id,
      ticketId: tomacorriente.id,
      storagePath: "edificio-cabildo/tickets/tomacorriente-quemado.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 456_200,
      originalFilename: "tomacorriente.jpg",
    },
  ]);
  console.log("adjuntos: 2");

  // ---------------------------------------------------------------------
  // 1 incidente agrupando 2 reclamos (los dos del ascensor que describen el
  // ascensor directamente sin funcionar)
  // ---------------------------------------------------------------------
  const [incident] = await db
    .insert(schema.incidents)
    .values({
      organizationId: organization.id,
      buildingId: torreCentral.id,
      categoryId: ascensores.id,
      title: "Ascensor torre Norte con fallas recurrentes",
      status: "open",
    })
    .returning();
  const trabado = ticketByTitle["El ascensor se queda trabado entre pisos"]!;
  const noAnda = ticketByTitle["No anda el ascensor desde ayer"]!;
  await db
    .update(schema.tickets)
    .set({ incidentId: incident!.id })
    .where(inArray(schema.tickets.id, [trabado.id, noAnda.id]));
  console.log(`incidente: ${incident!.title}, agrupando 2 reclamos`);

  // ---------------------------------------------------------------------
  // 2 avisos con destinatarios
  // ---------------------------------------------------------------------
  const [avisoCorte] = await db
    .insert(schema.announcements)
    .values({
      organizationId: organization.id,
      buildingId: torreCentral.id,
      title: "Corte de agua programado",
      body: "El día jueves se va a cortar el suministro de agua entre las 9 y las 13hs por trabajos de mantenimiento en la cisterna. Disculpen las molestias.",
      segment: {},
      status: "sent",
      sentAt: reportedAtDaysAgo(6, 8),
      createdBy: "Administración",
    })
    .returning();
  const [avisoAsamblea] = await db
    .insert(schema.announcements)
    .values({
      organizationId: organization.id,
      buildingId: null,
      title: "Convocatoria a asamblea ordinaria",
      body: "Se convoca a todos los propietarios a la asamblea ordinaria anual, que se va a realizar en el SUM de Torre Central. Se va a tratar el balance del último ejercicio y la renovación del consejo de administración.",
      segment: { roles: ["owner"] },
      status: "scheduled",
      scheduledFor: reportedAtDaysAgo(-10, 19),
      createdBy: "Administración",
    })
    .returning();

  // El destinatario "skipped" es a propósito alguien sin teléfono cargado
  // (peopleRows[12], ver NO_PHONE_INDEXES) -- es la razón real por la que se
  // lo excluye del envío, no un valor arbitrario.
  const recipientDefs = [
    {
      announcement: avisoCorte!,
      person: peopleRows[0]!,
      status: "link_opened" as const,
    },
    {
      announcement: avisoCorte!,
      person: peopleRows[1]!,
      status: "link_opened" as const,
    },
    {
      announcement: avisoCorte!,
      person: peopleRows[2]!,
      status: "pending" as const,
    },
    {
      announcement: avisoCorte!,
      person: peopleRows[12]!,
      status: "skipped" as const,
    },
    {
      announcement: avisoAsamblea!,
      person: peopleRows[6]!,
      status: "pending" as const,
    },
    {
      announcement: avisoAsamblea!,
      person: peopleRows[9]!,
      status: "link_opened" as const,
    },
    {
      announcement: avisoAsamblea!,
      person: peopleRows[11]!,
      status: "pending" as const,
    },
  ];
  await db.insert(schema.announcementRecipients).values(
    recipientDefs.map((r) => ({
      organizationId: organization.id,
      announcementId: r.announcement.id,
      personId: r.person.id,
      deliveryStatus: r.status,
      sentAt: r.status === "link_opened" ? reportedAtDaysAgo(6, 9) : null,
      phoneSnapshot: r.person.phoneE164,
    })),
  );
  console.log(`avisos: 2, destinatarios: ${recipientDefs.length}`);

  // ---------------------------------------------------------------------
  // 4 recordatorios (vencido, próximo, dos lejanos). `noticeDays` es la
  // columna PUENTE (= umbral más grande, lo que lee el semáforo/campana/
  // resumen); los umbrales reales viven en `reminder_notice_thresholds`,
  // poblados abajo -- dos recordatorios con un solo umbral, uno con dos,
  // uno con tres, para que un dev recién sembrado vea el caso completo.
  // ---------------------------------------------------------------------
  const seededReminders = await db
    .insert(schema.reminders)
    .values([
      {
        organizationId: organization.id,
        buildingId: torreCentral.id,
        title: "Recarga de matafuegos",
        description:
          "Recarga anual obligatoria de los matafuegos de todo el edificio, incluidas cocheras.",
        dueDate: dueDateOffsetDays(-20),
        recurrence: "annual",
        noticeDays: 15,
        status: "notified",
        lastNotifiedAt: reportedAtDaysAgo(25, 9),
      },
      {
        organizationId: organization.id,
        buildingId: losAlamos.id,
        title: "Fumigación trimestral",
        description: "Fumigación de espacios comunes y cocheras contra plagas.",
        dueDate: dueDateOffsetDays(5),
        recurrence: "quarterly",
        noticeDays: 7,
        status: "pending",
      },
      {
        organizationId: organization.id,
        buildingId: torreCentral.id,
        title: "Service anual de ascensores",
        description:
          "Mantenimiento preventivo anual de los dos ascensores, según contrato con la empresa proveedora.",
        dueDate: dueDateOffsetDays(240),
        recurrence: "annual",
        noticeDays: 30,
        status: "pending",
      },
      {
        organizationId: organization.id,
        buildingId: cabildo.id,
        title: "Limpieza de tanque de agua",
        description:
          "Limpieza y desinfección semestral del tanque de agua, exigida por normativa municipal.",
        dueDate: dueDateOffsetDays(150),
        recurrence: "biannual",
        noticeDays: 10,
        status: "pending",
      },
      {
        // Evento "General": sin edificio (building_id NULL). Una tarea
        // administrativa de toda la organización, no de un edificio puntual.
        organizationId: organization.id,
        buildingId: null,
        title: "Vencimiento de la matrícula del administrador",
        description:
          "Renovar la matrícula profesional ante el registro público de administradores.",
        dueDate: dueDateOffsetDays(20),
        recurrence: "annual",
        noticeDays: 30,
        status: "pending",
      },
    ])
    .returning({ id: schema.reminders.id });

  // Umbrales por recordatorio, en el MISMO orden que el array de arriba.
  // El mayor de cada lista coincide con el `noticeDays` puente de su
  // recordatorio.
  const seededThresholdsByReminder: number[][] = [
    [15],
    [7, 3, 0],
    [30, 7],
    [10],
    [30, 7],
  ];
  await db.insert(schema.reminderNoticeThresholds).values(
    seededReminders.flatMap((reminder, index) =>
      seededThresholdsByReminder[index]!.map((days) => ({
        organizationId: organization.id,
        reminderId: reminder.id,
        noticeDays: days,
      })),
    ),
  );
  console.log("recordatorios: 5 (uno General, sin edificio)");

  // ---------------------------------------------------------------------
  // 3 documentos (visibilidades: solo hay dos valores posibles en el enum,
  // private/residents -- "tres visibilidades distintas" no es posible con
  // solo 2 opciones. Hice 1 private + 2 residents.)
  // ---------------------------------------------------------------------
  await db.insert(schema.documents).values([
    {
      organizationId: organization.id,
      buildingId: torreCentral.id,
      // Valores en inglés del enum de aplicación (DOCUMENT_CATEGORIES,
      // src/features/documents/document-schema.ts) -- alineado en el paso
      // 10.2 (el explorador filtra por estos valores; los strings en
      // español que había antes no matcheaban ningún filtro). Ver
      // CLAUDE.md > Explorador de documentos.
      category: "regulations",
      title: "Reglamento de copropiedad",
      description: "Reglamento interno del consorcio, versión vigente.",
      storagePath: "torre-central/documents/reglamento-copropiedad.pdf",
      mimeType: "application/pdf",
      sizeBytes: 1_240_000,
      originalFilename: "reglamento_copropiedad.pdf",
      visibility: "residents",
      uploadedBy: "Administración",
    },
    {
      organizationId: organization.id,
      buildingId: losAlamos.id,
      category: "balance_sheets",
      title: "Balance mensual julio 2026",
      description:
        "Rendición de cuentas y balance de ingresos y egresos del mes.",
      storagePath: "los-alamos/documents/balance-julio-2026.pdf",
      mimeType: "application/pdf",
      sizeBytes: 340_500,
      originalFilename: "balance_julio_2026.pdf",
      visibility: "private",
      uploadedBy: "Administración",
    },
    {
      organizationId: organization.id,
      buildingId: torreCentral.id,
      category: "minutes",
      title: "Acta de asamblea ordinaria 2025",
      description: "Acta firmada de la última asamblea ordinaria realizada.",
      storagePath: "torre-central/documents/acta-asamblea-2025.pdf",
      mimeType: "application/pdf",
      sizeBytes: 210_800,
      originalFilename: "acta_asamblea_2025.pdf",
      visibility: "residents",
      uploadedBy: "Administración",
    },
  ]);
  console.log("documentos: 3");

  // ---------------------------------------------------------------------
  // app_users: vincula un usuario de Supabase Auth con esta organización.
  // El seed NO puede crear el usuario de auth.users -- eso vive en un
  // esquema que administra Supabase, y además el paso 3.1 pide
  // explícitamente crearlo a mano desde el dashboard, no por script. Por
  // eso esto es opcional y condicional a una variable de entorno: si no
  // está seteada, se lo salta con un aviso en vez de fallar todo el seed
  // (el resto de los datos no depende de que exista un admin).
  const adminUserId = process.env.SEED_ADMIN_USER_ID;
  if (adminUserId) {
    const adminDisplayName =
      process.env.SEED_ADMIN_DISPLAY_NAME ?? "Administrador";
    // Paso 9.5: app_users.email es NOT NULL (a dónde manda el resumen
    // diario y las alertas de reclamo urgente por email -- ver
    // CLAUDE.md > Envío de emails). El seed NO lo resuelve solo contra
    // Supabase Auth (mismo motivo que no crea el usuario de Auth: ese
    // paso es manual a propósito) -- lo tipea quien corre el seed, con el
    // MISMO email que acaba de cargar a mano en el dashboard al crear el
    // usuario. Falla fuerte y clara si falta, en vez de dejar que el
    // INSERT reviente con el error genérico de un NOT NULL.
    const adminEmail = process.env.SEED_ADMIN_EMAIL;
    if (!adminEmail) {
      throw new Error(
        "SEED_ADMIN_USER_ID está seteada pero falta SEED_ADMIN_EMAIL -- app_users.email es obligatoria (paso 9.5). Usá el mismo email con el que creaste el usuario en el dashboard de Supabase Auth.",
      );
    }
    await db.insert(schema.appUsers).values({
      id: adminUserId,
      organizationId: organization.id,
      displayName: adminDisplayName,
      email: adminEmail.toLowerCase(),
      role: "admin",
    });
    console.log(
      `app_users: 1 (${adminDisplayName}, ${adminEmail}, ${adminUserId})`,
    );
  } else {
    console.log(
      "app_users: 0 (SEED_ADMIN_USER_ID no seteada -- ver CLAUDE.md > Datos de prueba (seed) para los pasos de creación manual)",
    );
  }

  console.log("\n--- seed completo ---");
  await sql.end({ timeout: 5 });
}

main().catch(async (err) => {
  console.error(err);
  process.exit(1);
});

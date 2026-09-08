import { formatDistanceToNow } from "date-fns";
import { es } from "date-fns/locale";

// Tiempo relativo ("hace 2 días"): es una duración pura entre dos instantes
// (Date.now() y `date`), no depende de en qué zona horaria se MUESTRE --
// por eso no recibe timezone. locale "es" de date-fns ya da la forma
// correcta en español rioplatense para esto (no hay voseo que aplicar acá,
// no es una orden dirigida al usuario -- ver CLAUDE.md > Voz y escritura).
export function formatRelativeDate(date: Date): string {
  return formatDistanceToNow(date, { locale: es, addSuffix: true });
}

// Fecha exacta, SIEMPRE en la zona horaria de la organización -- nunca UTC
// (el dato crudo en la base) ni la del navegador de quien mira la pantalla
// (que puede no coincidir con la del edificio real). `Intl.DateTimeFormat`
// con `timeZone` hace la conversión sin depender de una librería aparte
// (no hace falta date-fns-tz): Node y los navegadores ya soportan IANA
// timezones de forma nativa.
export function formatExactDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    dateStyle: "long",
    timeStyle: "short",
  }).format(date);
}

// Fecha larga SOLO fecha, sin hora ("27 de agosto de 2026") -- para
// encabezados/asuntos de email. Vivía como helper privado en
// send-daily-summary-email.ts hasta que apareció el segundo consumidor
// (send-reminder-thresholds-email.ts, paso 3 de "múltiples umbrales"):
// mismo criterio de extracción que el resto del proyecto (ver el
// comentario de formatDueDate en reminders/format-due-date.ts). SIEMPRE
// en la zona horaria de la organización, nunca UTC ni la del navegador.
export function formatLongDate(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("es-AR", {
    timeZone: timezone,
    dateStyle: "long",
  }).format(date);
}

// Offset UTC de una zona IANA en un instante dado, en minutos (ej. -180
// para GMT-03:00) -- se resuelve por instante, no una constante fija, para
// que zonas con horario de verano den el offset correcto según la fecha.
// `longOffset` (Intl, sin dependencia nueva) devuelve un string tipo
// "GMT-03:00" que se parsea a mano.
function getTimezoneOffsetMinutes(date: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    timeZoneName: "longOffset",
  }).formatToParts(date);
  const offsetPart = parts.find((p) => p.type === "timeZoneName")?.value;
  const match = offsetPart?.match(/GMT([+-])(\d{2}):(\d{2})/);
  if (!match) {
    return 0;
  }
  const sign = match[1] === "-" ? -1 : 1;
  return sign * (Number(match[2]) * 60 + Number(match[3]));
}

// "YYYY-MM-DD" en la zona horaria de la organización -- para nombres de
// archivo que necesitan una fecha civil corta (paso 6.7, exportación CSV:
// "reclamos-2026-08-21.csv"), sin agregar date-fns-tz (mismo criterio que
// el resto del archivo: Intl ya alcanza). El locale "en-CA" es el truco ya
// conocido para que Intl.DateTimeFormat devuelva directo el orden
// año-mes-día con guiones, sin parsear a mano el resultado de "es-AR"
// (que da día/mes/año).
export function formatDateSlug(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

// Convierte una fecha CIVIL ("YYYY-MM-DD", tal como la tipea el
// administrador en un filtro de rango) al instante UTC real de "inicio" y
// "fin" de ese día EN LA ZONA DE LA ORGANIZACIÓN -- nunca UTC ni la del
// navegador (mismo criterio que el resto de este archivo). Necesario para
// que un filtro "hasta el 15/08" incluya reclamos reportados esa noche en
// la zona del edificio, aunque en UTC ya sea 16/08. Se resuelve el offset
// al mediodía UTC de ese día (no a medianoche) para no arriesgar un
// corrimiento de fecha al aplicar el offset antes de tenerlo.
export function zonedDayBoundsToUtc(
  dateStr: string,
  timezone: string,
): { start: Date; end: Date } {
  const [year, month, day] = dateStr.split("-").map(Number) as [
    number,
    number,
    number,
  ];
  const noonUtc = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  const offsetMinutes = getTimezoneOffsetMinutes(noonUtc, timezone);
  const start = new Date(
    Date.UTC(year, month - 1, day, 0, 0, 0) - offsetMinutes * 60_000,
  );
  const end = new Date(
    Date.UTC(year, month - 1, day, 23, 59, 59, 999) - offsetMinutes * 60_000,
  );
  return { start, end };
}

import {
  Bell,
  CalendarClock,
  ClipboardList,
  FileText,
  LayoutDashboard,
  type LucideIcon,
  Megaphone,
  MessageSquare,
  QrCode,
} from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

// Landing pública (Etapa 16, paso 16.3). Copy cerrado en el 16.1 (ver
// CLAUDE.md > Landing page pública), tokens `--landing-*` del 16.2
// (globals.css > `.landing-theme`). Server Component puro -- solo links,
// sin estado.
//
// Estilos: layout con utilidades de Tailwind (grid/flex/spacing), y los
// tokens de la landing por `style` inline (mismo patrón que la prueba del
// 16.2 en /dev/landing-tokens). NO se agregó CSS a globals.css: el
// acotamiento sigue siendo el `.landing-theme` del 16.2, sin tocar.
//
// El SEO completo (Open Graph, sitemap) es el 16.4; la auditoría de
// accesibilidad completa es el 16.5. Acá: un solo <h1>, h2/h3 por
// jerarquía, landmarks (<header>/<main>/<footer>), foco visible con el
// anillo del token, e íconos decorativos (`aria-hidden`) de `lucide-react`
// (la librería que ya usa el resto del proyecto).

const CONTACT_MAILTO =
  "mailto:matiasdemetriorufeil@gmail.com?subject=Quiero%20probar%20Consorfy";
const CONTACT_EMAIL = "matiasdemetriorufeil@gmail.com";

const s = {
  wordmark: {
    fontFamily: "var(--landing-font-heading)",
    fontWeight: "var(--landing-weight-heading)",
    fontSize: "var(--landing-text-h3)",
    letterSpacing: "var(--landing-tracking-tight)",
    color: "var(--landing-text)",
  },
  h1: {
    fontFamily: "var(--landing-font-heading)",
    fontWeight: "var(--landing-weight-heading)",
    fontSize: "var(--landing-text-hero)",
    lineHeight: "var(--landing-leading-tight)",
    letterSpacing: "var(--landing-tracking-tight)",
    color: "var(--landing-text)",
  },
  h2: {
    fontFamily: "var(--landing-font-heading)",
    fontWeight: "var(--landing-weight-strong)",
    fontSize: "var(--landing-text-h2)",
    lineHeight: "var(--landing-leading-snug)",
    letterSpacing: "var(--landing-tracking-tight)",
    color: "var(--landing-text)",
  },
  h3: {
    fontFamily: "var(--landing-font-heading)",
    fontWeight: "var(--landing-weight-strong)",
    fontSize: "var(--landing-text-h3)",
    lineHeight: "var(--landing-leading-snug)",
    color: "var(--landing-text)",
  },
  lead: {
    fontSize: "var(--landing-text-lead)",
    lineHeight: "var(--landing-leading-normal)",
    color: "var(--landing-text-muted)",
  },
  body: {
    fontSize: "var(--landing-text-body)",
    lineHeight: "var(--landing-leading-normal)",
    color: "var(--landing-text-muted)",
  },
  small: {
    fontSize: "var(--landing-text-small)",
    lineHeight: "var(--landing-leading-normal)",
    color: "var(--landing-text-muted)",
  },
  ctaPrimary: {
    backgroundColor: "var(--landing-accent)",
    color: "var(--landing-accent-fg)",
    fontWeight: "var(--landing-weight-strong)",
    fontSize: "var(--landing-text-body)",
  },
  linkStrong: {
    color: "var(--landing-accent-strong)",
    fontWeight: "var(--landing-weight-strong)",
  },
  heroBg: { backgroundColor: "var(--landing-hero-bg)" },
  subtleBg: { backgroundColor: "var(--landing-bg-subtle)" },
  surface: { backgroundColor: "var(--landing-surface)" },
  border: { borderColor: "var(--landing-border)" },
  icon: { color: "var(--landing-accent)" },
} satisfies Record<string, CSSProperties>;

// Foco visible (auditado en el 16.5): anillo sólido de 2px con el token
// `--landing-ring` en `:focus-visible` (solo teclado). SIN `outline-none`:
// en Tailwind v4 `outline-none` pone `--tw-outline-style: none`, y como las
// utilidades `outline-<n>` resuelven el estilo con `var(--tw-outline-style)`,
// dejaba el anillo con ancho y color pero `outline-style: none` -> NO se
// veía (confirmado midiendo `getComputedStyle` durante el foco). Sin esa
// clase, el estilo queda en `solid` (el default de Tailwind) y el anillo
// se ve. En reposo / click con mouse no aparece nada (`:focus-visible`, no
// `:focus`). `[color:...]` desambigua que el valor arbitrario es color de
// outline.
const FOCUS =
  "rounded-[6px] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--landing-ring)]";

function PrimaryCta({
  children = "Solicitá una prueba gratuita",
}: {
  children?: ReactNode;
}) {
  return (
    <a
      href={CONTACT_MAILTO}
      style={s.ctaPrimary}
      className={`inline-flex items-center justify-center gap-2 rounded-[10px] px-6 py-3.5 ${FOCUS}`}
    >
      {children}
    </a>
  );
}

function IngresarLink() {
  // `py-2`: sin padding el link mide ~26px de alto -- pasa el mínimo de
  // WCAG 2.2 (24px) pero es chico para tap en mobile. Con `py-2` queda
  // ~42px, cómodo, sin afectar el layout (el header/hero/footer lo
  // absorben). Paso 16.5.
  return (
    <a
      href="/login"
      style={s.linkStrong}
      className={`inline-flex py-2 ${FOCUS}`}
    >
      Ingresar
    </a>
  );
}

type Item = { icon: LucideIcon; title: string; body: string };

const STEPS: Item[] = [
  {
    icon: QrCode,
    title: "Un link por edificio",
    body: "Compartís el link del edificio o pegás su QR en la entrada. El vecino no instala ni registra nada.",
  },
  {
    icon: ClipboardList,
    title: "El vecino carga el reclamo",
    body: "Cuatro pasos: quién es, qué departamento, qué pasa y fotos si quiere. Recibe un código para seguirlo después, sin llamarte.",
  },
  {
    icon: MessageSquare,
    title: "Vos te enterás",
    body: "El vecino te avisa por WhatsApp con un mensaje ya redactado, desde su propio teléfono. Si no lo hace, el reclamo igual aparece en tu panel; y te llega un mail al instante si es urgente, más un resumen todos los días.",
  },
  {
    icon: LayoutDashboard,
    title: "Lo gestionás desde el panel",
    body: "Bandeja con filtros y estados, asignación, notas internas y exportación. Consorfy marca posibles reclamos repetidos y te deja agruparlos como un solo problema.",
  },
];

const FEATURES: Item[] = [
  {
    icon: Megaphone,
    title: "Avisos a los vecinos",
    body: "Armás el mensaje una vez y Consorfy te arma la lista de destinatarios por edificio o por criterio, con un enlace de WhatsApp listo para cada uno.",
  },
  {
    icon: CalendarClock,
    title: "Eventos",
    body: "Vencimientos por edificio (expensas, seguros, service de ascensor) con vista de calendario y aviso cuando se acercan.",
  },
  {
    icon: FileText,
    title: "Biblioteca de documentos",
    body: "Reglamentos, actas y comprobantes por edificio y categoría, con control de qué ve cada vecino.",
  },
  {
    icon: Bell,
    title: "Notificaciones",
    body: "Una campana en el panel con lo nuevo: reclamos, urgencias, vencimientos.",
  },
];

const PROBLEMS = [
  "Los reclamos llegan mezclados entre mensajes personales, audios y reenvíos. No hay forma de ver cuáles siguen abiertos.",
  "La información importante del edificio queda en una planilla que actualiza una sola persona, cuando se acuerda.",
  "El vecino escribe, nadie le confirma nada, y no sabe si su reclamo llegó a algún lado. Los reclamos se pierden y la bronca queda.",
];

function IconBadge({ icon: Icon }: { icon: LucideIcon }) {
  return (
    <span
      className="flex size-10 shrink-0 items-center justify-center rounded-lg border"
      style={{ ...s.surface, ...s.border }}
    >
      <Icon aria-hidden="true" className="size-5" style={s.icon} />
    </span>
  );
}

export function LandingPage() {
  return (
    <div className="landing-theme flex min-h-dvh flex-col">
      <header className="border-b" style={s.border}>
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-6 py-4">
          <span style={s.wordmark}>Consorfy</span>
          <IngresarLink />
        </div>
      </header>

      <main className="flex-1">
        {/* 1. Hero -- único bloque con fondo azul */}
        <section style={s.heroBg}>
          <div className="mx-auto w-full max-w-5xl px-6 py-16 sm:py-20">
            <div className="max-w-3xl">
              <h1 style={s.h1}>
                Los reclamos de tu edificio, en orden y en un solo lugar.
              </h1>
              <p style={s.lead} className="mt-4 max-w-2xl">
                Consorfy le da a cada edificio un link para que los vecinos
                carguen sus reclamos, y a vos un panel donde ves todo, cambiás
                estados y no se te pierde nada.
              </p>
              <div className="mt-8 flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:gap-5">
                <PrimaryCta />
                <IngresarLink />
              </div>
            </div>
          </div>
        </section>

        {/* 2. El problema */}
        <section
          aria-labelledby="landing-problema"
          className="mx-auto w-full max-w-5xl px-6 py-16"
        >
          <h2 id="landing-problema" style={s.h2} className="max-w-3xl">
            Administrar un consorcio no debería vivir en un chat de WhatsApp.
          </h2>
          <ul className="mt-6 flex max-w-2xl flex-col gap-4">
            {PROBLEMS.map((p) => (
              <li key={p} style={s.body}>
                {p}
              </li>
            ))}
          </ul>
        </section>

        {/* 3. Cómo funciona */}
        <section aria-labelledby="landing-como-funciona" style={s.subtleBg}>
          <div className="mx-auto w-full max-w-5xl px-6 py-16">
            <h2 id="landing-como-funciona" style={s.h2}>
              Cómo funciona
            </h2>
            <ol className="mt-8 grid gap-8 sm:grid-cols-2">
              {STEPS.map((step, i) => (
                <li key={step.title} className="flex gap-4">
                  <IconBadge icon={step.icon} />
                  <div>
                    <h3 style={s.h3}>
                      <span aria-hidden="true" style={s.linkStrong}>
                        {i + 1}.{" "}
                      </span>
                      {step.title}
                    </h3>
                    <p style={s.body} className="mt-1.5">
                      {step.body}
                    </p>
                  </div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* 4. Para quién es */}
        <section
          aria-labelledby="landing-para-quien"
          className="mx-auto w-full max-w-5xl px-6 py-16"
        >
          <h2 id="landing-para-quien" style={s.h2}>
            Para administraciones de consorcios.
          </h2>
          <p style={s.lead} className="mt-4 max-w-2xl">
            Da igual si administrás un edificio o veinte. Consorfy centraliza
            los reclamos de todos, con la información de cada edificio, sus
            departamentos y sus vecinos en un mismo lugar. Los vecinos no
            necesitan cuenta: solo el link.
          </p>
        </section>

        {/* 5. Más que reclamos */}
        <section aria-labelledby="landing-mas" style={s.subtleBg}>
          <div className="mx-auto w-full max-w-5xl px-6 py-16">
            <h2 id="landing-mas" style={s.h2}>
              Más que reclamos
            </h2>
            <ul className="mt-8 grid gap-8 sm:grid-cols-2">
              {FEATURES.map((f) => (
                <li key={f.title} className="flex gap-4">
                  <IconBadge icon={f.icon} />
                  <div>
                    <h3 style={s.h3}>{f.title}</h3>
                    <p style={s.body} className="mt-1.5">
                      {f.body}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 6. Cómo empezar */}
        <section
          aria-labelledby="landing-empezar"
          className="mx-auto w-full max-w-5xl px-6 py-16"
        >
          <h2 id="landing-empezar" style={s.h2}>
            Probá Consorfy en tu administración.
          </h2>
          <p style={s.body} className="mt-4 max-w-2xl">
            Escribinos y coordinamos una prueba: configuramos tu administración
            con tus edificios y te dejamos el sistema andando para que lo uses
            con reclamos reales.
          </p>
          <div className="mt-8">
            <PrimaryCta />
          </div>
        </section>
      </main>

      {/* 7. Footer */}
      <footer className="border-t" style={s.border}>
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 px-6 py-10 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <span style={s.wordmark}>Consorfy</span>
            <p style={s.small} className="mt-1">
              Gestión de consorcios para administradores.
            </p>
          </div>
          <div className="flex flex-col gap-1 sm:items-end">
            <IngresarLink />
            <a
              href={CONTACT_MAILTO}
              style={s.linkStrong}
              className={`inline-flex py-2 ${FOCUS}`}
            >
              {CONTACT_EMAIL}
            </a>
            <span style={s.small} className="mt-1">
              © 2026 Consorfy
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}

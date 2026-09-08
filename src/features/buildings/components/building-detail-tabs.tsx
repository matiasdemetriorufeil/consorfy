"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

import { cn } from "@/lib/utils";

const TABS = [
  { segment: "units", label: "Unidades" },
  { segment: "people", label: "Personas" },
  { segment: "tickets", label: "Reclamos" },
  { segment: "documents", label: "Documentos" },
  { segment: "reminders", label: "Eventos" },
  { segment: "public-link", label: "Enlace público" },
] as const;

// Navegación por pestañas de la vista de detalle (paso 4.2, punto 3): cada
// pestaña es una ruta real (/panel/buildings/[id]/unidades, etc.), no un
// estado de cliente -- así el link de una pestaña puntual se puede
// compartir y "atrás" del navegador funciona sin nada especial (pedido
// explícito del paso). Por eso esto NO usa el componente compartido
// <Tabs> (src/components/ui/tabs.tsx, primitiva de Radix): esa primitiva
// modela un "tablist" ARIA -- paneles que cambian con JS dentro de la
// MISMA página, sin recargar ni navegar. Acá cada "pestaña" es una
// navegación de página real, así que semánticamente es un <nav> con
// links, no un tablist; usar Radix Tabs solo por la forma visual hubiera
// significado pelear con su manejo de foco/selección pensado para el otro
// caso.
//
// Mobile (punto 4 del paso): las seis etiquetas (agregada "Enlace público"
// en el paso 4.6) no entran en una fila a 375px. En vez de un selector
// aparte para mobile (una interacción distinta a mantener), la tira de
// pestañas scrollea horizontal (overflow-x-auto + w-max en la lista para
// que no se compriman) -- mismo patrón que usan GitHub/Twitter en mobile
// para tabs de navegación: se mantiene la misma interacción (tocar la
// pestaña) en los dos tamaños, solo cambia si entran todas a la vista o
// hay que deslizar.
//
// "Enlace público" al final, no reordenado por frecuencia de uso: el
// administrador la visita una sola vez por edificio (al arrancar, para
// imprimir el QR), a diferencia de las demás pestañas que se revisan todo
// el tiempo -- ponerla última la saca del camino sin esconderla ni
// obligar a un mecanismo de descubrimiento aparte (ver el comentario de
// public-link/page.tsx sobre por qué es una pestaña y no un diálogo).
export function BuildingDetailTabs({ buildingId }: { buildingId: string }) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Secciones del edificio"
      className="border-border -mx-4 overflow-x-auto border-b px-4 sm:mx-0 sm:px-0"
    >
      <ul className="flex w-max min-w-full gap-1">
        {TABS.map((tab) => {
          const href = `/panel/buildings/${buildingId}/${tab.segment}`;
          const active = pathname === href;
          return (
            <li key={tab.segment}>
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "text-ink-muted hover:text-ink focus-visible:ring-ring/50 inline-flex items-center border-b-2 border-transparent px-3 py-2 text-sm font-medium whitespace-nowrap outline-none focus-visible:ring-3",
                  active && "border-primary text-ink",
                )}
              >
                {tab.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

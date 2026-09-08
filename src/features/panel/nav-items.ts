import {
  Building2,
  CalendarClock,
  FileText,
  Home,
  Inbox,
  Megaphone,
  Settings,
  type LucideIcon,
} from "lucide-react";

export type PanelNavItem = {
  href: string;
  label: string;
  icon: LucideIcon;
};

// Nombres del glosario (CLAUDE.md > Glosario), no los del código: la
// persona que usa esto piensa "reclamos", no "tickets". El orden es fijo
// a propósito -- ver CLAUDE.md, contexto del paso 3.4: la navegación tiene
// que quedarse quieta para que se pueda recordar dónde está cada cosa en
// vez de tener que leerlo cada vez.
export const panelNavItems: PanelNavItem[] = [
  { href: "/panel", label: "Inicio", icon: Home },
  { href: "/panel/tickets", label: "Reclamos", icon: Inbox },
  { href: "/panel/buildings", label: "Edificios", icon: Building2 },
  { href: "/panel/announcements", label: "Comunicados", icon: Megaphone },
  { href: "/panel/reminders", label: "Eventos", icon: CalendarClock },
  { href: "/panel/documents", label: "Documentos", icon: FileText },
  { href: "/panel/settings", label: "Configuración", icon: Settings },
];

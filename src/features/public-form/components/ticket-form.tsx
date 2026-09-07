"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { type ChangeEvent, useEffect, useMemo, useRef, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import {
  Check,
  Copy,
  CircleCheck,
  File as FileIcon,
  MessageCircle,
  RotateCw,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { PhoneNumberInput } from "@/components/phone-number-input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import {
  formatTicketMessage,
  type TicketMessageInput,
  type TicketMessagePriority,
} from "@/features/tickets/format-ticket-message";
import { AR_WHATSAPP_HELP } from "@/lib/phone";
import { cn } from "@/lib/utils";
import { BuildWhatsAppUrlError, buildWhatsAppUrl } from "@/lib/whatsapp-url";

import {
  createTicketAction,
  registerWhatsappHandoffOpenedAction,
} from "../actions";
import type { PublicFormCategory } from "../queries";
import {
  HONEYPOT_FIELD_NAME,
  IDENTIFICATION_STEP_FIELDS,
  MAX_TICKET_PHOTOS,
  initialCreateTicketState,
  type CreateTicketState,
  PROBLEM_STEP_FIELDS,
  PUBLIC_TICKET_STEPS,
  TOTAL_STEPS,
  publicTicketFormSchema,
  validateAttachmentType,
  type PublicTicketFormInput,
} from "../ticket-schema";
import {
  AttachmentUploadError,
  formatBytes,
  uploadFormAttachment,
  deleteFormAttachment,
} from "../upload-attachment";
import {
  formatUnitLabel,
  UnitCombobox,
  type PublicFormUnit,
} from "./unit-combobox";

// Esta pantalla es, por diseño, la única que vive en el celular de un
// vecino (CLAUDE.md > Qué es este proyecto). Los primitivos de UI del
// proyecto (Input/Button/SelectTrigger) están calibrados para la densidad
// del panel -- ~32px de alto (`h-8`), cómodo con mouse, chico para un
// pulgar. Acá se suben a ~44px con un selector de descendiente sobre el
// contenedor del formulario, sin tocar los primitivos compartidos ni
// repetir una clase en cada control. `min-h-*` (no `h-*`) para no pelear
// con la especificidad de `data-[size=default]:h-8` del SelectTrigger.
const TOUCH_TARGETS =
  "[&_[data-slot=input]]:min-h-11 [&_[data-slot=button]]:min-h-11 [&_[data-slot=select-trigger]]:min-h-11";

const DEFAULT_VALUES: PublicTicketFormInput = {
  firstName: "",
  lastName: "",
  // Vacío: el "+54" lo muestra PhoneNumberInput como etiqueta fija, no es
  // parte del valor guardado. Con la parte editable vacía, este campo
  // llega vacío a requiredPhoneSchema (../ticket-schema.ts) y la
  // validación lo rechaza igual que siempre -- el teléfono acá es
  // obligatorio.
  phoneE164: "",
  unitNotListed: false,
  unitId: null,
  unitLabelRaw: "",
  categoryId: "",
  description: "",
};

// Namespace por token, no global -- dos edificios distintos (dos pestañas,
// o el mismo celular usado para cargar un reclamo en cada uno) no se pisan
// el borrador. Ver el comentario largo más abajo sobre qué se guarda y qué
// no.
function draftKey(token: string): string {
  return `consorfy:reclamo-borrador:${token}`;
}

// Paso 5.8: registro del ÚLTIMO reclamo que este dispositivo mandó para
// ESTE edificio -- clave DISTINTA de draftKey, con un propósito distinto.
// El borrador es "lo que estoy escribiendo todavía"; esto es "lo que ya
// mandé de verdad". Se escribe apenas createTicketAction devuelve éxito, y
// se lee ANTES que el borrador en el efecto de hidratación de más abajo:
// si existe, la pantalla de confirmación se reconstruye directo desde acá
// (recorriendo formatTicketMessage/buildWhatsAppUrl de nuevo con los mismos
// datos), sin volver a mostrar el formulario -- así, recargar la página o
// volver con el botón "atrás" del navegador después de enviar NUNCA
// reabre un formulario vacío listo para mandar el MISMO reclamo dos veces.
// La única forma de volver a ver el formulario para este token es
// "Cargar otro reclamo" (ver startNewTicket), una acción explícita que
// borra esta clave a propósito.
function sentKey(token: string): string {
  return `consorfy:reclamo-enviado:${token}`;
}

// Todo lo que formatTicketMessage necesita para reconstruir el mensaje
// exacto, MENOS buildingName (llega como prop, no hace falta duplicarlo
// acá). `priority` viene del servidor (ver CreateTicketState en
// ticket-schema.ts): es la única pieza que el cliente no puede reconstruir
// por su cuenta, porque sale de categories.default_priority y el
// formulario público nunca le pregunta la prioridad al vecino.
type SentTicket = {
  publicCode: string;
  priority: TicketMessagePriority;
  neighborFirstName: string;
  neighborLastName: string | null;
  unitLabel: string;
  categoryName: string;
  description: string;
  attachmentsCount: number;
  // Credencial del link de la galería de fotos (paso 5.10) -- viene del
  // servidor (createTicketAction), igual que priority: es
  // tickets.attachments_token, generado por la base, no algo que el
  // cliente pueda inventar. Reemplaza a publicCode como identificador de
  // la ruta /s/[token] -- ver el comentario de este campo en
  // TicketMessageInput (format-ticket-message.ts) para el motivo.
  attachmentsToken: string;
};

// Estado de cada adjunto (paso 5.4): "queued" -> "processing" (comprimiendo
// o subiendo) -> "uploaded" | "error". `file` SOLO existe mientras dura
// esta misma sesión de pestaña -- no se persiste (ver el borrador más
// abajo), así que un item restaurado después de recargar la página nunca
// puede volver a "processing": si no llegó a "uploaded" antes de cerrar el
// navegador, se pierde -- mismo trade-off que el paso 5.2 ya documentó para
// fotos, ahora acotado solo al tiempo real de subida (segundos), no a todo
// el formulario.
type AttachmentStatus = "queued" | "processing" | "uploaded" | "error";

type AttachmentItem = {
  id: string;
  file: File | null;
  status: AttachmentStatus;
  path: string | null;
  originalFilename: string;
  sizeBytes: number;
  mimeType: string;
  errorMessage: string | null;
};

type PersistedAttachment = Omit<AttachmentItem, "file">;

function stripFile(item: AttachmentItem): PersistedAttachment {
  const {
    id,
    status,
    path,
    originalFilename,
    sizeBytes,
    mimeType,
    errorMessage,
  } = item;
  return {
    id,
    status,
    path,
    originalFilename,
    sizeBytes,
    mimeType,
    errorMessage,
  };
}

type Draft = {
  step: number;
  values: PublicTicketFormInput;
  formSessionId: string;
  attachments: PersistedAttachment[];
};

// Barra de progreso mínima (sin depender de un componente ui/progress
// nuevo): dos divs, ancho por porcentaje. Accesible con role="progressbar"
// -- no hace falta más para lo que pide el paso 5.2 ("el vecino tiene que
// saber cuánto le falta").
function StepProgress({ step }: { step: number }) {
  const percent = Math.round((step / TOTAL_STEPS) * 100);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="text-ink-muted text-xs">
        Paso {step} de {TOTAL_STEPS}
      </div>
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={TOTAL_STEPS}
        aria-valuenow={step}
        aria-label="Progreso del formulario"
        className="bg-muted h-1.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="bg-primary h-full rounded-full transition-all duration-300"
          style={{ width: `${percent}%` }}
        />
      </div>
    </div>
  );
}

// Formulario público de reclamos, en 4 pasos DENTRO de una sola instancia
// de react-hook-form (paso 5.2) -- no 4 rutas ni 4 componentes remontados.
// Decisión justificada en el reporte de este paso: para el criterio de los
// 90 segundos, cuatro navegaciones de página (con su propio round-trip e
// re-render completo) suman fricción real que cuatro secciones de UN
// formulario no tienen -- volver de un paso al anterior es instantáneo y
// no pierde nada, porque nunca se desmonta el estado.
export function TicketForm({
  token,
  buildingName,
  adminWhatsappE164,
  appBaseUrl,
  categories,
  units,
}: {
  token: string;
  buildingName: string;
  adminWhatsappE164: string;
  // URL pública real de esta app (paso 5.10) -- env.NEXT_PUBLIC_APP_URL,
  // resuelta en el servidor (page.tsx) y pasada como prop, mismo patrón
  // que buildingName/adminWhatsappE164: env.ts es "server-only", este
  // componente ("use client") no puede leerlo directo. Sin esto, el link
  // de "📷 Adjuntos" del mensaje quedaría armado con
  // DEFAULT_ATTACHMENTS_BASE_URL (un placeholder que no apunta a ningún
  // lado real -- ver format-ticket-message.ts).
  appBaseUrl: string;
  categories: PublicFormCategory[];
  units: PublicFormUnit[];
}) {
  const [step, setStep] = useState(1);
  const [hydrated, setHydrated] = useState(false);
  // Foco al cambiar de paso -- ver el comentario completo de goToStep()
  // más abajo. stepHeadingRef apunta al <h2> de cada paso (título "Tu
  // unidad y contacto"/etc., ver PUBLIC_TICKET_STEPS); confirmationHeadingRef,
  // al <h2> de la pantalla de confirmación ("Listo, tu reclamo ya quedó
  // registrado"), que reemplaza el formulario entero cuando sentTicket
  // deja de ser null -- mismo problema de foco perdido, mismo fix.
  const stepHeadingRef = useRef<HTMLHeadingElement>(null);
  const confirmationHeadingRef = useRef<HTMLHeadingElement>(null);
  const manualStepChangeRef = useRef(false);
  // Un id por CARGA del formulario, no por reclamo -- ver
  // upload-attachment.ts para el porqué completo. Se genera acá mismo
  // (lazy initializer de useState, corre una sola vez) y el efecto de
  // hidratación de abajo lo pisa si había uno guardado en el borrador. Con
  // setter propio (a diferencia de antes del paso 5.8) porque
  // "Cargar otro reclamo" (ver startNewTicket) necesita uno NUEVO: el
  // anterior sigue siendo válido para Storage, pero ya no tiene sentido
  // seguir usándolo para un reclamo distinto.
  const [formSessionId, setFormSessionId] = useState(() => crypto.randomUUID());
  // Paso 5.8: el reclamo que este dispositivo ya mandó para este token, si
  // lo mandó. No nulo == mostrar la pantalla de confirmación en vez del
  // formulario, sin importar en qué `step` haya quedado el form -- ver
  // sentKey() más arriba para el porqué completo.
  const [sentTicket, setSentTicket] = useState<SentTicket | null>(null);
  const [copied, setCopied] = useState(false);
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  const [attachmentsBusy, setAttachmentsBusy] = useState(false);
  const [attachmentError, setAttachmentError] = useState<string | null>(null);
  const attachmentInputRef = useRef<HTMLInputElement>(null);

  const {
    register,
    control,
    trigger,
    watch,
    reset,
    setValue,
    formState: { errors },
  } = useForm<PublicTicketFormInput>({
    resolver: zodResolver(publicTicketFormSchema),
    defaultValues: DEFAULT_VALUES,
  });

  // Si el edificio no tiene unidades cargadas todavía, no tiene sentido
  // mostrar un selector vacío sin salida -- arranca directo en modo "no
  // encuentro mi unidad". Va ANTES del efecto que restaura el borrador
  // (declarado justo debajo) para que un valor guardado de verdad lo pise:
  // React corre los efectos en el orden en que se declaran.
  useEffect(() => {
    if (units.length === 0) {
      setValue("unitNotListed", true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Recupera un borrador de este mismo dispositivo (paso 5.2, "¿qué pasa si
  // cierra el navegador a mitad de camino?"): alguien parado en un pasillo
  // con mala señal puede perder la pestaña sin querer. Se guarda por token
  // (ver draftKey), en localStorage (no sessionStorage: tiene que sobrevivir
  // a cerrar y reabrir el navegador, no solo a recargar la pestaña).
  //
  // Los ADJUNTOS sí se recuperan ahora (revisión del paso 5.4 sobre la
  // decisión del 5.2): un `File` no sobrevive JSON.stringify, pero desde
  // que las fotos se suben EN EL MOMENTO (ver más abajo), lo que hay que
  // recordar no es el archivo sino su `storage_path` -- un string, que sí
  // sobrevive. Solo se restauran los que llegaron a "uploaded": uno que
  // estaba a mitad de subir cuando se cerró el navegador no tiene forma de
  // reanudarse (el File en sí sí se pierde), así que se descarta sin más.
  useEffect(() => {
    // Paso 5.8: un reclamo YA enviado desde este dispositivo manda por
    // sobre cualquier borrador -- si existe, ni siquiera se mira
    // draftKey(). Es la defensa contra recargar o volver atrás después de
    // confirmar (ver sentKey() para el razonamiento completo): sin esto,
    // el borrador (que la propia app siguió escribiendo hasta el momento
    // de enviar, ver el efecto de autoguardado más abajo) reabriría el
    // formulario ya completo, un toque de "Enviar reclamo" de distancia de
    // mandar el mismo reclamo dos veces.
    const sentRaw = window.localStorage.getItem(sentKey(token));
    if (sentRaw) {
      try {
        setSentTicket(JSON.parse(sentRaw) as SentTicket);
        setHydrated(true);
        return;
      } catch {
        window.localStorage.removeItem(sentKey(token));
      }
    }

    const raw = window.localStorage.getItem(draftKey(token));
    if (raw) {
      try {
        const draft = JSON.parse(raw) as Draft;
        reset(draft.values);
        setStep(draft.step);
        setAttachments(
          draft.attachments
            .filter((a) => a.status === "uploaded")
            .map((a) => ({ ...a, file: null })),
        );
      } catch {
        window.localStorage.removeItem(draftKey(token));
      }
    }
    setHydrated(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const values = watch();
  useEffect(() => {
    // No escribir el borrador ANTES de terminar de leerlo (arriba) -- si no,
    // el efecto de hidratación todavía en curso se pisaría a sí mismo con
    // los defaultValues vacíos antes de llegar a aplicar reset().
    if (!hydrated) {
      return;
    }
    if (sentTicket) {
      // Paso 5.8: sin este chequeo, este mismo efecto RESUCITA el
      // borrador que handleSubmit acaba de borrar -- encontrado en la
      // práctica probando el paso 5.8: watch() devuelve un objeto values
      // nuevo en cada render (no una referencia estable), así que este
      // efecto igual se dispara de nuevo en el render que sigue a
      // setSentTicket(), aunque los DATOS del formulario no hayan
      // cambiado, y sin este `return` reescribiría el borrador justo
      // después de que handleSubmit lo borró. Una vez que hay un reclamo
      // enviado, no hay nada que autoguardar -- lo que quedaba del último
      // envío se borra, en vez de reescribirse cada render.
      window.localStorage.removeItem(draftKey(token));
      return;
    }
    const draft: Draft = {
      step,
      values,
      formSessionId,
      attachments: attachments.map((item) => stripFile(item)),
    };
    window.localStorage.setItem(draftKey(token), JSON.stringify(draft));
  }, [hydrated, sentTicket, step, values, token, formSessionId, attachments]);

  // Cola de subida: procesa UN adjunto a la vez, nunca en paralelo -- ver
  // compress-image.ts para el motivo (memoria en un celular viejo). Este
  // efecto se dispara solo, en cadena: termina un item -> cambia
  // `attachments` -> vuelve a correr -> busca el siguiente "queued".
  useEffect(() => {
    if (attachmentsBusy) {
      return;
    }
    const next = attachments.find((a) => a.status === "queued");
    if (!next || !next.file) {
      return;
    }

    setAttachmentsBusy(true);
    setAttachments((current) =>
      current.map((a) =>
        a.id === next.id ? { ...a, status: "processing" } : a,
      ),
    );

    const index = attachments.length;
    uploadFormAttachment(next.file, formSessionId, index)
      .then((uploaded) => {
        setAttachments((current) =>
          current.map((a) =>
            a.id === next.id
              ? {
                  ...a,
                  status: "uploaded",
                  path: uploaded.path,
                  sizeBytes: uploaded.sizeBytes,
                  mimeType: uploaded.mimeType,
                  errorMessage: null,
                }
              : a,
          ),
        );
      })
      .catch((err: unknown) => {
        const message =
          err instanceof AttachmentUploadError
            ? err.message
            : "No pudimos subir este archivo. Revisá tu conexión y probá de nuevo.";
        setAttachments((current) =>
          current.map((a) =>
            a.id === next.id
              ? { ...a, status: "error", errorMessage: message }
              : a,
          ),
        );
      })
      .finally(() => {
        setAttachmentsBusy(false);
      });
  }, [attachments, attachmentsBusy, formSessionId]);

  // Ver el comentario largo de stepHeadingRef/confirmationHeadingRef más
  // arriba: mueve el foco al título del paso nuevo, pero SOLO cuando el
  // cambio de paso lo disparó goToStep() (un click real en "Continuar"/
  // "Volver"), nunca cuando `step` cambia por la restauración de un
  // borrador guardado (el efecto de hidratación, arriba del todo) -- ahí
  // la persona no tocó nada, robarle el foco al cargar la página sería
  // peor que no moverlo.
  useEffect(() => {
    if (manualStepChangeRef.current) {
      manualStepChangeRef.current = false;
      stepHeadingRef.current?.focus();
    }
  }, [step]);

  // Mismo mecanismo para la pantalla de confirmación: reemplaza el
  // formulario entero apenas `sentTicket` deja de ser null (ver el `if
  // (sentTicket) return (...)` más abajo) -- un cambio de contenido tan
  // grande como cualquier cambio de paso, con el mismo problema de foco
  // perdido. Acá no hace falta distinguir "restauración" de "envío real":
  // sentTicket también se restaura desde sentKey() al montar (mismo
  // efecto de hidratación), y en ESE caso mover el foco al título de
  // todos modos es razonable -- es la primera vez que ESTA carga de
  // página muestra la confirmación, sea porque se acaba de enviar o
  // porque se recargó la pantalla ya confirmada.
  useEffect(() => {
    if (sentTicket) {
      confirmationHeadingRef.current?.focus();
    }
  }, [sentTicket]);

  // Foco al cambiar de paso (accesibilidad, paso 12.6) -- encontrado
  // navegando el formulario a mano con teclado: sin esto, "Continuar"/
  // "Volver" cambiaban el contenido visible pero el foco se quedaba en el
  // botón que acababa de desaparecer del layout del paso anterior (React
  // lo desmonta), así que el siguiente Tab arrancaba de nuevo desde
  // arriba del documento -- y un lector de pantalla no anunciaba nada del
  // cambio de paso. `manualStepChangeRef` distingue un cambio de paso
  // REAL (este click) de un `setStep` disparado por la restauración de un
  // borrador (el efecto de hidratación de arriba, en el mount) -- ese
  // caso no debe robarle el foco a nadie, la persona ni tocó nada
  // todavía.
  function goToStep(next: number) {
    manualStepChangeRef.current = true;
    setStep(next);
  }

  async function goNext() {
    const fieldsToValidate =
      step === 1 ? IDENTIFICATION_STEP_FIELDS : PROBLEM_STEP_FIELDS;
    const valid = await trigger([...fieldsToValidate]);
    if (valid) {
      goToStep(step + 1);
    }
  }

  function goBack() {
    goToStep(Math.max(1, step - 1));
  }

  function handleAttachmentChange(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    // Permite volver a elegir el mismo archivo más adelante (ej. después de
    // sacarlo de la lista) -- sin esto, el navegador no dispara onChange de
    // nuevo para un archivo ya seleccionado antes.
    event.target.value = "";
    if (files.length === 0) {
      return;
    }
    if (attachments.length + files.length > MAX_TICKET_PHOTOS) {
      setAttachmentError(`Como máximo ${MAX_TICKET_PHOTOS} archivos.`);
      return;
    }
    for (const file of files) {
      const error = validateAttachmentType(file);
      if (error) {
        setAttachmentError(error);
        return;
      }
    }
    setAttachmentError(null);
    setAttachments((current) => [
      ...current,
      ...files.map((file): AttachmentItem => ({
        id: crypto.randomUUID(),
        file,
        status: "queued",
        path: null,
        originalFilename: file.name,
        sizeBytes: file.size,
        mimeType: file.type,
        errorMessage: null,
      })),
    ]);
  }

  function retryAttachment(id: string) {
    setAttachments((current) =>
      current.map((a) =>
        a.id === id ? { ...a, status: "queued", errorMessage: null } : a,
      ),
    );
  }

  function removeAttachment(id: string) {
    const item = attachments.find((a) => a.id === id);
    setAttachments((current) => current.filter((a) => a.id !== id));
    // No bloquea la UI ni se reintenta si falla -- en el peor caso, el
    // archivo queda huérfano bajo pending/, el mismo destino que ya tiene
    // cualquier adjunto de un formulario que se abandona sin confirmar (ver
    // el Pendiente anotado en CLAUDE.md sobre su limpieza periódica).
    if (item?.path) {
      void deleteFormAttachment(item.path);
    }
  }

  const uploadedAttachments = attachments.filter(
    (a) => a.status === "uploaded",
  );
  const attachmentsInFlight = attachments.some(
    (a) => a.status === "queued" || a.status === "processing",
  );

  // Confirmación real (paso 5.5). NO usa useActionState (a diferencia del
  // resto de los formularios del proyecto) a propósito: useActionState solo
  // captura lo que la Server Action DEVUELVE, no una falla de RED antes de
  // que la acción llegue a correr (la conexión se corta a mitad de camino)
  // -- un caso que el enunciado de este paso pide tratar explícitamente
  // ("no puede quedarse sin saber si su reclamo se registró o no"). Un
  // try/catch propio alrededor de la llamada es la única forma de
  // distinguir "el servidor respondió con un error" (mensaje específico,
  // ver actions.ts) de "no sabemos qué pasó" (mensaje honesto, distinto).
  const [submitState, setSubmitState] = useState<CreateTicketState>(
    initialCreateTicketState,
  );
  const [submitting, setSubmitting] = useState(false);
  // Guarda la MISMA condición que `submitting`, pero en un ref, no en
  // estado -- encontrado en la práctica (paso 5.5, probando un doble toque
  // real): dos eventos "click" nativos disparados en el mismo tick de JS
  // corren los dos handlers ANTES de que React llegue a aplicar el primer
  // setSubmitting(true) (los updates de estado se procesan en batch, no
  // sincrónicamente dentro del handler que las dispara) -- el chequeo `if
  // (submitting) return` leía el mismo valor viejo (false) en las dos
  // ejecuciones y las dos llegaban a mandar la Server Action, confirmado
  // con dos tickets reales creados en la base para un solo doble click. Un
  // ref se lee/escribe sincrónicamente, sin esperar ningún render -- cierra
  // la ventana de carrera que el estado de React no podía cerrar.
  const submittingRef = useRef(false);

  // Honeypot (paso 5.11): input fuera de la RHF -- no forma parte de
  // publicTicketFormSchema porque no es un dato real del reclamo, es un
  // señuelo. Se lee con un ref (no controlado) al momento de enviar, mismo
  // motivo que HONEYPOT_FIELD_NAME es un nombre poco común -- ver el campo
  // oculto más abajo y ticket-schema.ts para la validación real (server).
  const honeypotRef = useRef<HTMLInputElement>(null);

  async function handleSubmit() {
    if (submittingRef.current) {
      return;
    }
    submittingRef.current = true;
    setSubmitting(true);
    try {
      const result = await createTicketAction(initialCreateTicketState, {
        ...values,
        token,
        formSessionId,
        attachments: uploadedAttachments.map((a) => ({
          path: a.path!,
          originalFilename: a.originalFilename,
          mimeType: a.mimeType,
          sizeBytes: a.sizeBytes,
        })),
        [HONEYPOT_FIELD_NAME]: honeypotRef.current?.value ?? "",
      });
      setSubmitState(result);
      if (result.status === "success") {
        // El borrador ya cumplió su función -- si el vecino vuelve a este
        // mismo link más tarde, no tiene sentido reabrirlo a mitad de un
        // reclamo que ya quedó registrado.
        window.localStorage.removeItem(draftKey(token));

        // Paso 5.8: graba el reclamo enviado ANTES de tocar el estado de
        // React -- si algo llegara a fallar entre esto y el setState (no
        // debería, pero es la misma disciplina de "guardar primero" que ya
        // rige el resto del flujo), localStorage queda escrito igual, y la
        // próxima carga de la página lo recupera solo. `selectedUnitLabel`
        // nunca es null acá en la práctica: el servidor ya validó que el
        // reclamo tiene una unidad real o texto libre (ver el CHECK
        // documentado en CLAUDE.md > Mensaje al administrador) -- el `?? ""`
        // es solo para satisfacer el tipo, no una rama que se espere usar.
        const sent: SentTicket = {
          publicCode: result.publicCode,
          priority: result.priority,
          neighborFirstName: values.firstName,
          neighborLastName: values.lastName || null,
          unitLabel: selectedUnitLabel ?? "",
          categoryName: selectedCategory?.name ?? "",
          description: values.description,
          attachmentsCount: uploadedAttachments.length,
          attachmentsToken: result.attachmentsToken,
        };
        window.localStorage.setItem(sentKey(token), JSON.stringify(sent));
        setSentTicket(sent);
      }
    } catch {
      // Corte de conexión real (o cualquier falla que no llegó a producir
      // una respuesta del servidor) -- honesto sobre la incertidumbre real:
      // no podemos saber si el reclamo se guardó o no, así que no se afirma
      // ninguna de las dos cosas.
      setSubmitState({
        status: "error",
        message:
          "No pudimos confirmar si tu reclamo se guardó. Revisá tu conexión -- si no ves un código de reclamo, esperá un momento y volvé a intentar.",
      });
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }

  const selectedCategory = categories.find((c) => c.id === values.categoryId);
  const matchedUnit = units.find((u) => u.id === values.unitId);
  const selectedUnitLabel = values.unitNotListed
    ? values.unitLabelRaw
    : matchedUnit
      ? formatUnitLabel(matchedUnit)
      : null;

  // Paso 5.8: el mensaje se arma del lado del CLIENTE, no lo devuelve
  // createTicketAction -- formatTicketMessage (paso 5.6) es una función
  // pura sin nada de "use server", así que no hay motivo para pagar un
  // round-trip solo para formatear texto. Recalcula con useMemo, no en
  // cada render: sentTicket/buildingName solo cambian en dos momentos (una
  // confirmación real, o la restauración desde localStorage), no en cada
  // tecla que se aprieta en el resto del formulario.
  const confirmationMessage = useMemo(() => {
    if (!sentTicket) {
      return null;
    }
    const input: TicketMessageInput = {
      buildingName,
      neighborFirstName: sentTicket.neighborFirstName,
      neighborLastName: sentTicket.neighborLastName,
      unitLabel: sentTicket.unitLabel,
      categoryName: sentTicket.categoryName,
      priority: sentTicket.priority,
      description: sentTicket.description,
      attachmentsCount: sentTicket.attachmentsCount,
      publicCode: sentTicket.publicCode,
      attachmentsToken: sentTicket.attachmentsToken,
    };
    return formatTicketMessage(input, { baseUrl: appBaseUrl });
  }, [sentTicket, buildingName, appBaseUrl]);

  // `{ ok: false }` cubre el caso documentado en CLAUDE.md > Link de
  // WhatsApp (paso 5.7): buildWhatsAppUrl tira BuildWhatsAppUrlError si
  // adminWhatsappE164 llega vacío o corrupto -- no debería pasar nunca en
  // la práctica (NOT NULL + Zod desde el paso 4.1), pero esta pantalla no
  // asume que esa garantía se cumplió para toda fila real (ver el
  // razonamiento completo en el reporte de 5.7). Si pasa, la pantalla
  // sigue mostrando que el reclamo quedó registrado -- eso ya es cierto,
  // pasó antes que esto -- y esconde SOLO el botón de WhatsApp, con un
  // mensaje honesto en su lugar. Cualquier OTRO error no se traga: si
  // buildWhatsAppUrl tirara algo que no sea BuildWhatsAppUrlError, es un
  // bug real, no un dato mal cargado, y tiene que romper visiblemente en
  // vez de mostrar una pantalla a medias sin explicación.
  const whatsappLink = useMemo(() => {
    if (!confirmationMessage) {
      return null;
    }
    try {
      return {
        ok: true as const,
        url: buildWhatsAppUrl(adminWhatsappE164, confirmationMessage),
      };
    } catch (error) {
      if (error instanceof BuildWhatsAppUrlError) {
        return { ok: false as const };
      }
      throw error;
    }
  }, [confirmationMessage, adminWhatsappE164]);

  // Copiar al portapapeles en un celular (paso 5.8, "probalo") -- dos
  // caminos reales, no uno solo:
  // 1. navigator.clipboard.writeText(), la API moderna -- exige contexto
  //    seguro (HTTPS o localhost) y, en algunos navegadores, que el
  //    llamado cuelgue directo de un gesto del usuario. Anda bien en
  //    Chrome/Android (probado en el reporte).
  // 2. document.execCommand("copy") sobre un <textarea> oculto -- API
  //    vieja y "deprecada", pero sigue siendo el fallback real para
  //    contextos sin Clipboard API (o sin HTTPS). Se prueba SOLO si (1) no
  //    está disponible, nunca como primera opción.
  // Si las dos fallan, no se finge que funcionó: mensaje de error honesto,
  // y el texto sigue disponible para seleccionar a mano (ver el botón de
  // WhatsApp Web más abajo, que muestra el mismo mensaje).
  // Paso 5.9: deja constancia de que se tocó el botón, sin demorar ni
  // arriesgar que WhatsApp deje de abrirse. El <a> de más abajo YA tiene
  // su href resuelto (whatsappLink.url, calculado en el useMemo de arriba)
  // -- el navegador abre esa navegación por su cuenta apenas ocurre el
  // click, sin esperar a este handler. Este handler NO llama
  // preventDefault() en ningún momento, y llama a la Server Action SIN
  // await ("fire and forget"): si esperara la respuesta acá, la apertura
  // de WhatsApp quedaría atada a un round-trip al servidor -- exactamente
  // lo que el enunciado pide evitar (algunos navegadores además bloquean
  // una navegación/popup que no sea la reacción DIRECTA y sincrónica a un
  // toque, así que ni siquiera sería seguro esperar). El `.catch()` sin
  // acción es a propósito: si el registro falla (red, servidor, lo que
  // sea), no hay nada que mostrarle al vecino sobre un evento de
  // analítica que ni sabe que existe, y no hay ningún reintento -- ver
  // registerWhatsappHandoffOpenedAction en actions.ts para el mismo
  // razonamiento del lado del servidor.
  function handleWhatsAppClick(publicCode: string) {
    void registerWhatsappHandoffOpenedAction(token, publicCode).catch(() => {});
  }

  async function handleCopyMessage() {
    if (!confirmationMessage) {
      return;
    }
    try {
      if (navigator.clipboard && window.isSecureContext) {
        await navigator.clipboard.writeText(confirmationMessage);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = confirmationMessage;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopied(true);
      toast.success("Mensaje copiado.");
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error(
        "No pudimos copiar el mensaje. Mantené el dedo apretado sobre el texto para copiarlo a mano.",
      );
    }
  }

  // "¿Qué hace el vecino después?" (paso 5.8) -- vuelve a un formulario
  // limpio para ESTE mismo edificio, no a otra pantalla. Borra las DOS
  // claves de localStorage (enviado y borrador -- un borrador viejo de
  // ANTES de este reclamo no debería reaparecer) y reinicia todo el
  // estado local a mano, porque react-hook-form no se remonta solo. Un
  // formSessionId nuevo: el anterior ya cumplió su función (Storage sigue
  // teniendo esos archivos bajo su prefijo, referenciados por el reclamo
  // ya creado), un reclamo distinto necesita su propio namespace de
  // adjuntos.
  function startNewTicket() {
    window.localStorage.removeItem(sentKey(token));
    window.localStorage.removeItem(draftKey(token));
    setSentTicket(null);
    setSubmitState(initialCreateTicketState);
    reset(DEFAULT_VALUES);
    if (units.length === 0) {
      setValue("unitNotListed", true);
    }
    setAttachments([]);
    setAttachmentError(null);
    setFormSessionId(crypto.randomUUID());
    setStep(1);
  }

  if (sentTicket) {
    return (
      <Card className="w-full">
        <CardContent className={cn("flex flex-col gap-5", TOUCH_TARGETS)}>
          <div className="flex flex-col items-center gap-2 py-2 text-center">
            <CircleCheck className="text-primary size-10" />
            <h2
              ref={confirmationHeadingRef}
              tabIndex={-1}
              className="text-ink font-display text-lg font-semibold outline-none"
            >
              Listo, tu reclamo ya quedó registrado
            </h2>
            <p className="text-ink-muted text-sm">
              Guardá este código para hacer el seguimiento con tu
              administración:
            </p>
            <p className="text-ink font-mono text-2xl font-semibold">
              {sentTicket.publicCode}
            </p>
            <a
              href={`/s/${sentTicket.attachmentsToken}`}
              className="text-primary text-sm underline underline-offset-4"
            >
              Ver el estado de tu reclamo
            </a>
          </div>

          <div className="border-border bg-muted/40 flex flex-col gap-3 rounded-lg border p-4">
            <p className="text-ink text-sm">
              {whatsappLink?.ok
                ? "Para que tu administración se entere hoy, avisale por WhatsApp. Si no lo hacés, igual va a ver tu reclamo, pero recién la próxima vez que entre al sistema."
                : "Tu reclamo ya quedó registrado igual. No pudimos preparar el aviso automático por WhatsApp -- copiá el mensaje y mandalo vos, o comunicate directo con tu administración."}
            </p>

            {whatsappLink?.ok && (
              <Button asChild size="lg" className="w-full">
                <a
                  href={whatsappLink.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() => handleWhatsAppClick(sentTicket.publicCode)}
                >
                  <MessageCircle />
                  Enviar por WhatsApp
                </a>
              </Button>
            )}

            <Button
              type="button"
              variant="outline"
              className="w-full"
              onClick={handleCopyMessage}
            >
              {copied ? <Check /> : <Copy />}
              {copied ? "Mensaje copiado" : "Copiar mensaje"}
            </Button>
            <p className="text-ink-muted text-xs">
              Por si usás WhatsApp Web, o si el botón no te abrió la app.
            </p>
          </div>

          <Button
            type="button"
            variant="ghost"
            className="w-full"
            onClick={startNewTicket}
          >
            Cargar otro reclamo
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="w-full">
      <CardContent className={cn("flex flex-col gap-5", TOUCH_TARGETS)}>
        <StepProgress step={step} />
        <h2
          ref={stepHeadingRef}
          tabIndex={-1}
          className="text-ink font-display text-lg font-semibold outline-none"
        >
          {PUBLIC_TICKET_STEPS.find((s) => s.id === step)?.title}
        </h2>

        <form noValidate onSubmit={(e) => e.preventDefault()}>
          {/* Honeypot (paso 5.11): invisible para un vecino real -- oculto
              con la técnica estándar de "visually hidden" (clip a 1x1px,
              `sr-only`), no display:none (algunos bots lo saltean si lo
              detectan) ni un offset de miles de píxeles (podría generar
              scroll horizontal no deseado en la página). Sin foco por
              teclado ni lector de pantalla. Un bot que completa todo a
              ciegas sí lo llena; ticket-schema.ts lo rechaza en el
              servidor si llega con contenido. */}
          <input
            ref={honeypotRef}
            type="text"
            name={HONEYPOT_FIELD_NAME}
            autoComplete="off"
            tabIndex={-1}
            aria-hidden="true"
            className="sr-only"
            defaultValue=""
          />
          <FieldGroup>
            {step === 1 && (
              <>
                <Field data-invalid={!!errors.firstName}>
                  <FieldLabel htmlFor="ticket-first-name">Nombre</FieldLabel>
                  <Input
                    id="ticket-first-name"
                    autoComplete="given-name"
                    aria-invalid={!!errors.firstName}
                    {...register("firstName")}
                  />
                  <FieldError errors={[errors.firstName]} />
                </Field>

                <Field data-invalid={!!errors.lastName}>
                  <FieldLabel htmlFor="ticket-last-name">Apellido</FieldLabel>
                  <Input
                    id="ticket-last-name"
                    autoComplete="family-name"
                    placeholder="Opcional"
                    aria-invalid={!!errors.lastName}
                    {...register("lastName")}
                  />
                  <FieldError errors={[errors.lastName]} />
                </Field>

                <Field data-invalid={!!errors.phoneE164}>
                  <FieldLabel htmlFor="ticket-phone">Tu teléfono</FieldLabel>
                  <Controller
                    control={control}
                    name="phoneE164"
                    render={({ field }) => (
                      <PhoneNumberInput
                        id="ticket-phone"
                        name={field.name}
                        ref={field.ref}
                        value={field.value}
                        onChange={field.onChange}
                        onBlur={field.onBlur}
                        placeholder="93515551234"
                        aria-invalid={!!errors.phoneE164}
                      />
                    )}
                  />
                  {!errors.phoneE164 && (
                    <FieldDescription>
                      Para que tu administración te pueda responder.{" "}
                      {AR_WHATSAPP_HELP}
                    </FieldDescription>
                  )}
                  <FieldError errors={[errors.phoneE164]} />
                </Field>

                <Field>
                  <FieldLabel htmlFor="ticket-unit">Tu unidad</FieldLabel>
                  {units.length > 0 ? (
                    <UnitCombobox
                      id="ticket-unit"
                      control={control}
                      units={units}
                    />
                  ) : (
                    // Sin unidades cargadas todavía para este edificio: no
                    // hay nada que buscar, así que directamente pide el
                    // texto libre en vez de mostrar un combo vacío -- ver
                    // el useEffect de arriba, que ya fuerza
                    // unitNotListed=true en este caso.
                    <Input
                      id="ticket-unit"
                      placeholder="Contanos dónde vivís"
                      aria-invalid={!!errors.unitLabelRaw}
                      {...register("unitLabelRaw")}
                    />
                  )}
                  {units.length === 0 && (
                    <FieldError errors={[errors.unitLabelRaw]} />
                  )}
                </Field>

                <Button type="button" className="w-full" onClick={goNext}>
                  Continuar
                </Button>
              </>
            )}

            {step === 2 && (
              <>
                <Field data-invalid={!!errors.categoryId}>
                  <FieldLabel htmlFor="ticket-category">Categoría</FieldLabel>
                  <Controller
                    control={control}
                    name="categoryId"
                    render={({ field }) => (
                      <Select
                        value={field.value}
                        onValueChange={field.onChange}
                      >
                        <SelectTrigger
                          id="ticket-category"
                          aria-invalid={!!errors.categoryId}
                          className="w-full"
                        >
                          <SelectValue placeholder="Elegí una categoría" />
                        </SelectTrigger>
                        <SelectContent>
                          {categories.map((category) => (
                            <SelectItem key={category.id} value={category.id}>
                              {category.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                  />
                  <FieldError errors={[errors.categoryId]} />
                </Field>

                <Field data-invalid={!!errors.description}>
                  <FieldLabel htmlFor="ticket-description">
                    Contanos qué pasó
                  </FieldLabel>
                  <Textarea
                    id="ticket-description"
                    rows={5}
                    placeholder="Cuanto más detalle nos des, más rápido lo vamos a poder resolver."
                    aria-invalid={!!errors.description}
                    {...register("description")}
                  />
                  <FieldError errors={[errors.description]} />
                </Field>

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={goBack}
                  >
                    Volver
                  </Button>
                  <Button type="button" className="flex-1" onClick={goNext}>
                    Continuar
                  </Button>
                </div>
              </>
            )}

            {step === 3 && (
              <>
                <Field>
                  <FieldLabel htmlFor="ticket-photos">
                    Sumá fotos si tenés
                  </FieldLabel>
                  <FieldDescription>
                    Ayudan a entender el problema más rápido. También podés
                    sumar un PDF. Podés seguir sin adjuntar nada.
                  </FieldDescription>
                  {/* El input nativo queda oculto: sin estilos propios, el
                      botón/texto que arma el navegador ("Choose Files", en
                      inglés y sin poder tocarse desde HTML) no se puede
                      traducir ni alinear con el resto del formulario --
                      encontrado en la práctica probando el paso 5.2. Se
                      dispara con un botón propio en español. */}
                  <input
                    ref={attachmentInputRef}
                    id="ticket-photos"
                    type="file"
                    accept="image/*,application/pdf"
                    capture="environment"
                    multiple
                    onChange={handleAttachmentChange}
                    className="sr-only"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => attachmentInputRef.current?.click()}
                  >
                    Agregar foto
                  </Button>
                  {attachmentError && (
                    <p className="text-destructive text-sm">
                      {attachmentError}
                    </p>
                  )}
                </Field>

                {attachments.length > 0 && (
                  <ul className="flex flex-col gap-2">
                    {attachments.map((item) => (
                      <AttachmentRow
                        key={item.id}
                        item={item}
                        onRetry={() => retryAttachment(item.id)}
                        onRemove={() => removeAttachment(item.id)}
                      />
                    ))}
                  </ul>
                )}

                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    className="flex-1"
                    onClick={goBack}
                  >
                    Volver
                  </Button>
                  <Button
                    type="button"
                    className="flex-1"
                    disabled={attachmentsInFlight}
                    onClick={() => goToStep(4)}
                  >
                    Continuar
                  </Button>
                </div>
                {attachmentsInFlight && (
                  <p className="text-ink-muted text-sm">
                    Esperá a que terminen de subirse los archivos.
                  </p>
                )}
              </>
            )}

            {step === 4 && (
              <>
                {/* Resumen APILADO (etiqueta chica arriba, valor abajo,
                    alineado a la izquierda), no dos columnas con el valor a
                    la derecha: en un celular angosto la versión de dos
                    columnas comprime valores largos (un depto con torre, una
                    descripción) contra el borde y se lee mal. Apilado se lee
                    igual de bien en cualquier ancho. */}
                <dl className="flex flex-col text-sm">
                  <div className="border-border flex flex-col gap-0.5 border-b py-2">
                    <dt className="text-ink-muted text-xs">Nombre</dt>
                    <dd className="text-ink">
                      {values.firstName} {values.lastName}
                    </dd>
                  </div>
                  <div className="border-border flex flex-col gap-0.5 border-b py-2">
                    <dt className="text-ink-muted text-xs">Teléfono</dt>
                    <dd className="text-ink">{values.phoneE164}</dd>
                  </div>
                  <div className="border-border flex flex-col gap-0.5 border-b py-2">
                    <dt className="text-ink-muted text-xs">Unidad</dt>
                    <dd className="text-ink">{selectedUnitLabel}</dd>
                  </div>
                  <div className="border-border flex flex-col gap-0.5 border-b py-2">
                    <dt className="text-ink-muted text-xs">Categoría</dt>
                    <dd className="text-ink">{selectedCategory?.name}</dd>
                  </div>
                  <div className="border-border flex flex-col gap-0.5 border-b py-2">
                    <dt className="text-ink-muted text-xs">Descripción</dt>
                    <dd className="text-ink whitespace-pre-wrap">
                      {values.description}
                    </dd>
                  </div>
                  <div className="flex flex-col gap-0.5 py-2">
                    <dt className="text-ink-muted text-xs">Adjuntos</dt>
                    <dd className="text-ink">
                      {uploadedAttachments.length === 0
                        ? "Ninguno"
                        : uploadedAttachments.length}
                    </dd>
                  </div>
                </dl>

                {submitState.status === "error" && (
                  <Alert variant="destructive">
                    <AlertDescription>{submitState.message}</AlertDescription>
                  </Alert>
                )}

                <Button
                  type="button"
                  className="w-full"
                  disabled={submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? "Enviando…" : "Enviar reclamo"}
                </Button>

                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  disabled={submitting}
                  onClick={goBack}
                >
                  Volver
                </Button>
              </>
            )}
          </FieldGroup>
        </form>
      </CardContent>
    </Card>
  );
}

// Una fila por adjunto (paso 5.4): reemplaza la grilla de miniaturas del
// paso 5.2 -- con PDF en la mezcla, no todos los adjuntos son una imagen
// que se pueda previsualizar como thumbnail, y ahora cada uno tiene un
// estado real (subiendo, subido, con error) que hay que mostrar.
function AttachmentRow({
  item,
  onRetry,
  onRemove,
}: {
  item: AttachmentItem;
  onRetry: () => void;
  onRemove: () => void;
}) {
  const isImage = item.mimeType.startsWith("image/");
  const hasPreview = !!item.file && isImage;
  // Preview local desde el propio File en memoria -- nunca se vuelve a leer
  // desde Storage (el bucket no le da SELECT a nadie sin sesión, ver la
  // migración 0019): un item restaurado después de recargar la página
  // (file === null) no tiene preview, se muestra con un ícono genérico.
  //
  // El <img> lo maneja el efecto DIRECTO sobre el DOM (via ref), no un
  // setState -- encontrado en la práctica (paso 5.4), dos problemas
  // distintos con las alternativas:
  // 1) createObjectURL en useMemo + revokeObjectURL en un useEffect
  //    aparte: React Strict Mode (desarrollo) monta/desmonta/vuelve a
  //    montar cada componente una vez para detectar cleanups faltantes --
  //    ese ciclo fantasma revocaba la URL real que el render "de verdad"
  //    seguía usando, la miniatura quedaba rota (`ERR_FILE_NOT_FOUND`,
  //    `naturalWidth: 0`), reproducido y confirmado.
  // 2) Crear Y revocar en el mismo efecto, pero guardando la url en
  //    useState: soluciona lo anterior, pero dispara la regla de React
  //    Compiler "Calling setState synchronously within an effect can
  //    trigger cascading renders" (error, no warning, en este proyecto).
  // Setear `imgRef.current.src` a mano evita las dos: el efecto sincroniza
  // con el DOM (el caso que React documenta como el uso correcto de
  // useEffect), no con el estado de React.
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!item.file || !isImage || !imgRef.current) {
      return;
    }
    const url = URL.createObjectURL(item.file);
    imgRef.current.src = url;
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [item.file, isImage]);

  return (
    <li className="border-border flex items-center gap-3 rounded-lg border p-2">
      <div className="bg-muted flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md">
        {hasPreview ? (
          // eslint-disable-next-line @next/next/no-img-element -- preview local de un File, no un asset servido por Next
          <img
            ref={imgRef}
            alt={item.originalFilename}
            className="h-full w-full object-cover"
          />
        ) : (
          <FileIcon className="text-muted-foreground size-5" />
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col">
        <span className="text-ink truncate text-sm">
          {item.originalFilename}
        </span>
        <span
          className={cn(
            "text-xs",
            item.status === "error" ? "text-destructive" : "text-ink-muted",
          )}
        >
          {item.status === "queued" && "En espera…"}
          {item.status === "processing" && "Subiendo…"}
          {item.status === "uploaded" && formatBytes(item.sizeBytes)}
          {item.status === "error" &&
            (item.errorMessage ?? "No se pudo subir.")}
        </span>
      </div>
      {item.status === "error" && (
        <button
          type="button"
          aria-label={`Reintentar ${item.originalFilename}`}
          onClick={onRetry}
          className="hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-full"
        >
          <RotateCw className="size-4" />
        </button>
      )}
      <button
        type="button"
        aria-label={`Sacar ${item.originalFilename}`}
        onClick={onRemove}
        className="hover:bg-accent flex size-8 shrink-0 items-center justify-center rounded-full"
      >
        <X className="size-4" />
      </button>
    </li>
  );
}

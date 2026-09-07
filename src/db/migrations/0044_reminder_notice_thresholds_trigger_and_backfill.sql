-- Custom SQL migration file, put your code below! --

-- 1. Trigger de updated_at -- el mismo trigger reutilizable de la migración
-- 0002 (con el search_path fijo de la 0003), aplicado a la tabla nueva.
-- drizzle-kit no modela triggers, así que va a mano igual que en las
-- migraciones 0011 y 0024.
CREATE TRIGGER set_updated_at
BEFORE UPDATE ON "reminder_notice_thresholds"
FOR EACH ROW
EXECUTE FUNCTION set_updated_at();
--> statement-breakpoint

-- 2. Migración de datos. Cada recordatorio que hoy tiene notice_days = X
-- termina con EXACTAMENTE UN umbral de X días -- ni uno de más, ni pérdida
-- de dato. Se incluyen también los recordatorios con deleted_at (borrado
-- lógico): "cada recordatorio" es cada fila, y su valor de anticipación no
-- se pierde por estar archivado; todo consumidor de umbrales filtra por el
-- deleted_at del recordatorio padre igual que hoy. `organization_id` se
-- copia de la propia fila de `reminders` (denormalización que exige la FK
-- compuesta). `notified_at` queda NULL: todavía no existe ningún aviso
-- dedicado por umbral. El WHERE NOT EXISTS hace la sentencia repetible sin
-- duplicar (una migración corre una sola vez, pero es la disciplina
-- defensiva del resto del proyecto).
INSERT INTO "reminder_notice_thresholds" ("organization_id", "reminder_id", "notice_days")
SELECT r."organization_id", r."id", r."notice_days"
FROM "reminders" r
WHERE NOT EXISTS (
	SELECT 1
	FROM "reminder_notice_thresholds" t
	WHERE t."reminder_id" = r."id"
);

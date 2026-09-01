-- 2026-06-15: per-item field definition for the annual condition inspection.
-- The field-set form was rendering the WHOLE archetype field union (e.g. all 137 equip
-- fields) on every item. Each item actually has its own subset (CCTV ~10, Sprinklers ~19).
-- Add inspection_template_items.field_keys = the item's own field labels, derived from the
-- distinct detail keys captured against it (the source's per-item field set). The form then
-- renders item.field_keys instead of the field_set union. Additive + idempotent.
ALTER TABLE public.inspection_template_items
  ADD COLUMN IF NOT EXISTS field_keys jsonb NOT NULL DEFAULT '[]'::jsonb;

UPDATE public.inspection_template_items iti
   SET field_keys = COALESCE((
     SELECT jsonb_agg(DISTINCT k ORDER BY k)
       FROM public.inspection_responses ir, jsonb_object_keys(ir.detail) AS k
      WHERE ir.template_item_id = iti.id
   ), '[]'::jsonb)
 WHERE EXISTS (SELECT 1 FROM public.inspection_responses ir2 WHERE ir2.template_item_id = iti.id);

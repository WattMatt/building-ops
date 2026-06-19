/**
 * Building name display formatting — the single source of truth for how building
 * names are shown to users. Per product rule, building names are ALWAYS rendered
 * in uppercase, regardless of how they were entered, imported, or pulled from an
 * external source (manual entry, XLSX import, insight-linker FDW, …).
 *
 * DISPLAY-ONLY: the stored value in `buildings.name` is never modified. Use this
 * everywhere a building name reaches the UI — detail header, cards, map popups,
 * dropdowns, dialog text, and generated report/PDF output.
 */
export function formatBuildingName(name: string | null | undefined): string {
  return (name ?? '').toUpperCase();
}

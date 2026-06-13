/** Contract every report section component implements. Stable so sections can be
 *  built independently and registered without touching each other. */
export interface SectionProps {
  reportId: string;
  buildingId: string;
  /** true unless the report is an editable draft */
  readOnly: boolean;
}

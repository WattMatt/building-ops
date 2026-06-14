/**
 * Per-archetype field catalogue for the annual Condition Inspection.
 *
 * Each annual `inspection_template_items` row carries a `field_set` tag
 * (`equip` | `condition` | `process` | `profile` | `narrative` | `register`).
 * The rich per-item answers live in `inspection_responses.detail` (jsonb),
 * keyed by the VERBATIM source label (including trailing `:` / `?`). To line
 * up with the seeded data the form must read/write those exact keys, so the
 * keys below are derived from the live DB:
 *
 *   SELECT iti.field_set, key
 *   FROM inspection_responses ir
 *   JOIN inspection_template_items iti ON iti.id = ir.template_item_id,
 *        jsonb_object_keys(ir.detail) AS key
 *   WHERE ir.detail::text NOT IN ('{}','null')
 *   GROUP BY 1,2 ORDER BY 1,2;
 *
 * `profile` is sourced from the spec's explicit list (its live data is
 * currently mis-homed and being corrected separately). `register` carries no
 * detail fields. `narrative` is a single free-text body.
 *
 * `label` is the key with any trailing `:`/`?` trimmed; `long: true` flags
 * description/comment-style fields that should render as a textarea.
 */
export interface AnnualField {
  key: string;
  label: string;
  long?: boolean;
}

/** Strip trailing `:`/`?` (and surrounding whitespace) for the display label. */
function labelFor(key: string): string {
  return key.replace(/\s*[:?]\s*$/, '').trim();
}

/** Build a field list from raw verbatim keys; mark the given keys as long. */
function fields(keys: string[], longKeys: ReadonlySet<string> = new Set()): AnnualField[] {
  return keys.map((key) => ({ key, label: labelFor(key), ...(longKeys.has(key) ? { long: true } : {}) }));
}

// ── equip (§equipment archetype) ─────────────────────────────────────────
// Service block grouped first, then the rest of the captured fields.
const EQUIP_SERVICE_BLOCK = [
  'Service provider / contractor / installed by',
  'Is an SLA in place?',
  'Service frequency',
  'Last date serviced',
  'Last monthly service date',
  'Next monthly service date',
  'Last major service date',
  'Next major service date',
  'Last service certificate',
  'Last service certificate obtained',
  'Inspection checklist: Daily/weekly/monthly',
  'Inspection checklist: Daily/Weekly/Monthly',
  'Cost Recovery: Tenant specific / part of ops cost',
];

const EQUIP_REST = [
  'Type of equipment',
  'Type of equipment: Provide a list',
  'Breakdown of equipment',
  'Quantity of equipment',
  'Number of units',
  'Make & model',
  'Make and model',
  'Date purchased',
  'Installation date',
  'Upgrade date',
  'Current status: (Good, Fair, Poor)',
  'As built plan available',
  'Location plan available',
  'Brief description of system installed',
  'Brief description of how the system works',
  'Brief description of how the system operates',
  'Give a brief description of how the system works',
  'Give a brief description of how the system operates',
  'Type of system',
  'Type of system installed',
  'Type of system: (Chiller system, VRV system)',
  // electrical / HT
  'Are all COCs in place',
  'List of DBs available',
  'Switch gear',
  'High tension room supply',
  'Main connection with size of connection',
  'Number of transformers on site',
  'Type of transformers',
  'Voltage',
  'Who is responsible for the HT room equipment?',
  'Latest technical audit report (done by utility company)',
  'What tariff the mall gets invoiced',
  'Type of meters installed',
  'Prepaid system installed',
  'How many tenants are on prepaid?',
  // power factor
  'Is there power factor correction equipment installed?',
  'Current power factor reading',
  // infrared scans
  'Are infrared scans performed',
  'Frequency of scans: Bi-annually / annually etc.',
  'Cost of a scan',
  'Latest scan performed',
  'Next scan to be performed',
  'Last scanned report available and were all issues resolved',
  'Who performs the scan, specify contractor?',
  // generator
  'Specs of generator',
  'Size generator',
  'Size of solar plant',
  'Life span expectancy of generator',
  'Generator running hours: Date/hours',
  'Give a brief description of how generator operates',
  'Diesel, Electrical, Jockey pump',
  'Bulk tank capacity',
  'Day tank capacity',
  'Diesel bulk tank capacity',
  'Diesel day tank capacity',
  'Frequency of test performed: Weekly/Daily',
  'Last training certificates of operator',
  'Is Annexure A (commissioning certificate) report on file',
  // solar
  'Amount and type of solar panels',
  'Amount and type of invertors',
  'Make & model of panels',
  'kWh production of plant',
  'Plant performance reporting frequency',
  'Performance/production guarantee (is calculated over 12 months): (Yes/No)',
  // fire
  'Number and type of fire extinguishers on the premises',
  'Number and type of fire extinguishers for tenants',
  'Number of fire hose reels in building',
  'Number of hydrants on the premises',
  'Number of ICV valves on the premises',
  'Number of detectors',
  'Type of detectors (specify how many you have of each type of detector e.g., 10 Smoke, 10 heat etc.)',
  'What type of sprinkler pump is on premises?',
  'Size and specs of diesel or electrical pump',
  'Size and specs of jockey pump',
  // HVAC / extraction
  'Give a brief description of how extraction system operates',
  'If mechanical extraction units are installed, specify number of units per tenant',
  'If vents are installed, specify number of vents per tenant',
  'Gas operations – how does it work',
  'Drainage system',
  // water / sanitation
  'Is a water purification system installed?',
  'Who installed the water purification?',
  'Frequency of water tests',
  'Latest water tests available',
  'If a backup water tank is present, indicate capacity',
  'How is sanitation billed per point or per %?',
  // CCTV / security / access
  'Quantity and type of cameras',
  'Type of cameras installed',
  'Type and model of software installed',
  'Are motion sensors installed',
  'Armed reaction services or control room monitored',
  'Type of doors',
  'Quantity of remotes on hand',
  'Day night switch or timer',
  'Type of lights installed',
  // lifts
  'When was the last Annex B (independent lift inspector report) report done?',
  // misc
  'Cleaning service frequency',
  'Number of carpets outside',
  'Service fee cost',
  'Repair cost',
  'Please indicate where this is captured',
  'If yes please elaborate',
  'General comment',
  'General comments',
  'N/A',
  'Next service due',
];

const EQUIP_LONG = new Set([
  'Breakdown of equipment',
  'Type of equipment: Provide a list',
  'Brief description of system installed',
  'Brief description of how the system works',
  'Brief description of how the system operates',
  'Give a brief description of how the system works',
  'Give a brief description of how the system operates',
  'Give a brief description of how extraction system operates',
  'Give a brief description of how generator operates',
  'Gas operations – how does it work',
  'Last scanned report available and were all issues resolved',
  'If yes please elaborate',
  'General comment',
  'General comments',
]);

// ── condition (§building-fabric / finishes archetype) ────────────────────
const CONDITION_KEYS = [
  'Current status: (Good, Fair, Poor)',
  'Type of equipment',
  'Type of lights',
  'Last date serviced',
  'Service frequency',
  'Is an SLA in place?',
  'Cost Recovery: Tenant specific / part of ops cost',
  'Inspection checklist: Daily/weekly/monthly',
  'Is the maintenance specification as per the manufacturer recommendation on file?',
  'Is there attic stock? If yes, is the attic stock register updated',
  'Guarantee in place: (Specify date guarantee expires)',
  // structure / fabric
  'Describe the structural condition of the external walls',
  'Describe the structural condition of the internal walls',
  'Describe condition of ceilings',
  'Describe condition of bulkheads, walkways and service passages',
  'Condition of roof sheeting',
  'Condition of gutters/full bores',
  'Condition of parapets',
  'Condition of wall copings',
  'Type of waterproofing',
  // paint
  'Describe the condition of the paint / marmoran on the external walls',
  'Describe the condition of the paint / marmoran on the internal walls',
  'Type and colour code of paint used',
  'Is there a warranty on the paint? What is the warranty term?',
  'When was the last paint job performed?',
  'When last were the walls painted',
  'When last were the ceilings painted',
  'When will the next paint job be budgeted for?',
  // paving / tiling
  'Paving specs and codes',
  'Tile specs and codes',
  // signage
  'Is signage clearly visible in the day',
  'Is signage clearly visible in the evening',
  'Is signage metered',
  // parking equipment
  'Give a brief description of how the system operates',
  'Give a brief explanation of the type of fence',
  'Booms',
  'Spike barriers',
  'Ticket dispenser',
  'Ticket acceptor',
  'Automated pay stations',
  'What payment facilities are available at the pay stations',
  'Do we have road marking stencils? If so where are they stored',
  // bathrooms
  'Toilet flush system',
  'Toilet roll holder',
  'Taps',
  'Urinal sensors',
  'Soap dispenser',
  'Hand dryer',
  'Sani-bins',
  'Air fresheners',
  'List other mechanisms present in bathrooms',
  'Service provider for cleaning',
  'Service provider for Sani-bins',
  'Are the cleaning specifications as per manufacturers recommendation on file?',
  // size / spec
  'Size and spec of pumps',
  // disclaimer signs
  'Are disclaimer signs present on site?',
  // cost
  'What are the cost implications?',
  'What are the possible cost implications of the repairs/replacement?',
  'Specify where in the building the items with issues are located and what the issues are',
  'Location/elevation plan available',
  'As built plan available',
  'General comment',
];

const CONDITION_LONG = new Set([
  'Describe the structural condition of the external walls',
  'Describe the structural condition of the internal walls',
  'Describe condition of ceilings',
  'Describe condition of bulkheads, walkways and service passages',
  'Describe the condition of the paint / marmoran on the external walls',
  'Describe the condition of the paint / marmoran on the internal walls',
  'Give a brief description of how the system operates',
  'Give a brief explanation of the type of fence',
  'List other mechanisms present in bathrooms',
  'What are the cost implications?',
  'What are the possible cost implications of the repairs/replacement?',
  'Specify where in the building the items with issues are located and what the issues are',
  'General comment',
]);

// ── process (§operations / service archetype) ────────────────────────────
const PROCESS_KEYS = [
  'Current status: (Good, Fair, Poor)',
  'Service provider / contractor',
  'Is an SLA in place?',
  'Cost Recovery: Tenant specific / part of ops cost',
  'Inspection checklist: Daily/weekly/monthly',
  'As built plan available',
  'As built plan available for refuse yard',
  // staffing
  'Staff complement',
  'Day shift staff',
  'Night shift staff',
  'Day shift security',
  'Night shift security',
  'Day shift cleaners',
  'Night shift cleaners',
  'How many car guards',
  // equipment
  'Cleaning equipment make and model',
  'Patrolling equipment make and model',
  'Patrolling equipment purchase date',
  'When was equipment purchased?',
  // refuse
  'Specify amount wheelie bins',
  'Recyclable rebate',
  'Odour cure system in place',
  // pest
  'Is pest control register available?',
  // evacuation
  'Amount of static assembly points',
  'Amount of manual assembly points',
  'Explain how the evacuation procedure works',
  'Where is the evacuation process documented?',
  'How often is the evacuation process tested?',
  'Last date that evacuation procedure was tested',
  'Next scheduled dates of evacuation procedure testing',
  'Were any issues identified with the last evacuation testing drill? Please elaborate on how this was resolved',
  'General comment',
  'N/A',
];

const PROCESS_LONG = new Set([
  'Explain how the evacuation procedure works',
  'Where is the evacuation process documented?',
  'Were any issues identified with the last evacuation testing drill? Please elaborate on how this was resolved',
  'General comment',
]);

// ── profile (§3 — verbatim keys; live data moved §1→§3 by sql/2026-06-14_08) ──
const PROFILE_KEYS = [
  'Property address',
  'Practical completion',
  'Further expansions: (if yes please provide dates)',
  'Total GLA m²',
  'Current vacancy m²',
  'Parking bays',
  'Basement',
  'Open',
  'Covered parking',
  'Shaded parking',
  'Motorbike',
  'Moms and tods',
  'Disabled',
  'Taxi bays',
  'Number of tenants',
  'List of anchor tenants',
  'Quantity national tenants',
  'Quantity private shops',
];

const PROFILE_LONG = new Set(['Property address', 'List of anchor tenants']);

// ── narrative (§1/§2/§29 — single free-text body) ────────────────────────
const NARRATIVE_KEYS = ['Body'];

export const ANNUAL_FIELD_SETS: Record<string, AnnualField[]> = {
  equip: fields([...EQUIP_SERVICE_BLOCK, ...EQUIP_REST], EQUIP_LONG),
  condition: fields(CONDITION_KEYS, CONDITION_LONG),
  process: fields(PROCESS_KEYS, PROCESS_LONG),
  profile: fields(PROFILE_KEYS, PROFILE_LONG),
  narrative: fields(NARRATIVE_KEYS, new Set(NARRATIVE_KEYS)),
  register: [],
};

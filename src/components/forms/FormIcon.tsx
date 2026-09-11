/** `form_templates.icon` (a lucide kebab name) → the icon; anything unknown renders as a document. */
import {
  AlertTriangle,
  ClipboardList,
  FileSpreadsheet,
  FileText,
  Flame,
  HardHat,
  Key,
  Shield,
  Truck,
  Users,
  Wrench,
  type LucideIcon,
} from 'lucide-react';

export const FORM_ICONS: Record<string, LucideIcon> = {
  'key': Key,
  'hard-hat': HardHat,
  'clipboard-list': ClipboardList,
  'wrench': Wrench,
  'users': Users,
  'file-spreadsheet': FileSpreadsheet,
  'alert-triangle': AlertTriangle,
  'shield': Shield,
  'flame': Flame,
  'file-text': FileText,
  'truck': Truck,
};

export const FORM_ICON_NAMES = Object.keys(FORM_ICONS);

export function FormIcon({ name, className = 'h-5 w-5' }: { name: string; className?: string }) {
  const Icon = FORM_ICONS[name] ?? FileText;
  return <Icon className={className} aria-hidden="true" />;
}

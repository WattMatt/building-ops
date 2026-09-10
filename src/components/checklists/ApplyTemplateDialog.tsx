import { useState, useEffect } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { supabase } from '@/integrations/supabase/client';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Badge } from '@/components/ui/badge';
import { Loader2, Building2, CheckCircle2 } from 'lucide-react';
import { toast } from 'sonner';
import { templateAppliesToBuilding, BUILDING_TYPES } from '@/lib/compliance';

type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';

interface Template {
  id: string;
  name: string;
  frequency: TaskFrequency;
  applies_to_building_types?: string[] | null;
  /** Number of template items; supplied by the parent so the dialog needs no extra fetch. */
  itemCount?: number;
}

interface Building {
  id: string;
  name: string;
  building_type: string | null;
}

interface ApplyTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  onSuccess: () => void;
}

export default function ApplyTemplateDialog({
  open,
  onOpenChange,
  template,
  onSuccess,
}: ApplyTemplateDialogProps) {
  const [loading, setLoading] = useState(false);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [selectedBuildings, setSelectedBuildings] = useState<Set<string>>(new Set());
  const [selectAll, setSelectAll] = useState(false);

  useEffect(() => {
    if (open) {
      fetchBuildings();
      setSelectedBuildings(new Set());
      setSelectAll(false);
    }
  }, [open]);

  const fetchBuildings = async () => {
    try {
      const { data, error } = await supabase
        .from('buildings')
        .select('id, name, building_type')
        .order('name');

      if (error) throw error;
      setBuildings(data || []);
    } catch (error) {
      console.error('Error fetching buildings:', error);
    }
  };

  const isEligible = (b: Building) =>
    templateAppliesToBuilding(template?.applies_to_building_types ?? null, b.building_type);
  const eligibleBuildings = buildings.filter(isEligible);

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedBuildings(new Set(eligibleBuildings.map(b => b.id)));
    } else {
      setSelectedBuildings(new Set());
    }
  };

  const handleBuildingToggle = (buildingId: string) => {
    const newSelected = new Set(selectedBuildings);
    if (newSelected.has(buildingId)) {
      newSelected.delete(buildingId);
    } else {
      newSelected.add(buildingId);
    }
    setSelectedBuildings(newSelected);
    setSelectAll(newSelected.size === eligibleBuildings.length);
  };

  const handleApply = async () => {
    if (!template || selectedBuildings.size === 0) {
      toast.error('Please select at least one building');
      return;
    }
    if (template.itemCount === 0) {
      toast.error('This template has no tasks');
      return;
    }

    setLoading(true);
    try {
      let totalCreated = 0;
      for (const buildingId of selectedBuildings) {
        // generate_scheduled_tasks is not yet in the generated types; regenerate after the migration ships.
        const { data, error } = await supabase.rpc('generate_scheduled_tasks' as never, { p_building: buildingId, p_template: template.id } as never);
        if (error) throw new Error(error.message);
        totalCreated += (data as unknown as number) ?? 0;
      }

      if (totalCreated > 0) {
        toast.success(`Created ${totalCreated} tasks across ${selectedBuildings.size} building(s)`);
      } else {
        toast.info('All tasks already exist for selected buildings');
      }

      onSuccess();
      onOpenChange(false);
    } catch (error) {
      console.error('Error applying template:', error);
      toast.error('Failed to apply template');
    } finally {
      setLoading(false);
    }
  };

  if (!template) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Apply Template to Buildings</DialogTitle>
          <DialogDescription>
            Generate <Badge variant="secondary">{template.frequency}</Badge> tasks from "{template.name}" template
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex items-center space-x-2 pb-2 border-b">
            <Checkbox
              id="select-all"
              checked={selectAll}
              onCheckedChange={handleSelectAll}
            />
            <Label htmlFor="select-all" className="font-medium">
              Select All Buildings ({eligibleBuildings.length})
            </Label>
          </div>

          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-2">
              {buildings.map((building) => {
                const eligible = isEligible(building);
                return (
                  <div
                    key={building.id}
                    className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                      !eligible
                        ? 'opacity-50'
                        : selectedBuildings.has(building.id)
                          ? 'bg-primary/5 border-primary/30'
                          : 'hover:bg-muted/50'
                    }`}
                  >
                    <Checkbox
                      id={building.id}
                      disabled={!eligible}
                      checked={selectedBuildings.has(building.id)}
                      onCheckedChange={() => handleBuildingToggle(building.id)}
                    />
                    <Label
                      htmlFor={building.id}
                      className={`flex-1 flex items-center gap-2 ${eligible ? 'cursor-pointer' : 'cursor-not-allowed'}`}
                    >
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      <span className="flex-1">{formatBuildingName(building.name)}</span>
                      {!eligible && (
                        <span className="text-xs text-muted-foreground">
                          Not applicable — {building.building_type
                            ? (BUILDING_TYPES.find((t) => t.value === building.building_type)?.label ?? building.building_type)
                            : 'building type not set'}
                        </span>
                      )}
                    </Label>
                    {selectedBuildings.has(building.id) && (
                      <CheckCircle2 className="h-4 w-4 text-primary" />
                    )}
                  </div>
                );
              })}

              {buildings.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  No buildings available
                </div>
              )}
            </div>
          </ScrollArea>

          <div className="text-sm text-muted-foreground">
            {selectedBuildings.size} building(s) selected
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={handleApply} disabled={loading || selectedBuildings.size === 0}>
            {loading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Apply Template
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

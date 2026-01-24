import { useState, useEffect } from 'react';
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
import { format, startOfDay, startOfWeek, startOfMonth, startOfQuarter, startOfYear, addDays, addMonths, addQuarters, addYears } from 'date-fns';

type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';

interface Template {
  id: string;
  name: string;
  frequency: TaskFrequency;
}

interface Building {
  id: string;
  name: string;
}

interface ApplyTemplateDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  template: Template | null;
  onSuccess: () => void;
}

function getDueDateForFrequency(frequency: TaskFrequency): string {
  const now = new Date();
  switch (frequency) {
    case 'daily':
      return format(startOfDay(now), 'yyyy-MM-dd');
    case 'weekly':
      return format(addDays(startOfWeek(now, { weekStartsOn: 1 }), 6), 'yyyy-MM-dd');
    case 'monthly':
      return format(addMonths(startOfMonth(now), 1), 'yyyy-MM-dd');
    case 'quarterly':
      return format(addQuarters(startOfQuarter(now), 1), 'yyyy-MM-dd');
    case 'annually':
      return format(addYears(startOfYear(now), 1), 'yyyy-MM-dd');
    default:
      return format(now, 'yyyy-MM-dd');
  }
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
        .select('id, name')
        .order('name');

      if (error) throw error;
      setBuildings(data || []);
    } catch (error) {
      console.error('Error fetching buildings:', error);
    }
  };

  const handleSelectAll = (checked: boolean) => {
    setSelectAll(checked);
    if (checked) {
      setSelectedBuildings(new Set(buildings.map(b => b.id)));
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
    setSelectAll(newSelected.size === buildings.length);
  };

  const handleApply = async () => {
    if (!template || selectedBuildings.size === 0) {
      toast.error('Please select at least one building');
      return;
    }

    setLoading(true);
    try {
      // Fetch template items
      const { data: templateItems, error: itemsError } = await supabase
        .from('template_items')
        .select('*')
        .eq('template_id', template.id);

      if (itemsError) throw itemsError;
      if (!templateItems || templateItems.length === 0) {
        toast.error('This template has no tasks');
        return;
      }

      const dueDate = getDueDateForFrequency(template.frequency);
      let totalCreated = 0;

      for (const buildingId of selectedBuildings) {
        // Check for existing tasks
        const { data: existingTasks } = await supabase
          .from('task_instances')
          .select('template_item_id')
          .eq('building_id', buildingId)
          .eq('due_date', dueDate)
          .eq('frequency', template.frequency);

        const existingItemIds = new Set((existingTasks || []).map(t => t.template_item_id));

        // Create new task instances
        const newTasks = templateItems
          .filter(item => !existingItemIds.has(item.id))
          .map(item => ({
            building_id: buildingId,
            template_item_id: item.id,
            task_name: item.task_name,
            task_description: item.task_description,
            frequency: template.frequency,
            responsible_role: 'user' as const,
            status: 'pending' as const,
            due_date: dueDate,
            requires_photo: item.requires_photo,
            requires_signature: item.requires_signature,
          }));

        if (newTasks.length > 0) {
          const { error: insertError } = await supabase
            .from('task_instances')
            .insert(newTasks);

          if (insertError) throw insertError;
          totalCreated += newTasks.length;
        }
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
              Select All Buildings ({buildings.length})
            </Label>
          </div>

          <ScrollArea className="h-[300px] pr-4">
            <div className="space-y-2">
              {buildings.map((building) => (
                <div
                  key={building.id}
                  className={`flex items-center space-x-3 p-3 rounded-lg border transition-colors ${
                    selectedBuildings.has(building.id)
                      ? 'bg-primary/5 border-primary/30'
                      : 'hover:bg-muted/50'
                  }`}
                >
                  <Checkbox
                    id={building.id}
                    checked={selectedBuildings.has(building.id)}
                    onCheckedChange={() => handleBuildingToggle(building.id)}
                  />
                  <Label
                    htmlFor={building.id}
                    className="flex-1 flex items-center gap-2 cursor-pointer"
                  >
                    <Building2 className="h-4 w-4 text-muted-foreground" />
                    {building.name}
                  </Label>
                  {selectedBuildings.has(building.id) && (
                    <CheckCircle2 className="h-4 w-4 text-primary" />
                  )}
                </div>
              ))}

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

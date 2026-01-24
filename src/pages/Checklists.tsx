import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ClipboardCheck,
  Search,
  Building2,
  Calendar,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Camera,
} from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';
type TaskStatus = 'pending' | 'completed' | 'overdue' | 'issue_logged';

interface TaskInstance {
  id: string;
  task_name: string;
  task_description: string | null;
  frequency: TaskFrequency;
  status: TaskStatus;
  due_date: string;
  requires_photo: boolean;
  requires_signature: boolean;
  building_id: string;
}

interface Building {
  id: string;
  name: string;
}

// Mock data for now - will be replaced with real data
const mockTasks: TaskInstance[] = [
  {
    id: '1',
    task_name: 'Restroom Consumables Restock',
    task_description: 'Restock toilet paper, soap, paper towels in all restrooms',
    frequency: 'daily',
    status: 'pending',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    requires_photo: false,
    requires_signature: true,
    building_id: '1',
  },
  {
    id: '2',
    task_name: 'Restroom Cleaning & Sanitise',
    task_description: 'Clean and sanitise restrooms and touchpoints',
    frequency: 'daily',
    status: 'pending',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    requires_photo: true,
    requires_signature: true,
    building_id: '1',
  },
  {
    id: '3',
    task_name: 'HVAC Filters Inspection',
    task_description: 'Check and replace HVAC filters as needed',
    frequency: 'weekly',
    status: 'pending',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    requires_photo: true,
    requires_signature: true,
    building_id: '1',
  },
  {
    id: '4',
    task_name: 'Fire Extinguisher Visual Check',
    task_description: 'Visual inspection of all fire extinguishers for tampering or damage',
    frequency: 'daily',
    status: 'completed',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    requires_photo: false,
    requires_signature: true,
    building_id: '1',
  },
  {
    id: '5',
    task_name: 'Emergency Exit Inspection',
    task_description: 'Check signage illumination and clear routes',
    frequency: 'daily',
    status: 'pending',
    due_date: format(new Date(), 'yyyy-MM-dd'),
    requires_photo: false,
    requires_signature: true,
    building_id: '1',
  },
];

const frequencyLabels: Record<TaskFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annual',
};

const statusColors: Record<TaskStatus, string> = {
  pending: 'bg-warning text-warning-foreground',
  completed: 'bg-success text-success-foreground',
  overdue: 'bg-destructive text-destructive-foreground',
  issue_logged: 'bg-destructive/80 text-destructive-foreground',
};

export default function Checklists() {
  const { user } = useAuth();
  const [tasks, setTasks] = useState<TaskInstance[]>(mockTasks);
  const [buildings, setBuildings] = useState<Building[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedBuilding, setSelectedBuilding] = useState<string>('all');
  const [selectedFrequency, setSelectedFrequency] = useState<TaskFrequency>('daily');
  const [completedTasks, setCompletedTasks] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetchBuildings();
  }, []);

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

  const filteredTasks = tasks.filter((task) => {
    const matchesSearch = task.task_name.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFrequency = task.frequency === selectedFrequency;
    const matchesBuilding = selectedBuilding === 'all' || task.building_id === selectedBuilding;
    return matchesSearch && matchesFrequency && matchesBuilding;
  });

  const pendingTasks = filteredTasks.filter((t) => t.status === 'pending' && !completedTasks.has(t.id));
  const completedTasksList = filteredTasks.filter((t) => t.status === 'completed' || completedTasks.has(t.id));

  const handleToggleTask = (taskId: string) => {
    setCompletedTasks((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(taskId)) {
        newSet.delete(taskId);
      } else {
        newSet.add(taskId);
        toast.success('Task marked as complete');
      }
      return newSet;
    });
  };

  const handleReportIssue = (taskId: string) => {
    toast.info('Issue reporting coming soon');
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Checklists</h1>
          <p className="text-muted-foreground">
            Complete your maintenance tasks
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Calendar className="h-4 w-4" />
          {format(new Date(), 'EEEE, MMMM d, yyyy')}
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search tasks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select value={selectedBuilding} onValueChange={setSelectedBuilding}>
          <SelectTrigger className="w-full sm:w-[200px]">
            <Building2 className="h-4 w-4 mr-2" />
            <SelectValue placeholder="All Buildings" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All Buildings</SelectItem>
            {buildings.map((building) => (
              <SelectItem key={building.id} value={building.id}>
                {building.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Frequency Tabs */}
      <Tabs value={selectedFrequency} onValueChange={(v) => setSelectedFrequency(v as TaskFrequency)}>
        <TabsList className="grid w-full grid-cols-5 lg:w-auto lg:inline-grid">
          <TabsTrigger value="daily">Daily</TabsTrigger>
          <TabsTrigger value="weekly">Weekly</TabsTrigger>
          <TabsTrigger value="monthly">Monthly</TabsTrigger>
          <TabsTrigger value="quarterly">Quarterly</TabsTrigger>
          <TabsTrigger value="annually">Annual</TabsTrigger>
        </TabsList>

        <TabsContent value={selectedFrequency} className="mt-6 space-y-6">
          {/* Progress Summary */}
          <Card>
            <CardContent className="pt-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-muted-foreground">
                    {frequencyLabels[selectedFrequency]} Progress
                  </p>
                  <p className="text-2xl font-bold">
                    {completedTasksList.length} / {filteredTasks.length} tasks
                  </p>
                </div>
                <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
                  <span className="text-2xl font-bold text-primary">
                    {filteredTasks.length > 0
                      ? Math.round((completedTasksList.length / filteredTasks.length) * 100)
                      : 0}%
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Pending Tasks */}
          {pendingTasks.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <Clock className="h-5 w-5 text-warning" />
                Pending Tasks ({pendingTasks.length})
              </h2>
              <div className="space-y-3">
                {pendingTasks.map((task) => (
                  <Card key={task.id} className="hover:shadow-sm transition-shadow">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <Checkbox
                          checked={completedTasks.has(task.id)}
                          onCheckedChange={() => handleToggleTask(task.id)}
                          className="mt-1"
                        />
                        <div className="flex-1 min-w-0">
                          <div className="flex items-start justify-between gap-4">
                            <div>
                              <h3 className="font-medium">{task.task_name}</h3>
                              {task.task_description && (
                                <p className="text-sm text-muted-foreground mt-1">
                                  {task.task_description}
                                </p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              {task.requires_photo && (
                                <Badge variant="outline" className="gap-1">
                                  <Camera className="h-3 w-3" />
                                  Photo
                                </Badge>
                              )}
                            </div>
                          </div>
                          <div className="flex items-center gap-4 mt-3">
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReportIssue(task.id)}
                            >
                              <AlertTriangle className="h-4 w-4 mr-2" />
                              Report Issue
                            </Button>
                          </div>
                        </div>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Completed Tasks */}
          {completedTasksList.length > 0 && (
            <div className="space-y-4">
              <h2 className="text-lg font-semibold flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-success" />
                Completed ({completedTasksList.length})
              </h2>
              <div className="space-y-3">
                {completedTasksList.map((task) => (
                  <Card key={task.id} className="bg-muted/30">
                    <CardContent className="p-4">
                      <div className="flex items-start gap-4">
                        <Checkbox
                          checked={true}
                          onCheckedChange={() => handleToggleTask(task.id)}
                          className="mt-1"
                        />
                        <div className="flex-1">
                          <h3 className="font-medium line-through text-muted-foreground">
                            {task.task_name}
                          </h3>
                          <p className="text-xs text-muted-foreground mt-1">
                            Completed today
                          </p>
                        </div>
                        <Badge variant="secondary" className={statusColors.completed}>
                          Done
                        </Badge>
                      </div>
                    </CardContent>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {/* Empty State */}
          {filteredTasks.length === 0 && (
            <Card>
              <CardContent className="flex flex-col items-center justify-center py-12">
                <ClipboardCheck className="h-12 w-12 text-muted-foreground mb-4" />
                <h3 className="text-lg font-semibold mb-2">No tasks found</h3>
                <p className="text-muted-foreground text-center">
                  No {frequencyLabels[selectedFrequency].toLowerCase()} tasks scheduled for today.
                </p>
              </CardContent>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}

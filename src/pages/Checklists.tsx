import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  ClipboardCheck,
  Search,
  Plus,
  MoreHorizontal,
  Pencil,
  Trash2,
  Building2,
  Camera,
  FileSignature,
  Loader2,
  ListChecks,
  Send,
} from 'lucide-react';
import { toast } from 'sonner';
import TemplateItemDialog from '@/components/checklists/TemplateItemDialog';
import ApplyTemplateDialog from '@/components/checklists/ApplyTemplateDialog';

type TaskFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'annually';

interface Template {
  id: string;
  name: string;
  description: string | null;
  frequency: TaskFrequency;
  responsible_role: string;
  is_active: boolean;
  organization_id: string;
}

interface TemplateItem {
  id: string;
  task_name: string;
  task_description: string | null;
  responsible_party: string | null;
  requires_photo: boolean;
  requires_signature: boolean;
  display_order: number;
  template_id: string;
  template?: {
    id: string;
    name: string;
    frequency: TaskFrequency;
  };
}

const frequencyLabels: Record<TaskFrequency, string> = {
  daily: 'Daily',
  weekly: 'Weekly',
  monthly: 'Monthly',
  quarterly: 'Quarterly',
  annually: 'Annual',
};

const frequencyColors: Record<TaskFrequency, string> = {
  daily: 'bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-300',
  weekly: 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300',
  monthly: 'bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-300',
  quarterly: 'bg-orange-100 text-orange-800 dark:bg-orange-900 dark:text-orange-300',
  annually: 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300',
};

export default function Checklists() {
  const { isAdminOrManager } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [items, setItems] = useState<TemplateItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFrequency, setSelectedFrequency] = useState<TaskFrequency | 'all'>('all');

  // Dialog states
  const [itemDialogOpen, setItemDialogOpen] = useState(false);
  const [applyDialogOpen, setApplyDialogOpen] = useState(false);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [selectedItem, setSelectedItem] = useState<TemplateItem | null>(null);
  const [selectedTemplate, setSelectedTemplate] = useState<Template | null>(null);
  const [itemToDelete, setItemToDelete] = useState<TemplateItem | null>(null);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      // Fetch templates
      const { data: templatesData, error: templatesError } = await supabase
        .from('checklist_templates')
        .select('*')
        .order('frequency');

      if (templatesError) throw templatesError;

      // Fetch all template items with their template info
      const { data: itemsData, error: itemsError } = await supabase
        .from('template_items')
        .select(`
          *,
          checklist_templates (
            id,
            name,
            frequency
          )
        `)
        .order('display_order');

      if (itemsError) throw itemsError;

      setTemplates(templatesData || []);
      setItems(
        (itemsData || []).map((item) => ({
          ...item,
          template: item.checklist_templates as any,
        }))
      );
    } catch (error) {
      console.error('Error fetching data:', error);
      toast.error('Failed to load checklists');
    } finally {
      setLoading(false);
    }
  };

  const handleAddItem = (template?: Template) => {
    setSelectedItem(null);
    setSelectedTemplate(template || null);
    setItemDialogOpen(true);
  };

  const handleEditItem = (item: TemplateItem) => {
    setSelectedItem(item);
    setItemDialogOpen(true);
  };

  const handleDeleteItem = (item: TemplateItem) => {
    setItemToDelete(item);
    setDeleteDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (!itemToDelete) return;

    try {
      const { error } = await supabase
        .from('template_items')
        .delete()
        .eq('id', itemToDelete.id);

      if (error) throw error;

      toast.success('Task deleted successfully');
      fetchData();
    } catch (error) {
      console.error('Error deleting item:', error);
      toast.error('Failed to delete task');
    } finally {
      setDeleteDialogOpen(false);
      setItemToDelete(null);
    }
  };

  const handleApplyTemplate = (template: Template) => {
    setSelectedTemplate(template);
    setApplyDialogOpen(true);
  };

  // Filter items
  const filteredItems = items.filter((item) => {
    const matchesSearch =
      item.task_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.task_description?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.responsible_party?.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesFrequency =
      selectedFrequency === 'all' || item.template?.frequency === selectedFrequency;
    return matchesSearch && matchesFrequency;
  });

  // Group items by template for summary
  const templateSummary = templates.map((template) => ({
    ...template,
    itemCount: items.filter((i) => i.template_id === template.id).length,
  }));

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardCheck className="h-6 w-6" />
            Checklist Templates
          </h1>
          <p className="text-muted-foreground">
            Manage master checklist templates and apply them to buildings
          </p>
        </div>
        {isAdminOrManager && (
          <Button onClick={() => handleAddItem()}>
            <Plus className="h-4 w-4 mr-2" />
            Add Task
          </Button>
        )}
      </div>

      {/* Template Summary Cards */}
      <div className="grid gap-4 md:grid-cols-5">
        {templateSummary.map((template) => (
          <Card key={template.id} className="relative group">
            <CardHeader className="pb-2">
              <div className="flex items-center justify-between">
                <Badge className={frequencyColors[template.frequency]}>
                  {frequencyLabels[template.frequency]}
                </Badge>
                {isAdminOrManager && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button variant="ghost" size="icon" className="h-8 w-8 opacity-0 group-hover:opacity-100 transition-opacity">
                        <MoreHorizontal className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleAddItem(template)}>
                        <Plus className="h-4 w-4 mr-2" />
                        Add Task
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleApplyTemplate(template)}>
                        <Send className="h-4 w-4 mr-2" />
                        Apply to Buildings
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>
              <CardTitle className="text-lg">{template.name}</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2 text-sm text-muted-foreground">
                  <ListChecks className="h-4 w-4" />
                  {template.itemCount} tasks
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => handleApplyTemplate(template)}
                  className="opacity-0 group-hover:opacity-100 transition-opacity"
                >
                  <Building2 className="h-3 w-3 mr-1" />
                  Apply
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
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
      </div>

      {/* Frequency Tabs */}
      <Tabs value={selectedFrequency} onValueChange={(v) => setSelectedFrequency(v as TaskFrequency | 'all')}>
        <TabsList>
          <TabsTrigger value="all">All ({items.length})</TabsTrigger>
          {(['daily', 'weekly', 'monthly', 'quarterly', 'annually'] as TaskFrequency[]).map((freq) => (
            <TabsTrigger key={freq} value={freq}>
              {frequencyLabels[freq]} ({items.filter((i) => i.template?.frequency === freq).length})
            </TabsTrigger>
          ))}
        </TabsList>

        <TabsContent value={selectedFrequency} className="mt-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">
                {selectedFrequency === 'all' ? 'All Tasks' : `${frequencyLabels[selectedFrequency as TaskFrequency]} Tasks`}
              </CardTitle>
              <CardDescription>
                {filteredItems.length} task{filteredItems.length !== 1 ? 's' : ''} in checklist templates
              </CardDescription>
            </CardHeader>
            <CardContent>
              {filteredItems.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-12 text-center">
                  <ClipboardCheck className="h-12 w-12 text-muted-foreground mb-4" />
                  <h3 className="text-lg font-semibold mb-2">No tasks found</h3>
                  <p className="text-muted-foreground mb-4">
                    {searchQuery
                      ? 'No tasks match your search'
                      : 'Get started by adding tasks to your checklist templates'}
                  </p>
                  {isAdminOrManager && !searchQuery && (
                    <Button onClick={() => handleAddItem()}>
                      <Plus className="h-4 w-4 mr-2" />
                      Add First Task
                    </Button>
                  )}
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Task</TableHead>
                      <TableHead>Template</TableHead>
                      <TableHead>Responsible</TableHead>
                      <TableHead>Requirements</TableHead>
                      {isAdminOrManager && <TableHead className="w-[70px]">Actions</TableHead>}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredItems.map((item) => (
                      <TableRow key={item.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{item.task_name}</p>
                            {item.task_description && (
                              <p className="text-sm text-muted-foreground line-clamp-1">
                                {item.task_description}
                              </p>
                            )}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge className={frequencyColors[item.template?.frequency || 'daily']}>
                            {item.template?.name || 'Unknown'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-sm">{item.responsible_party || '-'}</span>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2">
                            {item.requires_photo && (
                              <Badge variant="outline" className="gap-1">
                                <Camera className="h-3 w-3" />
                                Photo
                              </Badge>
                            )}
                            {item.requires_signature && (
                              <Badge variant="outline" className="gap-1">
                                <FileSignature className="h-3 w-3" />
                                Sign
                              </Badge>
                            )}
                          </div>
                        </TableCell>
                        {isAdminOrManager && (
                          <TableCell>
                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <Button variant="ghost" size="icon" className="h-8 w-8">
                                  <MoreHorizontal className="h-4 w-4" />
                                </Button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end">
                                <DropdownMenuItem onClick={() => handleEditItem(item)}>
                                  <Pencil className="h-4 w-4 mr-2" />
                                  Edit
                                </DropdownMenuItem>
                                <DropdownMenuItem
                                  className="text-destructive"
                                  onClick={() => handleDeleteItem(item)}
                                >
                                  <Trash2 className="h-4 w-4 mr-2" />
                                  Delete
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </TableCell>
                        )}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Template Item Dialog */}
      <TemplateItemDialog
        open={itemDialogOpen}
        onOpenChange={setItemDialogOpen}
        item={selectedItem}
        templates={templates}
        defaultTemplateId={selectedTemplate?.id}
        onSuccess={fetchData}
      />

      {/* Apply Template Dialog */}
      <ApplyTemplateDialog
        open={applyDialogOpen}
        onOpenChange={setApplyDialogOpen}
        template={selectedTemplate}
        onSuccess={fetchData}
      />

      {/* Delete Confirmation */}
      <AlertDialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete Task</AlertDialogTitle>
            <AlertDialogDescription>
              Are you sure you want to delete "{itemToDelete?.task_name}"? This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmDelete} className="bg-destructive text-destructive-foreground hover:bg-destructive/90">
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

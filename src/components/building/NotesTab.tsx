import { useState, useEffect } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, MoreVertical, Edit, Trash2, Search, StickyNote, Pin, PinOff } from 'lucide-react';
import { toast } from 'sonner';
import { format } from 'date-fns';

interface Note {
  id: string;
  title: string;
  content: string;
  category: string | null;
  is_pinned: boolean;
  created_by: string;
  created_at: string;
  updated_at: string;
}

interface NotesTabProps {
  buildingId: string;
}

const NOTE_CATEGORIES = [
  { value: 'general', label: 'General' },
  { value: 'maintenance', label: 'Maintenance' },
  { value: 'safety', label: 'Safety' },
  { value: 'compliance', label: 'Compliance' },
  { value: 'tenant', label: 'Tenant Related' },
  { value: 'incident', label: 'Incident' },
  { value: 'inspection', label: 'Inspection' },
  { value: 'other', label: 'Other' },
];

export default function NotesTab({ buildingId }: NotesTabProps) {
  const { isAdminOrManager, user } = useAuth();
  const [notes, setNotes] = useState<Note[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [editingNote, setEditingNote] = useState<Note | null>(null);
  const [saving, setSaving] = useState(false);

  // Form state
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [isPinned, setIsPinned] = useState(false);

  useEffect(() => {
    fetchNotes();
  }, [buildingId]);

  const fetchNotes = async () => {
    try {
      const { data, error } = await supabase
        .from('building_notes')
        .select('*')
        .eq('building_id', buildingId)
        .order('is_pinned', { ascending: false })
        .order('created_at', { ascending: false });

      if (error) throw error;
      setNotes(data || []);
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error fetching notes:', error);
      toast.error('Failed to load notes');
    } finally {
      setLoading(false);
    }
  };

  const resetForm = () => {
    setTitle('');
    setContent('');
    setCategory('general');
    setIsPinned(false);
    setEditingNote(null);
  };

  const openEditDialog = (note: Note) => {
    setEditingNote(note);
    setTitle(note.title);
    setContent(note.content);
    setCategory(note.category || 'general');
    setIsPinned(note.is_pinned);
    setIsDialogOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!title.trim() || !content.trim()) {
      toast.error('Title and content are required');
      return;
    }

    setSaving(true);

    try {
      if (editingNote) {
        const { error } = await supabase
          .from('building_notes')
          .update({
            title: title.trim(),
            content: content.trim(),
            category,
            is_pinned: isPinned,
          })
          .eq('id', editingNote.id);

        if (error) throw error;
        toast.success('Note updated successfully');
      } else {
        const { error } = await supabase.from('building_notes').insert({
          building_id: buildingId,
          title: title.trim(),
          content: content.trim(),
          category,
          is_pinned: isPinned,
          created_by: user?.id,
        });

        if (error) throw error;
        toast.success('Note created successfully');
      }

      setIsDialogOpen(false);
      resetForm();
      fetchNotes();
    } catch (error: any) {
      if (import.meta.env.DEV) console.error('Error saving note:', error);
      toast.error(error.message || 'Failed to save note');
    } finally {
      setSaving(false);
    }
  };

  const handleTogglePin = async (note: Note) => {
    try {
      const { error } = await supabase
        .from('building_notes')
        .update({ is_pinned: !note.is_pinned })
        .eq('id', note.id);

      if (error) throw error;
      toast.success(note.is_pinned ? 'Note unpinned' : 'Note pinned');
      fetchNotes();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error toggling pin:', error);
      toast.error('Failed to update note');
    }
  };

  const handleDelete = async (note: Note) => {
    if (!confirm(`Are you sure you want to delete "${note.title}"?`)) return;

    try {
      const { error } = await supabase.from('building_notes').delete().eq('id', note.id);

      if (error) throw error;
      toast.success('Note deleted successfully');
      fetchNotes();
    } catch (error) {
      if (import.meta.env.DEV) console.error('Error deleting note:', error);
      toast.error('Failed to delete note');
    }
  };

  const filteredNotes = notes.filter((note) => {
    const matchesSearch =
      note.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
      note.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || note.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const pinnedNotes = filteredNotes.filter((n) => n.is_pinned);
  const unpinnedNotes = filteredNotes.filter((n) => !n.is_pinned);

  const getCategoryLabel = (value: string | null) => {
    return NOTE_CATEGORIES.find((c) => c.value === value)?.label || value || 'General';
  };

  const getCategoryColor = (value: string | null) => {
    switch (value) {
      case 'safety':
      case 'incident':
        return 'destructive';
      case 'compliance':
        return 'outline';
      case 'maintenance':
        return 'secondary';
      default:
        return 'default';
    }
  };

  const canEditNote = (note: Note) => {
    return isAdminOrManager || note.created_by === user?.id;
  };

  const canDeleteNote = () => {
    return isAdminOrManager;
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-32">
        <div className="w-6 h-6 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div className="flex flex-col sm:flex-row gap-2 sm:gap-4">
          <div className="relative max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search notes..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pl-9"
            />
          </div>
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-[180px]">
              <SelectValue placeholder="All Categories" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Categories</SelectItem>
              {NOTE_CATEGORIES.map((cat) => (
                <SelectItem key={cat.value} value={cat.value}>
                  {cat.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <Dialog
          open={isDialogOpen}
          onOpenChange={(open) => {
            setIsDialogOpen(open);
            if (!open) resetForm();
          }}
        >
          <DialogTrigger asChild>
            <Button>
              <Plus className="w-4 h-4 mr-2" />
              Add Note
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg">
            <DialogHeader>
              <DialogTitle>{editingNote ? 'Edit Note' : 'Add Note'}</DialogTitle>
              <DialogDescription>
                {editingNote ? 'Update note information' : 'Add a new note for this building'}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="note-title">Title *</Label>
                <Input
                  id="note-title"
                  placeholder="Enter note title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="category">Category</Label>
                  <Select value={category} onValueChange={setCategory}>
                    <SelectTrigger>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {NOTE_CATEGORIES.map((cat) => (
                        <SelectItem key={cat.value} value={cat.value}>
                          {cat.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label>Pin Note</Label>
                  <Button
                    type="button"
                    variant={isPinned ? 'default' : 'outline'}
                    className="w-full"
                    onClick={() => setIsPinned(!isPinned)}
                  >
                    {isPinned ? <Pin className="w-4 h-4 mr-2" /> : <PinOff className="w-4 h-4 mr-2" />}
                    {isPinned ? 'Pinned' : 'Not Pinned'}
                  </Button>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="content">Content *</Label>
                <Textarea
                  id="content"
                  placeholder="Enter note content..."
                  value={content}
                  onChange={(e) => setContent(e.target.value)}
                  rows={5}
                  required
                />
              </div>

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setIsDialogOpen(false)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={saving}>
                  {saving ? 'Saving...' : editingNote ? 'Update' : 'Create'}
                </Button>
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>
      </div>

      {/* Notes Grid */}
      {filteredNotes.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <StickyNote className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No notes found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery || categoryFilter !== 'all'
                ? 'Try adjusting your search or filter'
                : 'Add your first note to get started'}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-6">
          {/* Pinned Notes */}
          {pinnedNotes.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                <Pin className="h-4 w-4" />
                Pinned Notes
              </h3>
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {pinnedNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    getCategoryLabel={getCategoryLabel}
                    getCategoryColor={getCategoryColor}
                    canEdit={canEditNote(note)}
                    canDelete={canDeleteNote()}
                    onEdit={() => openEditDialog(note)}
                    onDelete={() => handleDelete(note)}
                    onTogglePin={() => handleTogglePin(note)}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Other Notes */}
          {unpinnedNotes.length > 0 && (
            <div className="space-y-3">
              {pinnedNotes.length > 0 && (
                <h3 className="text-sm font-medium text-muted-foreground">Other Notes</h3>
              )}
              <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
                {unpinnedNotes.map((note) => (
                  <NoteCard
                    key={note.id}
                    note={note}
                    getCategoryLabel={getCategoryLabel}
                    getCategoryColor={getCategoryColor}
                    canEdit={canEditNote(note)}
                    canDelete={canDeleteNote()}
                    onEdit={() => openEditDialog(note)}
                    onDelete={() => handleDelete(note)}
                    onTogglePin={() => handleTogglePin(note)}
                  />
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function NoteCard({
  note,
  getCategoryLabel,
  getCategoryColor,
  canEdit,
  canDelete,
  onEdit,
  onDelete,
  onTogglePin,
}: {
  note: Note;
  getCategoryLabel: (cat: string | null) => string;
  getCategoryColor: (cat: string | null) => string;
  canEdit: boolean;
  canDelete: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onTogglePin: () => void;
}) {
  return (
    <Card className={note.is_pinned ? 'border-primary/50 bg-primary/5' : ''}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <div className="flex-1 min-w-0">
            <CardTitle className="text-base flex items-center gap-2">
              {note.is_pinned && <Pin className="h-4 w-4 text-primary shrink-0" />}
              <span className="truncate">{note.title}</span>
            </CardTitle>
            <div className="flex items-center gap-2 mt-1">
              <Badge variant={getCategoryColor(note.category) as any} className="text-xs">
                {getCategoryLabel(note.category)}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {format(new Date(note.created_at), 'MMM d, yyyy')}
              </span>
            </div>
          </div>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="shrink-0">
                <MoreVertical className="h-4 w-4" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={onTogglePin}>
                {note.is_pinned ? (
                  <>
                    <PinOff className="h-4 w-4 mr-2" />
                    Unpin
                  </>
                ) : (
                  <>
                    <Pin className="h-4 w-4 mr-2" />
                    Pin
                  </>
                )}
              </DropdownMenuItem>
              {canEdit && (
                <DropdownMenuItem onClick={onEdit}>
                  <Edit className="h-4 w-4 mr-2" />
                  Edit
                </DropdownMenuItem>
              )}
              {canDelete && (
                <DropdownMenuItem onClick={onDelete} className="text-destructive focus:text-destructive">
                  <Trash2 className="h-4 w-4 mr-2" />
                  Delete
                </DropdownMenuItem>
              )}
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground line-clamp-4 whitespace-pre-wrap">{note.content}</p>
      </CardContent>
    </Card>
  );
}

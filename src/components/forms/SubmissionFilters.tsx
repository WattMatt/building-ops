/**
 * Search and filter controls for form submissions
 */

import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Search, X } from 'lucide-react';

interface SubmissionFiltersProps {
  searchQuery: string;
  onSearchChange: (query: string) => void;
  statusFilter: string;
  onStatusChange: (status: string) => void;
  formFilter: string;
  onFormChange: (form: string) => void;
  formNames: string[];
}

export function SubmissionFilters({
  searchQuery,
  onSearchChange,
  statusFilter,
  onStatusChange,
  formFilter,
  onFormChange,
  formNames,
}: SubmissionFiltersProps) {
  const hasFilters = searchQuery || statusFilter !== 'all' || formFilter !== 'all';

  const clearFilters = () => {
    onSearchChange('');
    onStatusChange('all');
    onFormChange('all');
  };

  return (
    <div className="flex flex-col sm:flex-row gap-3">
      {/* Search */}
      <div className="relative flex-1">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search submissions..."
          value={searchQuery}
          onChange={(e) => onSearchChange(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Status Filter */}
      <Select value={statusFilter} onValueChange={onStatusChange}>
        <SelectTrigger className="w-full sm:w-[140px]">
          <SelectValue placeholder="Status" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Status</SelectItem>
          <SelectItem value="submitted">Pending</SelectItem>
          <SelectItem value="reviewed">Reviewed</SelectItem>
          <SelectItem value="approved">Approved</SelectItem>
          <SelectItem value="rejected">Rejected</SelectItem>
        </SelectContent>
      </Select>

      {/* Form Type Filter */}
      <Select value={formFilter} onValueChange={onFormChange}>
        <SelectTrigger className="w-full sm:w-[180px]">
          <SelectValue placeholder="Form Type" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">All Forms</SelectItem>
          {formNames.map((name) => (
            <SelectItem key={name} value={name}>
              {name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>

      {/* Clear Filters */}
      {hasFilters && (
        <Button variant="ghost" size="icon" onClick={clearFilters} title="Clear filters">
          <X className="h-4 w-4" />
        </Button>
      )}
    </div>
  );
}

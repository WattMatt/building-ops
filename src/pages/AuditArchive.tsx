import { useState } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  FileText,
  Search,
  Download,
  Calendar,
  User,
  Building2,
  Filter,
} from 'lucide-react';
import { format } from 'date-fns';

interface AuditLog {
  id: string;
  action: string;
  entity_type: string;
  user_name: string;
  building_name: string;
  created_at: string;
  details: string;
}

// Mock data
const mockAuditLogs: AuditLog[] = [
  {
    id: '1',
    action: 'Task Completed',
    entity_type: 'task_completion',
    user_name: 'John Doe',
    building_name: 'Menlyn Mall',
    created_at: '2024-01-20T14:30:00Z',
    details: 'Restroom Consumables Restock completed with photo evidence',
  },
  {
    id: '2',
    action: 'Issue Created',
    entity_type: 'issue',
    user_name: 'Jane Smith',
    building_name: 'Brooklyn Mall',
    created_at: '2024-01-20T13:15:00Z',
    details: 'HVAC not cooling properly - Priority: High',
  },
  {
    id: '3',
    action: 'Issue Resolved',
    entity_type: 'issue',
    user_name: 'Mike Johnson',
    building_name: 'Hatfield Square',
    created_at: '2024-01-20T11:00:00Z',
    details: 'Parking lot lighting issue fixed',
  },
  {
    id: '4',
    action: 'Task Completed',
    entity_type: 'task_completion',
    user_name: 'Sarah Wilson',
    building_name: 'Centurion Mall',
    created_at: '2024-01-20T10:45:00Z',
    details: 'Fire Extinguisher Visual Check completed',
  },
  {
    id: '5',
    action: 'Building Added',
    entity_type: 'building',
    user_name: 'Admin User',
    building_name: 'New Building',
    created_at: '2024-01-19T16:00:00Z',
    details: 'New building added to portfolio',
  },
];

const actionColors: Record<string, string> = {
  'Task Completed': 'bg-success text-success-foreground',
  'Issue Created': 'bg-warning text-warning-foreground',
  'Issue Resolved': 'bg-info text-info-foreground',
  'Building Added': 'bg-primary text-primary-foreground',
};

export default function AuditArchive() {
  const [logs, setLogs] = useState<AuditLog[]>(mockAuditLogs);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredLogs = logs.filter(
    (log) =>
      log.action.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.user_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.building_name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      log.details.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Audit Archive</h1>
          <p className="text-muted-foreground">
            Complete audit trail of all compliance activities
          </p>
        </div>
        <Button variant="outline">
          <Download className="w-4 h-4 mr-2" />
          Export Logs
        </Button>
      </div>

      {/* Search */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1 max-w-md">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search audit logs..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {/* Audit Log Table */}
      <Card>
        <CardHeader>
          <CardTitle>Activity Log</CardTitle>
          <CardDescription>
            Searchable archive with 12+ month retention
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Timestamp</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>User</TableHead>
                <TableHead>Building</TableHead>
                <TableHead>Details</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredLogs.map((log) => (
                <TableRow key={log.id}>
                  <TableCell className="whitespace-nowrap">
                    <div className="flex items-center gap-2 text-sm">
                      <Calendar className="h-4 w-4 text-muted-foreground" />
                      {format(new Date(log.created_at), 'MMM d, yyyy HH:mm')}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant="secondary"
                      className={actionColors[log.action] || 'bg-muted'}
                    >
                      {log.action}
                    </Badge>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <User className="h-4 w-4 text-muted-foreground" />
                      {log.user_name}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <Building2 className="h-4 w-4 text-muted-foreground" />
                      {log.building_name}
                    </div>
                  </TableCell>
                  <TableCell className="max-w-xs truncate">
                    {log.details}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {filteredLogs.length === 0 && (
            <div className="flex flex-col items-center justify-center py-12">
              <FileText className="h-12 w-12 text-muted-foreground mb-4" />
              <h3 className="text-lg font-semibold mb-2">No logs found</h3>
              <p className="text-muted-foreground text-center">
                Try adjusting your search query
              </p>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

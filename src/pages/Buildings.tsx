import { useState } from 'react';
import { formatBuildingName } from '@/lib/buildingName';
import { useAuth } from '@/contexts/AuthContext';
import { useBuildings } from '@/hooks/useBuildings';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Building2,
  Plus,
  Search,
  MapPin,
  MoreVertical,
  Edit,
  Trash2,
  Eye,
  Upload,
  Camera,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';
import { BuildingAvatar } from '@/components/building/BuildingAvatar';
import { BuildingAvatarDialog } from '@/components/building/BuildingAvatarDialog';
import BuildingImportDialog from '@/components/building/BuildingImportDialog';
import { BuildingScoreChips } from '@/components/building/BuildingScoreChips';
import { chipValues, useBuildingsScores } from '@/hooks/useBuildingsScores';
import { useBuildingsTrends } from '@/hooks/useBuildingTrend';
import { usePortfolioCoverage } from '@/hooks/usePortfolioCoverage';
import { ExportCsvButton } from '@/components/ui/export-csv-button';
import { csvText, type CsvColumn } from '@/lib/exportCsv';
import type { Tables } from '@/integrations/supabase/types';

type BuildingRow = Tables<'buildings'>;

export const BUILDING_CSV_COLUMNS: CsvColumn<BuildingRow>[] = [
  { key: 'name', header: 'Name' },
  { key: 'address', header: 'Address', format: csvText },
  { key: 'city', header: 'City', format: csvText },
  { key: 'latitude', header: 'Latitude', format: (v) => (v == null ? '' : String(v)) },
  { key: 'longitude', header: 'Longitude', format: (v) => (v == null ? '' : String(v)) },
  { key: 'timezone', header: 'Timezone', format: csvText },
  // Which reports the building owes; ";" so a spreadsheet keeps them in one cell.
  { key: 'report_types', header: 'Report types', format: (v) => (Array.isArray(v) ? v.join(';') : '') },
];

export default function Buildings() {
  const { isAdminOrManager } = useAuth();
  const { buildings, loading, error, refetch, deleteBuilding } = useBuildings();
  // One snapshot read for the grid (sparklines AND chip values, from each building's latest fresh row);
  // the live scores are only the fallback for buildings the snapshot does not cover yet.
  const { scores } = useBuildingsScores();
  const trends = useBuildingsTrends(30);
  // Coverage rows are RLS-scoped and only meaningful for managers; the hook is disabled for everyone else.
  const coverage = usePortfolioCoverage(isAdminOrManager);
  const [searchQuery, setSearchQuery] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [avatarDialogBuilding, setAvatarDialogBuilding] = useState<{
    id: string;
    name: string;
    logo_url: string | null;
    avatar_color: string | null;
  } | null>(null);

  const filteredBuildings = buildings.filter(
    (building) =>
      building.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      (building.address ?? '').toLowerCase().includes(searchQuery.toLowerCase()) ||
      (building.city ?? '').toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure you want to delete this building?')) return;
    await deleteBuilding(id);
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold">Buildings</h1>
          <p className="text-muted-foreground">Manage your building portfolio</p>
        </div>
        <Card className="border-destructive/50">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center mb-4">
              <Building2 className="h-6 w-6 text-destructive" />
            </div>
            <h3 className="text-lg font-semibold mb-2">Failed to load buildings</h3>
            <p className="text-muted-foreground text-center mb-4 max-w-md">
              {error.message || 'An unexpected error occurred while fetching buildings.'}
            </p>
            <Button onClick={() => refetch()} variant="outline">
              Try Again
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Buildings</h1>
          <p className="text-muted-foreground">
            Manage your building portfolio
          </p>
        </div>
        {isAdminOrManager && (
          <div className="flex gap-2">
            {/* Exactly the rows on screen after the search. */}
            <ExportCsvButton rows={filteredBuildings} columns={BUILDING_CSV_COLUMNS} filename="buildings" />
            <Button variant="outline" onClick={() => setImportDialogOpen(true)}>
              <Upload className="w-4 h-4 mr-2" />
              Import
            </Button>
            <Button asChild>
              <Link to="/buildings/new">
                <Plus className="w-4 h-4 mr-2" />
                Add Building
              </Link>
            </Button>
          </div>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <Input
          placeholder="Search buildings..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="pl-9"
        />
      </div>

      {/* Buildings Grid */}
      {filteredBuildings.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Building2 className="h-12 w-12 text-muted-foreground mb-4" />
            <h3 className="text-lg font-semibold mb-2">No buildings found</h3>
            <p className="text-muted-foreground text-center mb-4">
              {searchQuery
                ? 'Try adjusting your search terms'
                : 'Get started by adding your first building'}
            </p>
            {isAdminOrManager && !searchQuery && (
              <Button asChild>
                <Link to="/buildings/new">
                  <Plus className="w-4 h-4 mr-2" />
                  Add Building
                </Link>
              </Button>
            )}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {filteredBuildings.map((building) => {
            const position = building.logo_position || 'top-left';
            const chips = chipValues(trends.latest[building.id], scores[building.id]);

            return (
              <Card key={building.id} data-testid={`building-card-${building.id}`} className="group hover:shadow-md transition-shadow relative overflow-hidden">
                {/* Top-center logo banner */}
                {position === 'top-center' && (
                  <div className="flex justify-center pt-4 pb-2">
                    <div className="relative group/avatar">
                      <BuildingAvatar name={building.name} logoUrl={building.logo_url} avatarColor={building.avatar_color} size="lg" />
                      {isAdminOrManager && (
                        <button
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setAvatarDialogBuilding({
                              id: building.id,
                              name: building.name,
                              logo_url: building.logo_url,
                              avatar_color: building.avatar_color,
                            });
                          }}
                          className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover/avatar:opacity-100 transition-opacity rounded-lg cursor-pointer"
                          title="Change avatar"
                        >
                          <Camera className="h-4 w-4 text-white" />
                        </button>
                      )}
                    </div>
                  </div>
                )}
                
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  {/* Left side: avatar (if top-left) + text */}
                  <div className="flex items-start gap-3">
                    {position === 'top-left' && (
                      <div className="relative group/avatar">
                        <BuildingAvatar name={building.name} logoUrl={building.logo_url} avatarColor={building.avatar_color} size="md" />
                        {isAdminOrManager && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setAvatarDialogBuilding({
                                id: building.id,
                                name: building.name,
                                logo_url: building.logo_url,
                                avatar_color: building.avatar_color,
                              });
                            }}
                            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover/avatar:opacity-100 transition-opacity rounded-lg cursor-pointer"
                            title="Change avatar"
                          >
                            <Camera className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </div>
                    )}
                    <div>
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{formatBuildingName(building.name)}</CardTitle>
                        {isAdminOrManager && coverage.byBuilding.get(building.id)?.field_members === 0 && (
                          <Badge variant="destructive" className="text-xs">No team</Badge>
                        )}
                      </div>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {building.city}
                      </CardDescription>
                    </div>
                  </div>
                  
                  {/* Right side: avatar (if top-right) + menu */}
                  <div className="flex items-start gap-2">
                    {position === 'top-right' && (
                      <div className="relative group/avatar">
                        <BuildingAvatar name={building.name} logoUrl={building.logo_url} avatarColor={building.avatar_color} size="md" />
                        {isAdminOrManager && (
                          <button
                            onClick={(e) => {
                              e.preventDefault();
                              e.stopPropagation();
                              setAvatarDialogBuilding({
                                id: building.id,
                                name: building.name,
                                logo_url: building.logo_url,
                                avatar_color: building.avatar_color,
                              });
                            }}
                            className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover/avatar:opacity-100 transition-opacity rounded-lg cursor-pointer"
                            title="Change avatar"
                          >
                            <Camera className="h-3 w-3 text-white" />
                          </button>
                        )}
                      </div>
                    )}
                    {isAdminOrManager && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="opacity-0 group-hover:opacity-100 transition-opacity"
                      >
                        <MoreVertical className="h-4 w-4" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem asChild>
                        <Link to={`/buildings/${building.id}`}>
                          <Eye className="h-4 w-4 mr-2" />
                          View Details
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem asChild>
                        <Link to={`/buildings/${building.id}/edit`}>
                          <Edit className="h-4 w-4 mr-2" />
                          Edit
                        </Link>
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        onClick={() => handleDelete(building.id)}
                        className="text-destructive focus:text-destructive"
                      >
                        <Trash2 className="h-4 w-4 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                    )}
                  </div>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-muted-foreground mb-3 line-clamp-2">
                    {building.address}
                  </p>
                  <div className="mb-4">
                    <BuildingScoreChips
                      ohsPct={chips.ohsPct}
                      taskPct={chips.taskPct}
                      ohsTrend={trends.byBuilding[building.id]?.compliance}
                      taskTrend={trends.byBuilding[building.id]?.tasks}
                      asOf={chips.asOf}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Badge variant="secondary">
                      {building.latitude && building.longitude
                        ? 'Location set'
                        : 'No location'}
                    </Badge>
                    <Button variant="ghost" size="sm" asChild>
                      <Link to={`/buildings/${building.id}`}>
                        View
                      </Link>
                    </Button>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Import Dialog */}
      <BuildingImportDialog
        open={importDialogOpen}
        onOpenChange={setImportDialogOpen}
        onImportComplete={refetch}
      />

      {/* Avatar Edit Dialog */}
      {avatarDialogBuilding && (
        <BuildingAvatarDialog
          open={!!avatarDialogBuilding}
          onOpenChange={(open) => !open && setAvatarDialogBuilding(null)}
          buildingId={avatarDialogBuilding.id}
          buildingName={avatarDialogBuilding.name}
          currentLogoUrl={avatarDialogBuilding.logo_url}
          currentAvatarColor={avatarDialogBuilding.avatar_color}
          onSuccess={() => {
            setAvatarDialogBuilding(null);
            refetch();
          }}
        />
      )}
    </div>
  );
}

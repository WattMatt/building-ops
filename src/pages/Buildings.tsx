import { useState } from 'react';
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
  ImageIcon,
  Type,
} from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Link } from 'react-router-dom';
import { BuildingAvatar } from '@/components/building/BuildingAvatar';
import BuildingImportDialog from '@/components/building/BuildingImportDialog';

export default function Buildings() {
  const { isAdminOrManager } = useAuth();
  const { buildings, loading, refetch, deleteBuilding } = useBuildings();
  const [searchQuery, setSearchQuery] = useState('');
  const [importDialogOpen, setImportDialogOpen] = useState(false);

  const filteredBuildings = buildings.filter(
    (building) =>
      building.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      building.address.toLowerCase().includes(searchQuery.toLowerCase()) ||
      building.city.toLowerCase().includes(searchQuery.toLowerCase())
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

            const hasCustomLogo = building.logo_url && !building.logo_url.includes('dicebear');
            const hasPattern = building.logo_url?.includes('dicebear');

            return (
              <Card key={building.id} className="group hover:shadow-md transition-shadow relative overflow-hidden">
                {/* Avatar type indicator badge */}
                <div className="absolute top-2 right-2 z-10">
                  {hasCustomLogo ? (
                    <Badge variant="secondary" className="text-xs gap-1 px-1.5 py-0.5 bg-primary/10 text-primary border-primary/20">
                      <ImageIcon className="h-3 w-3" />
                      <span className="hidden sm:inline">Logo</span>
                    </Badge>
                  ) : hasPattern ? (
                    <Badge variant="secondary" className="text-xs gap-1 px-1.5 py-0.5">
                      <Building2 className="h-3 w-3" />
                      <span className="hidden sm:inline">Pattern</span>
                    </Badge>
                  ) : (
                    <Badge variant="outline" className="text-xs gap-1 px-1.5 py-0.5">
                      <Type className="h-3 w-3" />
                      <span className="hidden sm:inline">Initials</span>
                    </Badge>
                  )}
                </div>

                {/* Top-center logo banner */}
                {position === 'top-center' && (
                  <div className="flex justify-center pt-4 pb-2">
                    <BuildingAvatar name={building.name} logoUrl={building.logo_url} avatarColor={building.avatar_color} size="lg" />
                  </div>
                )}
                
                <CardHeader className="flex flex-row items-start justify-between space-y-0 pb-2">
                  {/* Left side: avatar (if top-left) + text */}
                  <div className="flex items-start gap-3">
                    {position === 'top-left' && (
                      <BuildingAvatar name={building.name} logoUrl={building.logo_url} avatarColor={building.avatar_color} size="md" />
                    )}
                    <div>
                      <CardTitle className="text-base">{building.name}</CardTitle>
                      <CardDescription className="flex items-center gap-1 mt-1">
                        <MapPin className="h-3 w-3" />
                        {building.city}
                      </CardDescription>
                    </div>
                  </div>
                  
                  {/* Right side: avatar (if top-right) + menu */}
                  <div className="flex items-start gap-2">
                    {position === 'top-right' && (
                      <BuildingAvatar name={building.name} logoUrl={building.logo_url} avatarColor={building.avatar_color} size="md" />
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
                  <p className="text-sm text-muted-foreground mb-4 line-clamp-2">
                    {building.address}
                  </p>
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
    </div>
  );
}

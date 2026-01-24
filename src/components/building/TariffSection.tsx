import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Zap, Droplets } from 'lucide-react';

export interface UtilityTariff {
  rate: string;
  unit: string;
  notes: string;
}

export interface UtilityTariffs {
  electricity: UtilityTariff;
  water: UtilityTariff;
}

interface TariffSectionProps {
  tariffs: UtilityTariffs;
  onChange: (tariffs: UtilityTariffs) => void;
}

export default function TariffSection({ tariffs, onChange }: TariffSectionProps) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5" />
          Bulk Utility Tariffs
        </CardTitle>
        <CardDescription>
          Tariff structures for electricity and water
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Electricity Tariff */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Zap className="h-4 w-4 text-warning" />
            Electricity
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="elec-rate">Rate</Label>
              <Input
                id="elec-rate"
                placeholder="e.g., R2.50"
                value={tariffs.electricity.rate}
                onChange={(e) =>
                  onChange({
                    ...tariffs,
                    electricity: { ...tariffs.electricity, rate: e.target.value },
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="elec-unit">Unit</Label>
              <Input
                id="elec-unit"
                placeholder="e.g., kWh"
                value={tariffs.electricity.unit}
                onChange={(e) =>
                  onChange({
                    ...tariffs,
                    electricity: { ...tariffs.electricity, unit: e.target.value },
                  })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="elec-notes">Tariff Notes</Label>
            <Textarea
              id="elec-notes"
              placeholder="Additional tariff details, tiers, or special conditions..."
              value={tariffs.electricity.notes}
              onChange={(e) =>
                onChange({
                  ...tariffs,
                  electricity: { ...tariffs.electricity, notes: e.target.value },
                })
              }
              rows={2}
            />
          </div>
        </div>

        {/* Water Tariff */}
        <div className="space-y-4">
          <div className="flex items-center gap-2 text-sm font-medium">
            <Droplets className="h-4 w-4 text-info" />
            Water
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label htmlFor="water-rate">Rate</Label>
              <Input
                id="water-rate"
                placeholder="e.g., R15.00"
                value={tariffs.water.rate}
                onChange={(e) =>
                  onChange({
                    ...tariffs,
                    water: { ...tariffs.water, rate: e.target.value },
                  })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="water-unit">Unit</Label>
              <Input
                id="water-unit"
                placeholder="e.g., kL"
                value={tariffs.water.unit}
                onChange={(e) =>
                  onChange({
                    ...tariffs,
                    water: { ...tariffs.water, unit: e.target.value },
                  })
                }
              />
            </div>
          </div>
          <div className="space-y-2">
            <Label htmlFor="water-notes">Tariff Notes</Label>
            <Textarea
              id="water-notes"
              placeholder="Additional tariff details, tiers, or special conditions..."
              value={tariffs.water.notes}
              onChange={(e) =>
                onChange({
                  ...tariffs,
                  water: { ...tariffs.water, notes: e.target.value },
                })
              }
              rows={2}
            />
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

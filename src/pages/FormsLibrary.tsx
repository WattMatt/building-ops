/**
 * Forms Library — the active `form_templates` rows (spec §5.11). The catalogue used to be a
 * hard-coded array here and a second, divergent one in the building Forms tab; both now read
 * the one table through useFormTemplates().
 */
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Eye, Loader2, PenLine, History } from 'lucide-react';
import { FormPreviewDialog } from '@/components/forms/FormPreviewDialog';
import { FillableFormDialog } from '@/components/forms/FillableFormDialog';
import { FormSubmissionsDialog } from '@/components/forms/FormSubmissionsDialog';
import { FormIcon } from '@/components/forms/FormIcon';
import { formCategoryClass, useFormTemplates, type FormTemplate } from '@/hooks/useFormTemplates';

export default function FormsLibrary() {
  const { templates, isLoading, isError } = useFormTemplates();
  const [selectedForm, setSelectedForm] = useState<FormTemplate | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [fillOpen, setFillOpen] = useState(false);
  const [submissionsOpen, setSubmissionsOpen] = useState(false);

  const handlePreview = (form: FormTemplate) => {
    setSelectedForm(form);
    setPreviewOpen(true);
  };

  const handleFill = (form: FormTemplate) => {
    setSelectedForm(form);
    setFillOpen(true);
  };

  const handleViewSubmissions = (form: FormTemplate) => {
    setSelectedForm(form);
    setSubmissionsOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Forms Library</h1>
          <p className="text-muted-foreground">
            Standard FM forms for printing and digital completion
          </p>
        </div>
      </div>

      {isLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <p className="text-sm text-destructive">Could not load the forms library.</p>
      ) : templates.length === 0 ? (
        <p className="text-sm text-muted-foreground">No forms are available yet.</p>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {templates.map((form) => (
            <Card key={form.id} className="hover:shadow-md transition-shadow">
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-lg bg-primary/10 flex items-center justify-center text-primary">
                      <FormIcon name={form.icon} />
                    </div>
                    <div>
                      <CardTitle className="text-base leading-tight">
                        {form.name}
                      </CardTitle>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground mb-4">
                  {form.description}
                </p>
                <div className="flex items-center justify-between">
                  <Badge variant="secondary" className={formCategoryClass(form.category)}>
                    {form.category}
                  </Badge>
                  <div className="flex items-center gap-1">
                    <Button
                      variant="default"
                      size="sm"
                      onClick={() => handleFill(form)}
                      title="Fill form digitally"
                    >
                      <PenLine className="h-4 w-4 mr-1" />
                      Fill
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handlePreview(form)}
                      title="Preview form"
                    >
                      <Eye className="h-4 w-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleViewSubmissions(form)}
                      title="View submissions"
                    >
                      <History className="h-4 w-4" />
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Form Preview Dialog */}
      <FormPreviewDialog
        form={selectedForm}
        open={previewOpen}
        onOpenChange={setPreviewOpen}
      />

      {/* Fillable Form Dialog */}
      <FillableFormDialog
        form={selectedForm}
        open={fillOpen}
        onOpenChange={setFillOpen}
      />

      {/* Form Submissions Dialog */}
      <FormSubmissionsDialog
        form={selectedForm}
        open={submissionsOpen}
        onOpenChange={setSubmissionsOpen}
      />
    </div>
  );
}

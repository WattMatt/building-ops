-- =====================================================
-- FM COMPLIANCE SAAS - CORE DATABASE SCHEMA
-- =====================================================

-- 1. CREATE ROLE ENUM
CREATE TYPE public.app_role AS ENUM ('admin', 'manager', 'user', 'reviewer');

-- 2. CREATE TASK FREQUENCY ENUM
CREATE TYPE public.task_frequency AS ENUM ('daily', 'weekly', 'monthly', 'quarterly', 'annually');

-- 3. CREATE TASK STATUS ENUM
CREATE TYPE public.task_status AS ENUM ('pending', 'completed', 'overdue', 'issue_logged');

-- 4. CREATE ISSUE PRIORITY ENUM
CREATE TYPE public.issue_priority AS ENUM ('low', 'medium', 'high', 'critical');

-- 5. CREATE ISSUE STATUS ENUM
CREATE TYPE public.issue_status AS ENUM ('open', 'in_progress', 'resolved', 'escalated');

-- =====================================================
-- PROFILES TABLE (basic user info)
-- =====================================================
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  full_name TEXT,
  avatar_url TEXT,
  phone TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- USER ROLES TABLE (separate for security)
-- =====================================================
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- =====================================================
-- ORGANIZATION TABLE (single tenant)
-- =====================================================
CREATE TABLE public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  logo_url TEXT,
  primary_color TEXT DEFAULT '#2563eb',
  address TEXT,
  phone TEXT,
  email TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- BUILDINGS TABLE
-- =====================================================
CREATE TABLE public.buildings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL DEFAULT 'City of Tshwane',
  timezone TEXT NOT NULL DEFAULT 'Africa/Johannesburg',
  latitude DOUBLE PRECISION,
  longitude DOUBLE PRECISION,
  logo_url TEXT,
  emergency_contacts JSONB DEFAULT '[]'::jsonb,
  statutory_certificates JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- USER BUILDING ASSIGNMENTS (which users can access which buildings)
-- =====================================================
CREATE TABLE public.user_building_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  building_id UUID REFERENCES public.buildings(id) ON DELETE CASCADE NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  UNIQUE (user_id, building_id)
);

-- =====================================================
-- CHECKLIST TEMPLATES
-- =====================================================
CREATE TABLE public.checklist_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE NOT NULL,
  name TEXT NOT NULL,
  description TEXT,
  frequency task_frequency NOT NULL,
  responsible_role app_role NOT NULL,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- TEMPLATE ITEMS (tasks within a template)
-- =====================================================
CREATE TABLE public.template_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID REFERENCES public.checklist_templates(id) ON DELETE CASCADE NOT NULL,
  task_name TEXT NOT NULL,
  task_description TEXT,
  requires_photo BOOLEAN DEFAULT false,
  requires_signature BOOLEAN DEFAULT true,
  display_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- TASK INSTANCES (generated from templates for specific dates/buildings)
-- =====================================================
CREATE TABLE public.task_instances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_item_id UUID REFERENCES public.template_items(id) ON DELETE SET NULL,
  building_id UUID REFERENCES public.buildings(id) ON DELETE CASCADE NOT NULL,
  task_name TEXT NOT NULL,
  task_description TEXT,
  frequency task_frequency NOT NULL,
  responsible_role app_role NOT NULL,
  due_date DATE NOT NULL,
  status task_status NOT NULL DEFAULT 'pending',
  requires_photo BOOLEAN DEFAULT false,
  requires_signature BOOLEAN DEFAULT true,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- TASK COMPLETIONS (audit log of completed tasks)
-- =====================================================
CREATE TABLE public.task_completions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_instance_id UUID REFERENCES public.task_instances(id) ON DELETE CASCADE NOT NULL,
  completed_by UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  completed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  notes TEXT,
  photo_urls TEXT[] DEFAULT '{}',
  signature_confirmed BOOLEAN DEFAULT false,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- ISSUES (escalation workflow)
-- =====================================================
CREATE TABLE public.issues (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  task_instance_id UUID REFERENCES public.task_instances(id) ON DELETE SET NULL,
  building_id UUID REFERENCES public.buildings(id) ON DELETE CASCADE NOT NULL,
  reported_by UUID REFERENCES auth.users(id) ON DELETE SET NULL NOT NULL,
  assigned_to UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  corrective_action TEXT,
  priority issue_priority NOT NULL DEFAULT 'medium',
  status issue_status NOT NULL DEFAULT 'open',
  deadline DATE,
  resolved_at TIMESTAMP WITH TIME ZONE,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  photo_urls TEXT[] DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- AUDIT LOG (immutable record of all actions)
-- =====================================================
CREATE TABLE public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id UUID NOT NULL,
  details JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- =====================================================
-- SECURITY DEFINER FUNCTIONS
-- =====================================================

-- Function to check if user has a specific role
CREATE OR REPLACE FUNCTION public.has_role(_user_id UUID, _role app_role)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Function to check if user is admin or manager
CREATE OR REPLACE FUNCTION public.is_admin_or_manager(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role IN ('admin', 'manager')
  )
$$;

-- Function to check if user has access to a building
CREATE OR REPLACE FUNCTION public.has_building_access(_user_id UUID, _building_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT 
    public.is_admin_or_manager(_user_id) 
    OR EXISTS (
      SELECT 1
      FROM public.user_building_assignments
      WHERE user_id = _user_id
        AND building_id = _building_id
    )
$$;

-- Function to get user's role
CREATE OR REPLACE FUNCTION public.get_user_role(_user_id UUID)
RETURNS app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role
  FROM public.user_roles
  WHERE user_id = _user_id
  LIMIT 1
$$;

-- =====================================================
-- TRIGGER: Auto-create profile on user signup
-- =====================================================
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', '')
  );
  
  -- Assign default 'user' role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- =====================================================
-- TRIGGER: Update timestamps
-- =====================================================
CREATE OR REPLACE FUNCTION public.update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_buildings_updated_at
  BEFORE UPDATE ON public.buildings
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_checklist_templates_updated_at
  BEFORE UPDATE ON public.checklist_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_task_instances_updated_at
  BEFORE UPDATE ON public.task_instances
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TRIGGER update_issues_updated_at
  BEFORE UPDATE ON public.issues
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =====================================================
-- ROW LEVEL SECURITY POLICIES
-- =====================================================

-- Enable RLS on all tables
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.buildings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_building_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checklist_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_instances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.issues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- PROFILES POLICIES
CREATE POLICY "Users can view their own profile"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins and managers can view all profiles"
  ON public.profiles FOR SELECT
  USING (public.is_admin_or_manager(auth.uid()));

CREATE POLICY "Users can update their own profile"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- USER ROLES POLICIES (only admins can manage roles)
CREATE POLICY "Users can view their own role"
  ON public.user_roles FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can insert roles"
  ON public.user_roles FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can update roles"
  ON public.user_roles FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can delete roles"
  ON public.user_roles FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- ORGANIZATIONS POLICIES
CREATE POLICY "Authenticated users can view organizations"
  ON public.organizations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can manage organizations"
  ON public.organizations FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- BUILDINGS POLICIES
CREATE POLICY "Users can view buildings they have access to"
  ON public.buildings FOR SELECT
  USING (public.has_building_access(auth.uid(), id));

CREATE POLICY "Admins can manage buildings"
  ON public.buildings FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Managers can update buildings"
  ON public.buildings FOR UPDATE
  USING (public.has_role(auth.uid(), 'manager'));

-- USER BUILDING ASSIGNMENTS POLICIES
CREATE POLICY "Users can view their own building assignments"
  ON public.user_building_assignments FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all building assignments"
  ON public.user_building_assignments FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Admins can manage building assignments"
  ON public.user_building_assignments FOR ALL
  USING (public.has_role(auth.uid(), 'admin'));

-- CHECKLIST TEMPLATES POLICIES
CREATE POLICY "Authenticated users can view active templates"
  ON public.checklist_templates FOR SELECT
  TO authenticated
  USING (is_active = true OR public.is_admin_or_manager(auth.uid()));

CREATE POLICY "Admins and managers can manage templates"
  ON public.checklist_templates FOR ALL
  USING (public.is_admin_or_manager(auth.uid()));

-- TEMPLATE ITEMS POLICIES
CREATE POLICY "Authenticated users can view template items"
  ON public.template_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins and managers can manage template items"
  ON public.template_items FOR ALL
  USING (public.is_admin_or_manager(auth.uid()));

-- TASK INSTANCES POLICIES
CREATE POLICY "Users can view tasks for their buildings"
  ON public.task_instances FOR SELECT
  USING (public.has_building_access(auth.uid(), building_id));

CREATE POLICY "Admins and managers can manage all tasks"
  ON public.task_instances FOR ALL
  USING (public.is_admin_or_manager(auth.uid()));

CREATE POLICY "Users can update tasks for their buildings"
  ON public.task_instances FOR UPDATE
  USING (public.has_building_access(auth.uid(), building_id));

-- TASK COMPLETIONS POLICIES
CREATE POLICY "Users can view completions for their buildings"
  ON public.task_completions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.task_instances ti
      WHERE ti.id = task_instance_id
      AND public.has_building_access(auth.uid(), ti.building_id)
    )
  );

CREATE POLICY "Users can create completions for accessible tasks"
  ON public.task_completions FOR INSERT
  WITH CHECK (
    auth.uid() = completed_by
    AND EXISTS (
      SELECT 1 FROM public.task_instances ti
      WHERE ti.id = task_instance_id
      AND public.has_building_access(auth.uid(), ti.building_id)
    )
  );

-- ISSUES POLICIES
CREATE POLICY "Users can view issues for their buildings"
  ON public.issues FOR SELECT
  USING (public.has_building_access(auth.uid(), building_id));

CREATE POLICY "Users can create issues for their buildings"
  ON public.issues FOR INSERT
  WITH CHECK (
    auth.uid() = reported_by
    AND public.has_building_access(auth.uid(), building_id)
  );

CREATE POLICY "Users can update issues they reported or are assigned to"
  ON public.issues FOR UPDATE
  USING (
    auth.uid() = reported_by 
    OR auth.uid() = assigned_to
    OR public.is_admin_or_manager(auth.uid())
  );

CREATE POLICY "Admins can delete issues"
  ON public.issues FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- AUDIT LOGS POLICIES (read-only for admins/reviewers)
CREATE POLICY "Admins and reviewers can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin') 
    OR public.has_role(auth.uid(), 'reviewer')
  );

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================
CREATE INDEX idx_user_roles_user_id ON public.user_roles(user_id);
CREATE INDEX idx_buildings_organization_id ON public.buildings(organization_id);
CREATE INDEX idx_user_building_assignments_user_id ON public.user_building_assignments(user_id);
CREATE INDEX idx_user_building_assignments_building_id ON public.user_building_assignments(building_id);
CREATE INDEX idx_checklist_templates_organization_id ON public.checklist_templates(organization_id);
CREATE INDEX idx_checklist_templates_frequency ON public.checklist_templates(frequency);
CREATE INDEX idx_template_items_template_id ON public.template_items(template_id);
CREATE INDEX idx_task_instances_building_id ON public.task_instances(building_id);
CREATE INDEX idx_task_instances_due_date ON public.task_instances(due_date);
CREATE INDEX idx_task_instances_status ON public.task_instances(status);
CREATE INDEX idx_task_completions_task_instance_id ON public.task_completions(task_instance_id);
CREATE INDEX idx_task_completions_completed_by ON public.task_completions(completed_by);
CREATE INDEX idx_issues_building_id ON public.issues(building_id);
CREATE INDEX idx_issues_status ON public.issues(status);
CREATE INDEX idx_issues_assigned_to ON public.issues(assigned_to);
CREATE INDEX idx_audit_logs_user_id ON public.audit_logs(user_id);
CREATE INDEX idx_audit_logs_entity_type ON public.audit_logs(entity_type);
CREATE INDEX idx_audit_logs_created_at ON public.audit_logs(created_at);
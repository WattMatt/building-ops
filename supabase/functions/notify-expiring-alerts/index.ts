import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { Resend } from "https://esm.sh/resend@2.0.0";
import { Branding, loadBranding, renderEmail } from "../_shared/email.ts";

const resend = new Resend(Deno.env.get("RESEND_API_KEY"));
const APP_URL = (Deno.env.get("APP_URL") ?? "https://building-ops-clone.vercel.app").replace(/\/+$/, "");

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

interface ExpiringDocument {
  id: string;
  name: string;
  document_type: string;
  expiry_date: string;
  building_name: string;
  building_id: string;
  days_until_expiry: number;
}

interface OverdueMaintenance {
  id: string;
  name: string;
  category: string;
  next_service_date: string;
  building_name: string;
  building_id: string;
  days_overdue: number;
}

interface AlertSummary {
  expiringDocuments: ExpiringDocument[];
  expiredDocuments: ExpiringDocument[];
  overdueMaintenance: OverdueMaintenance[];
}

const handler = async (req: Request): Promise<Response> => {
  console.log("notify-expiring-alerts function called");

  // Handle CORS preflight requests
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    // Parse request body for options
    let notifyAdmins = true;
    let dryRun = false;
    
    try {
      const body = await req.json();
      notifyAdmins = body.notifyAdmins ?? true;
      dryRun = body.dryRun ?? false;
    } catch {
      // No body or invalid JSON, use defaults
    }

    const today = new Date();
    const thirtyDaysFromNow = new Date(today);
    thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

    console.log("Checking for expiring documents and overdue maintenance...");
    console.log(`Today: ${today.toISOString()}`);
    console.log(`30 days from now: ${thirtyDaysFromNow.toISOString()}`);

    // Fetch expiring documents (expiring within 30 days or already expired)
    const { data: documents, error: docError } = await supabase
      .from("building_documents")
      .select(`
        id,
        name,
        document_type,
        expiry_date,
        buildings!inner(id, name)
      `)
      .not("expiry_date", "is", null)
      .lte("expiry_date", thirtyDaysFromNow.toISOString().split("T")[0])
      .order("expiry_date", { ascending: true });

    if (docError) {
      console.error("Error fetching documents:", docError);
      throw docError;
    }

    console.log(`Found ${documents?.length || 0} documents expiring soon or expired`);

    // Fetch overdue maintenance (assets with next_service_date in the past)
    const { data: assets, error: assetError } = await supabase
      .from("building_assets")
      .select(`
        id,
        name,
        category,
        next_service_date,
        buildings!inner(id, name)
      `)
      .not("next_service_date", "is", null)
      .lt("next_service_date", today.toISOString().split("T")[0])
      .order("next_service_date", { ascending: true });

    if (assetError) {
      console.error("Error fetching assets:", assetError);
      throw assetError;
    }

    console.log(`Found ${assets?.length || 0} assets with overdue maintenance`);

    // Process documents
    const expiringDocuments: ExpiringDocument[] = [];
    const expiredDocuments: ExpiringDocument[] = [];

    for (const doc of documents || []) {
      const expiryDate = new Date(doc.expiry_date);
      const diffTime = expiryDate.getTime() - today.getTime();
      const daysUntilExpiry = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      const building = (doc.buildings as unknown) as { id: string; name: string };
      
      const docInfo: ExpiringDocument = {
        id: doc.id,
        name: doc.name,
        document_type: doc.document_type,
        expiry_date: doc.expiry_date,
        building_name: building.name,
        building_id: building.id,
        days_until_expiry: daysUntilExpiry,
      };

      if (daysUntilExpiry < 0) {
        expiredDocuments.push(docInfo);
      } else {
        expiringDocuments.push(docInfo);
      }
    }

    // Process overdue maintenance
    const overdueMaintenance: OverdueMaintenance[] = [];

    for (const asset of assets || []) {
      const serviceDate = new Date(asset.next_service_date);
      const diffTime = today.getTime() - serviceDate.getTime();
      const daysOverdue = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
      
      const building = (asset.buildings as unknown) as { id: string; name: string };
      
      overdueMaintenance.push({
        id: asset.id,
        name: asset.name,
        category: asset.category,
        next_service_date: asset.next_service_date,
        building_name: building.name,
        building_id: building.id,
        days_overdue: daysOverdue,
      });
    }

    const alertSummary: AlertSummary = {
      expiringDocuments,
      expiredDocuments,
      overdueMaintenance,
    };

    const totalAlerts = expiringDocuments.length + expiredDocuments.length + overdueMaintenance.length;
    console.log(`Total alerts: ${totalAlerts}`);

    // If no alerts, return early
    if (totalAlerts === 0) {
      console.log("No alerts to send");
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: "No alerts to send",
          summary: alertSummary 
        }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Fetch admin/manager emails if we need to notify
    if (notifyAdmins && !dryRun) {
      const { data: adminUsers, error: userError } = await supabase
        .from("user_roles")
        .select(`
          user_id,
          role,
          profiles!inner(email, full_name)
        `)
        .in("role", ["admin", "manager"]);

      if (userError) {
        console.error("Error fetching admin users:", userError);
        throw userError;
      }

      console.log(`Found ${adminUsers?.length || 0} admin/manager users to notify`);

      // Load org branding once for all recipients in this run.
      const branding = await loadBranding(supabase);

      // Send email to each admin/manager
      for (const user of adminUsers || []) {
        const profile = (user.profiles as unknown) as { email: string; full_name: string | null };
        const recipientName = profile.full_name || "Admin";
        const recipientEmail = profile.email;

        console.log(`Sending alert email to ${recipientEmail}`);

        const emailHtml = generateAlertEmailHtml(branding, recipientName, alertSummary);

        try {
          const emailResponse = await resend.emails.send({
            from: `${branding.appName} <alerts@buildingops.app>`,
            to: [recipientEmail],
            subject: `⚠️ ${totalAlerts} Building Alert${totalAlerts > 1 ? 's' : ''} Require Attention`,
            html: emailHtml,
          });

          console.log(`Email sent successfully to ${recipientEmail}:`, emailResponse);
        } catch (emailError) {
          console.error(`Failed to send email to ${recipientEmail}:`, emailError);
          // Continue sending to other recipients
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: dryRun ? "Dry run completed" : "Alert notifications sent",
        summary: alertSummary,
        totalAlerts,
        recipientCount: notifyAdmins && !dryRun ? (await getAdminCount(supabase)) : 0,
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  } catch (error: any) {
    console.error("Error in notify-expiring-alerts:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
};

async function getAdminCount(supabase: any): Promise<number> {
  const { count } = await supabase
    .from("user_roles")
    .select("*", { count: "exact", head: true })
    .in("role", ["admin", "manager"]);
  return count || 0;
}

function generateAlertEmailHtml(branding: Branding, recipientName: string, alerts: AlertSummary): string {
  const { expiringDocuments, expiredDocuments, overdueMaintenance } = alerts;

  let html = `
              <p style="margin: 0 0 24px; color: #6b7280; font-size: 14px;">
                The following items require your attention:
              </p>`;

  // Expired Documents Section
  if (expiredDocuments.length > 0) {
    html += `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #dc2626; font-size: 16px; font-weight: 600; display: flex; align-items: center;">
                  🔴 Expired Documents (${expiredDocuments.length})
                </h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #fecaca; border-radius: 8px; overflow: hidden;">
                  <tr style="background-color: #fef2f2;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b; font-weight: 600;">Document</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b; font-weight: 600;">Building</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #991b1b; font-weight: 600;">Expired</th>
                  </tr>`;
    
    for (const doc of expiredDocuments) {
      html += `
                  <tr style="border-top: 1px solid #fecaca;">
                    <td style="padding: 12px; font-size: 14px; color: #374151;">${doc.name}</td>
                    <td style="padding: 12px; font-size: 14px; color: #6b7280;">${doc.building_name}</td>
                    <td style="padding: 12px; font-size: 14px; color: #dc2626; font-weight: 500;">${Math.abs(doc.days_until_expiry)} days ago</td>
                  </tr>`;
    }
    
    html += `
                </table>
              </div>`;
  }

  // Expiring Soon Documents Section
  if (expiringDocuments.length > 0) {
    html += `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #d97706; font-size: 16px; font-weight: 600;">
                  🟡 Expiring Soon (${expiringDocuments.length})
                </h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #fde68a; border-radius: 8px; overflow: hidden;">
                  <tr style="background-color: #fffbeb;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e; font-weight: 600;">Document</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e; font-weight: 600;">Building</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #92400e; font-weight: 600;">Expires In</th>
                  </tr>`;
    
    for (const doc of expiringDocuments) {
      html += `
                  <tr style="border-top: 1px solid #fde68a;">
                    <td style="padding: 12px; font-size: 14px; color: #374151;">${doc.name}</td>
                    <td style="padding: 12px; font-size: 14px; color: #6b7280;">${doc.building_name}</td>
                    <td style="padding: 12px; font-size: 14px; color: #d97706; font-weight: 500;">${doc.days_until_expiry} days</td>
                  </tr>`;
    }
    
    html += `
                </table>
              </div>`;
  }

  // Overdue Maintenance Section
  if (overdueMaintenance.length > 0) {
    html += `
              <div style="margin-bottom: 24px;">
                <h2 style="margin: 0 0 16px; color: #7c3aed; font-size: 16px; font-weight: 600;">
                  🔧 Overdue Maintenance (${overdueMaintenance.length})
                </h2>
                <table width="100%" cellpadding="0" cellspacing="0" style="border: 1px solid #c4b5fd; border-radius: 8px; overflow: hidden;">
                  <tr style="background-color: #f5f3ff;">
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #5b21b6; font-weight: 600;">Asset</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #5b21b6; font-weight: 600;">Building</th>
                    <th style="padding: 12px; text-align: left; font-size: 12px; color: #5b21b6; font-weight: 600;">Overdue</th>
                  </tr>`;
    
    for (const asset of overdueMaintenance) {
      html += `
                  <tr style="border-top: 1px solid #c4b5fd;">
                    <td style="padding: 12px; font-size: 14px; color: #374151;">${asset.name}</td>
                    <td style="padding: 12px; font-size: 14px; color: #6b7280;">${asset.building_name}</td>
                    <td style="padding: 12px; font-size: 14px; color: #7c3aed; font-weight: 500;">${asset.days_overdue} days</td>
                  </tr>`;
    }
    
    html += `
                </table>
              </div>`;
  }

  return renderEmail({
    branding,
    heading: "⚠️ Building Alerts",
    greeting: `Hi ${recipientName},`,
    bodyHtml: html,
    ctaText: "View Dashboard",
    ctaUrl: `${APP_URL}/dashboard`,
  });
}

serve(handler);

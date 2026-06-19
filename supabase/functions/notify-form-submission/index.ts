import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";
import { loadBranding, renderEmail } from "../_shared/email.ts";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
const APP_URL = (Deno.env.get("APP_URL") ?? "https://building-ops-clone.vercel.app").replace(/\/+$/, "");

async function sendEmail(from: string, to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from,
      to,
      subject,
      html,
    }),
  });
  
  if (!res.ok) {
    const error = await res.text();
    throw new Error(`Resend API error: ${error}`);
  }
  
  return res.json();
}

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface NotificationRequest {
  formName: string;
  buildingId: string;
  buildingName: string;
  submittedBy: string;
  submittedAt: string;
}

serve(async (req: Request): Promise<Response> => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    
    // Create admin client to bypass RLS
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { formName, buildingId, buildingName, submittedBy, submittedAt }: NotificationRequest = await req.json();

    console.log(`Processing notification for form: ${formName}, building: ${buildingName}`);

    // Validate required fields
    if (!formName || !buildingId || !buildingName) {
      throw new Error("Missing required fields: formName, buildingId, buildingName");
    }

    // Get all admins and managers (they have access to all buildings)
    const { data: adminManagerRoles, error: rolesError } = await supabase
      .from("user_roles")
      .select("user_id")
      .in("role", ["admin", "manager"]);

    if (rolesError) {
      console.error("Error fetching admin/manager roles:", rolesError);
      throw rolesError;
    }

    const managerUserIds = adminManagerRoles?.map(r => r.user_id) || [];
    console.log(`Found ${managerUserIds.length} admins/managers`);

    if (managerUserIds.length === 0) {
      console.log("No admins or managers found to notify");
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No managers to notify" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Get email addresses for these users from profiles
    const { data: profiles, error: profilesError } = await supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", managerUserIds);

    if (profilesError) {
      console.error("Error fetching profiles:", profilesError);
      throw profilesError;
    }

    if (!profiles || profiles.length === 0) {
      console.log("No profiles found for managers");
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No manager profiles found" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    const recipientEmails = profiles.map(p => p.email).filter(Boolean);
    console.log(`Sending notifications to ${recipientEmails.length} recipients`);

    if (recipientEmails.length === 0) {
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No valid email addresses" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Format the submission time
    const formattedTime = new Date(submittedAt).toLocaleString("en-ZA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Johannesburg",
    });

    const branding = await loadBranding(supabase);

    // Send email notification
    const emailResponse = await sendEmail(
      `${branding.appName} <notifications@buildingops.app>`,
      recipientEmails,
      `New Form Submission: ${formName}`,
      renderEmail({
        branding,
        heading: "New Form Submission",
        bodyHtml: `
          <p style="margin:0 0 16px;">
            A new form has been submitted and requires your review.
          </p>
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Form:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${formName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Building:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${buildingName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Submitted by:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${submittedBy}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Submitted at:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${formattedTime}</td>
              </tr>
            </table>
          </div>`,
        ctaText: "Review submission",
        ctaUrl: `${APP_URL}/forms`,
      })
    );

    console.log("Email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ 
        success: true, 
        notified: recipientEmails.length,
        message: `Notification sent to ${recipientEmails.length} manager(s)` 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in notify-form-submission:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});

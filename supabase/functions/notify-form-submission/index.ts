import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.49.1";

const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");

async function sendEmail(to: string[], subject: string, html: string) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${RESEND_API_KEY}`,
    },
    body: JSON.stringify({
      from: "FM Comply <notifications@fmcomply.co.za>",
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

    // Send email notification
    const emailResponse = await sendEmail(
      recipientEmails,
      `New Form Submission: ${formName}`,
      `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
        </head>
        <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background-color: #f4f4f5; margin: 0; padding: 20px;">
          <div style="max-width: 600px; margin: 0 auto; background-color: white; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 3px rgba(0,0,0,0.1);">
            <!-- Header -->
            <div style="background-color: #2563eb; padding: 24px; text-align: center;">
              <h1 style="color: white; margin: 0; font-size: 24px;">New Form Submission</h1>
            </div>
            
            <!-- Content -->
            <div style="padding: 32px;">
              <p style="color: #374151; font-size: 16px; margin: 0 0 24px;">
                A new form has been submitted and requires your review.
              </p>
              
              <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 24px;">
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
              </div>
              
              <p style="color: #6b7280; font-size: 14px; margin: 0;">
                Log in to the FM Comply platform to review this submission.
              </p>
            </div>
            
            <!-- Footer -->
            <div style="background-color: #f9fafb; padding: 16px 32px; text-align: center; border-top: 1px solid #e5e7eb;">
              <p style="color: #9ca3af; font-size: 12px; margin: 0;">
                This is an automated notification from FM Comply.
              </p>
            </div>
          </div>
        </body>
        </html>
      `
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

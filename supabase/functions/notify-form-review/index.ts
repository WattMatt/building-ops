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

interface ReviewNotificationRequest {
  submissionId: string;
  formName: string;
  buildingName: string;
  submittedById: string;
  status: 'approved' | 'rejected' | 'reviewed';
  reviewerName: string;
  reviewNotes?: string;
  reviewedAt: string;
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

    const { 
      submissionId,
      formName, 
      buildingName, 
      submittedById,
      status,
      reviewerName,
      reviewNotes,
      reviewedAt 
    }: ReviewNotificationRequest = await req.json();

    console.log(`Processing review notification for submission: ${submissionId}, status: ${status}`);

    // Only send notifications for approve/reject, not for "reviewed"
    if (status === 'reviewed') {
      console.log("Status is 'reviewed', no notification needed");
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "No notification for reviewed status" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Validate required fields
    if (!formName || !submittedById || !status) {
      throw new Error("Missing required fields: formName, submittedById, status");
    }

    // Get the submitter's email from profiles
    const { data: profile, error: profileError } = await supabase
      .from("profiles")
      .select("email, full_name")
      .eq("id", submittedById)
      .single();

    if (profileError || !profile) {
      console.error("Error fetching submitter profile:", profileError);
      return new Response(
        JSON.stringify({ success: false, message: "Submitter profile not found" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    if (!profile.email) {
      console.log("Submitter has no email address");
      return new Response(
        JSON.stringify({ success: true, notified: 0, message: "Submitter has no email" }),
        { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
      );
    }

    // Format the review time
    const formattedTime = new Date(reviewedAt).toLocaleString("en-ZA", {
      dateStyle: "medium",
      timeStyle: "short",
      timeZone: "Africa/Johannesburg",
    });

    const isApproved = status === 'approved';
    const statusLabel = isApproved ? 'Approved' : 'Rejected';
    const statusColor = isApproved ? '#16a34a' : '#dc2626';

    const branding = await loadBranding(supabase);

    // Send email notification
    const emailResponse = await sendEmail(
      `${branding.appName} <notifications@buildingops.app>`,
      [profile.email],
      `Form ${statusLabel}: ${formName}`,
      renderEmail({
        branding,
        heading: `Form ${statusLabel}`,
        greeting: `Hi ${profile.full_name || 'there'},`,
        bodyHtml: `
          <p style="margin:0 0 16px;">
            Your form submission has been <strong style="color: ${statusColor};">${status}</strong>.
          </p>
          <div style="background-color: #f9fafb; border-radius: 8px; padding: 20px; margin-bottom: 16px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px; width: 100px;">Form:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${formName}</td>
              </tr>
              ${buildingName ? `
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Building:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px; font-weight: 600;">${buildingName}</td>
              </tr>
              ` : ''}
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Reviewed by:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${reviewerName}</td>
              </tr>
              <tr>
                <td style="padding: 8px 0; color: #6b7280; font-size: 14px;">Date:</td>
                <td style="padding: 8px 0; color: #111827; font-size: 14px;">${formattedTime}</td>
              </tr>
            </table>
          </div>
          ${reviewNotes ? `
          <div style="background-color: ${isApproved ? '#f0fdf4' : '#fef2f2'}; border-left: 4px solid ${statusColor}; padding: 16px; border-radius: 4px; margin-bottom: 16px;">
            <p style="color: #374151; font-size: 14px; font-weight: 600; margin: 0 0 8px;">Reviewer Notes:</p>
            <p style="color: #4b5563; font-size: 14px; margin: 0; white-space: pre-wrap;">${reviewNotes}</p>
          </div>
          ` : ''}`,
        ctaText: "View full details",
        ctaUrl: `${APP_URL}/forms`,
      })
    );

    console.log("Review notification email sent successfully:", emailResponse);

    return new Response(
      JSON.stringify({ 
        success: true, 
        notified: 1,
        message: `Review notification sent to ${profile.email}` 
      }),
      { status: 200, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );

  } catch (error: any) {
    console.error("Error in notify-form-review:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { "Content-Type": "application/json", ...corsHeaders } }
    );
  }
});

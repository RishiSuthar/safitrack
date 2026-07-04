import { serve } from 'https://deno.land/std@0.168.0/http/server.ts'
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
    
    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error('Missing Supabase Secrets. Please run: supabase secrets set SUPABASE_URL=your_url SUPABASE_SERVICE_ROLE_KEY=your_key')
    }

    // 1. Verify the user calling this is a super admin
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      throw new Error('Missing Authorization header')
    }

    // Create a regular client to get the user's identity
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
    if (!anonKey) throw new Error('SUPABASE_ANON_KEY is missing in Edge Function secrets')

    const userClient = createClient(supabaseUrl, anonKey)

    const token = authHeader.replace('Bearer ', '').trim()
    const { data: { user }, error: userError } = await userClient.auth.getUser(token)
    
    if (userError || !user) throw new Error(`Unauthorized: ${userError?.message || 'No user found'}`)

    // Create a service client to bypass RLS
    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

    // Check if user is super admin
    const { data: profile, error: profileError } = await supabaseAdmin
      .from('profiles')
      .select('is_super_admin')
      .eq('id', user.id)
      .single()

    if (profileError || !profile?.is_super_admin) {
      throw new Error('Forbidden: Not a Super Admin')
    }

    // 2. Handle Updates
    if (req.method === 'POST') {
      let body: any = {}
      try {
        body = await req.json()
      } catch (e) {
        // body might be empty, which is fine for simple reads since invoke() defaults to POST
      }
      
      if (body.action === 'update_max_members' && body.org_id && typeof body.max_members === 'number') {
        const { error: updateError } = await supabaseAdmin
          .from('organizations')
          .update({ max_members: body.max_members })
          .eq('id', body.org_id)

        if (updateError) throw updateError
        
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      } else if (body.action === 'create_announcement') {
        const { version, date_string, items } = body.announcement;
        const { error: insertError } = await supabaseAdmin
          .from('changelogs')
          .insert([{ version, date_string, items }])
        
        if (insertError) throw insertError
        
        return new Response(
          JSON.stringify({ success: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 200 }
        )
      }
    }

    // 3. Fetch Super Admin Data
    
    // Get all organizations with owner details
    const { data: organizations, error: orgError } = await supabaseAdmin
      .from('organizations')
      .select(`
        id,
        name,
        created_at,
        max_members,
        owner_id,
        profiles (
          id,
          email,
          first_name,
          last_name
        )
      `)
      .order('created_at', { ascending: false })

    if (orgError) throw orgError;

    // Fetch AI Usage Logs
    const { data: aiUsage, error: aiUsageError } = await supabaseAdmin
      .from('ai_usage_logs')
      .select('organization_id, total_tokens');
    
    if (aiUsageError && aiUsageError.code !== '42P01') {
       // Ignore relation doesn't exist error if table hasn't been created yet
       console.error("aiUsageError", aiUsageError);
    }

    let total_ai_tokens = 0;
    const orgTokensMap: Record<string, number> = {};

    if (aiUsage) {
      aiUsage.forEach((log: any) => {
        total_ai_tokens += log.total_tokens || 0;
        if (log.organization_id) {
          orgTokensMap[log.organization_id] = (orgTokensMap[log.organization_id] || 0) + (log.total_tokens || 0);
        }
      });
    }

    // Process organizations to extract the owner profile
    const processedOrgs = organizations?.map(org => {
      const ownerProfile = org.profiles.find((p: any) => p.id === org.owner_id) || org.profiles[0];
      return {
        ...org,
        profiles: ownerProfile,
        ai_tokens: orgTokensMap[org.id] || 0
      }
    });
    
    // Get total users
    const { count: userCount, error: userCountError } = await supabaseAdmin
      .from('profiles')
      .select('*', { count: 'exact', head: true })
      
    if (userCountError) throw userCountError;

    // Get total companies (data objects, not organizations)
    const { count: companyCount, error: companyCountError } = await supabaseAdmin
      .from('companies')
      .select('*', { count: 'exact', head: true })
      
    if (companyCountError) throw companyCountError;

    // Get all changelogs for history
    const { data: changelogs, error: changelogError } = await supabaseAdmin
      .from('changelogs')
      .select('*')
      .order('created_at', { ascending: false })

    if (changelogError) throw changelogError;

    const summary = {
      total_organizations: organizations.length,
      total_users: userCount || 0,
      total_companies_tracked: companyCount || 0,
      mrr: 0, // Placeholder until Stripe is fully wired
      total_ai_tokens
    }

    return new Response(
      JSON.stringify({ 
        success: true, 
        summary,
        organizations: processedOrgs,
        changelogs
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error: any) {
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200, // Return 200 so the client can read the exact error message instead of throwing a generic 400 FunctionsHttpError
      }
    )
  }
})

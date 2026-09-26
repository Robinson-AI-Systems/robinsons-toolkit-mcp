// Legacy availability behavior, extracted unchanged. See recovery report for gating gaps.
export function getActiveNamespaces(env = process.env) {
  const namespaces = {};
  const checks = {
    github:     () => !!env.GITHUB_TOKEN,
    vercel:     () => !!env.VERCEL_TOKEN,
    neon:       () => !!env.NEON_API_KEY,
    upstash:    () => !!env.UPSTASH_REDIS_REST_URL && !!env.UPSTASH_REDIS_REST_TOKEN,
    fly:        () => !!env.FLY_API_TOKEN,
    stripe:     () => !!env.STRIPE_SECRET_KEY,
    resend:     () => !!env.RESEND_API_KEY,
    twilio:     () => !!env.TWILIO_ACCOUNT_SID && !!env.TWILIO_AUTH_TOKEN,
    cloudflare: () => !!env.CLOUDFLARE_API_TOKEN,
    openai:     () => !!env.OPENAI_API_KEY,
    anthropic:  () => !!env.ANTHROPIC_API_KEY,
    supabase:   () => !!env.SUPABASE_URL && !!env.SUPABASE_SERVICE_ROLE_KEY,
    mapbox:     () => !!env.MAPBOX_ACCESS_TOKEN,
    clerk:      () => !!env.CLERK_SECRET_KEY,
    sentry:     () => !!env.SENTRY_AUTH_TOKEN,
    brave:      () => !!env.BRAVE_SEARCH_API_KEY,
    tavily:     () => !!env.TAVILY_API_KEY,
    google:     () => !!env.GOOGLE_ACCESS_TOKEN || !!env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    qdrant:     () => !!env.QDRANT_URL,
    n8n:        () => !!env.N8N_BASE_URL && !!(env.N8N_ACCESS_TOKEN || env.N8N_API_KEY),
    postgres:   () => !!env.POSTGRES_CONNECTION_STRING,
    context7:   () => !!env.CONTEXT7_API_KEY,
    linear:     () => !!env.LINEAR_API_KEY,
    slack:      () => !!env.SLACK_BOT_TOKEN,
    gemini:     () => !!env.GEMINI_API_KEY,
    playwright: () => true, // Always available — local browser automation (no API key needed)
    local:      () => true, // Always available — local machine access
    compound:   () => true, // Always available — compound tools use whatever is configured
    ollama:     () => true, // Always available — local Ollama LLM (no API key needed)
    moonshot:   () => !!env.MOONSHOT_API_KEY,
    voyage:     () => !!env.VOYAGE_API_KEY,
    sam:        () => !!(env.SAM_API_KEY || env.INTAKE_SAM_TOKEN),
  };
  for (const [name, check] of Object.entries(checks)) {
    namespaces[name] = check();
  }
  return namespaces;
}

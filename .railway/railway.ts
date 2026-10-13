import { defineRailway, github, postgres, preserve, project, service } from "railway/iac";

export default defineRailway(() => {
  const db = postgres("postgres");

  const api = service("api", {
    source: github("arthurbpf/analytics-ai-interface", { branch: "main" }),
    healthcheck: "/api/health",
    healthcheckTimeout: 120,
    env: {
      NODE_ENV: "production",
      DATABASE_URL: db.env.DATABASE_URL,
      // Set these in the Railway dashboard (Variables) or with
      // `railway variables`; preserve() keeps the stored value.
      OPENROUTER_API_KEY: preserve(),
      OPENROUTER_MODEL: preserve(),
      GOOGLE_CLOUD_PROJECT: preserve(),
      GOOGLE_APPLICATION_CREDENTIALS_JSON: preserve(),
      // Optional. Add (and set) only when the feature is used.
      //   DATABASE_SSL_CA: preserve(),    // PEM CA for verified database TLS
      //   GOOGLE_CLIENT_ID: preserve(),
      //   GOOGLE_CLIENT_SECRET: preserve(),
      //   OPENROUTER_REVIEW_MODEL: preserve(),
      //   APP_ORIGIN: preserve(),          // custom domain; otherwise auto-derived
    },
  });

  return project("analytics", {
    resources: [db, api],
  });
});

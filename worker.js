export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-checkout") {
      if (request.method !== "POST") {
        return Response.json(
          { error: "Method not allowed. Use POST." },
          { status: 405 }
        );
      }

      return Response.json({
        message: "Checkout endpoint is ready.",
        environment: env.SQUARE_ENVIRONMENT,
        hasAccessToken: Boolean(env.SQUARE_ACCESS_TOKEN),
        hasLocationId: Boolean(env.SQUARE_LOCATION_ID)
      });
    }

    return env.ASSETS.fetch(request);
  }
};
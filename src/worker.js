export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-checkout") {
      return Response.json({
        message: "Glitch Wax worker API is working."
      });
    }

    return env.ASSETS.fetch(request);
  }
};
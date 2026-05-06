const STICK_O_WAX_VARIATION_ID = "J4L4WTWW4JO7UTEHUYQVR7LZ";
const DOUBLE_PACK_VARIATION_ID = "ZWBSYUZ6PGFILSV5S5BZ7BFG";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-checkout") {
      return handleCreateCheckout(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleCreateCheckout(request, env) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405 }
    );
  }

  try {
    const body = await request.json();

    const stickOWaxQty = Number(body.stickOWaxQty || 0);
    const doublePackQty = Number(body.doublePackQty || 0);

    if (
      !Number.isInteger(stickOWaxQty) ||
      !Number.isInteger(doublePackQty) ||
      stickOWaxQty < 0 ||
      doublePackQty < 0 ||
      stickOWaxQty > 20 ||
      doublePackQty > 20
    ) {
      return Response.json(
        { error: "Please select a valid quantity." },
        { status: 400 }
      );
    }

    if (stickOWaxQty === 0 && doublePackQty === 0) {
      return Response.json(
        { error: "Your cart is empty." },
        { status: 400 }
      );
    }

    const lineItems = [];

    if (stickOWaxQty > 0) {
      lineItems.push({
        catalog_object_id: STICK_O_WAX_VARIATION_ID,
        quantity: String(stickOWaxQty)
      });
    }

    if (doublePackQty > 0) {
      lineItems.push({
        catalog_object_id: DOUBLE_PACK_VARIATION_ID,
        quantity: String(doublePackQty)
      });
    }

    const squareBaseUrl =
      env.SQUARE_ENVIRONMENT === "production"
        ? "https://connect.squareup.com"
        : "https://connect.squareupsandbox.com";

    const squareRequestBody = {
      idempotency_key: crypto.randomUUID(),
      order: {
        location_id: env.SQUARE_LOCATION_ID,
        line_items: lineItems,
        pricing_options: {
            auto_apply_taxes: true
        }
},
      checkout_options: {
        ask_for_shipping_address: true,
        redirect_url: "https://glitchwax.com/order-success.html"
      }
    };

    const squareResponse = await fetch(
      `${squareBaseUrl}/v2/online-checkout/payment-links`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${env.SQUARE_ACCESS_TOKEN}`,
          "Content-Type": "application/json",
          "Square-Version": "2025-04-16"
        },
        body: JSON.stringify(squareRequestBody)
      }
    );

    const squareResponseText = await squareResponse.text();

    let squareData;
    try {
      squareData = JSON.parse(squareResponseText);
    } catch (parseError) {
      squareData = null;
    }

    if (!squareResponse.ok) {
      console.error("Square checkout creation failed.", {
        status: squareResponse.status,
        response: squareData || squareResponseText
      });

      return Response.json(
        { error: "Checkout could not be created. Please try again." },
        { status: 500 }
      );
    }

    if (!squareData || !squareData.payment_link || !squareData.payment_link.url) {
      console.error("Square checkout response missing payment link.", {
        response: squareData || squareResponseText
      });

      return Response.json(
        { error: "Checkout could not be created. Please try again." },
        { status: 500 }
      );
    }

    return Response.json({
      checkoutUrl: squareData.payment_link.url
    });
  } catch (error) {
    console.error("Checkout function error.", {
      message: error.message
    });

    return Response.json(
      { error: "Checkout could not be created. Please try again." },
      { status: 500 }
    );
  }
}
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
      { error: "Method not allowed. Use POST." },
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
        { error: "Invalid quantity." },
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
        name: "Stick o Wax",
        quantity: String(stickOWaxQty),
        base_price_money: {
          amount: 850,
          currency: "USD"
        }
      });
    }

    if (doublePackQty > 0) {
      lineItems.push({
        name: "Double Pack",
        quantity: String(doublePackQty),
        base_price_money: {
          amount: 1000,
          currency: "USD"
        }
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
        line_items: lineItems
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
    } catch (error) {
      squareData = squareResponseText;
    }

    if (!squareResponse.ok) {
      return Response.json(
        {
          error: "Square checkout creation failed.",
          squareStatus: squareResponse.status,
          squareResponse: squareData,
          rawSquareResponse: squareResponseText,
          sentToSquare: {
            environment: env.SQUARE_ENVIRONMENT,
            locationId: env.SQUARE_LOCATION_ID,
            lineItems: lineItems,
            checkoutOptions: squareRequestBody.checkout_options
          }
        },
        { status: 500 }
      );
    }

    return Response.json({
      checkoutUrl: squareData.payment_link.url,
      squareResponse: squareData
    });
  } catch (error) {
    return Response.json(
      {
        error: "Server error creating checkout.",
        message: error.message
      },
      { status: 500 }
    );
  }
}
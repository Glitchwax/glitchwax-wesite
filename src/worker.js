const STICK_O_WAX_WHITE_VARIATION_ID = "J4L4WTWW4JO7UTEHUYQVR7LZ";
const STICK_O_WAX_BLACK_VARIATION_ID = "RFCS5LTZIC5TPJLRQZJUSCJN";

const DOUBLE_PACK_WHITE_VARIATION_ID = "ZWBSYUZ6PGFILSV5S5BZ7BFG";
const DOUBLE_PACK_BLUE_RED_VARIATION_ID = "3BC6J4JGF7YPNFI5X7M7M3VT";
const DOUBLE_PACK_YELLOW_VARIATION_ID = "25BFW2NOMJ3OCMXQNPCBTBM6";

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/api/create-checkout") {
      return handleCreateCheckout(request, env);
    }

    if (url.pathname === "/api/contact") {
      return handleContactForm(request, env);
    }

    return env.ASSETS.fetch(request);
  }
};

async function handleContactForm(request, env) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405 }
    );
  }

  try {
    const missingConfig = [];

    if (!env.CONTACT_EMAIL) {
      missingConfig.push("CONTACT_EMAIL binding");
    }

    if (!env.CONTACT_FROM_EMAIL) {
      missingConfig.push("CONTACT_FROM_EMAIL variable");
    }

    if (!env.CONTACT_TO_EMAIL) {
      missingConfig.push("CONTACT_TO_EMAIL variable");
    }

    if (missingConfig.length > 0) {
      console.error("Missing contact form configuration.", {
        missing: missingConfig
      });

      return Response.json(
        { error: "Contact form is not configured yet." },
        { status: 500 }
      );
    }

    const body = await request.json();

    const validation = validateContactSubmission(body);

    if (!validation.isValid) {
      return Response.json(
        { error: validation.message },
        { status: 400 }
      );
    }

    const contact = validation.contact;

    const emailSubject = "New Glitch Wax contact form message";

    const emailBody =
`New message from the Glitch Wax website contact form.

Name:
${contact.name}

Email:
${contact.email}

Phone:
${contact.phone}

Comment:
${contact.comment}

Submitted:
${new Date().toLocaleString("en-US", { timeZone: "America/Chicago" })} Central Time`;

    await env.CONTACT_EMAIL.send({
      to: env.CONTACT_TO_EMAIL,
      from: env.CONTACT_FROM_EMAIL,
      subject: emailSubject,
      replyTo: contact.email,
      text: emailBody
    });

    return Response.json({
      success: true
    });
  } catch (error) {
    console.error("Contact form error.", {
      message: error.message
    });

    return Response.json(
      { error: "Message could not be sent. Please try again later." },
      { status: 500 }
    );
  }
}

function validateContactSubmission(body) {
  if (!body || typeof body !== "object") {
    return {
      isValid: false,
      message: "Invalid form submission."
    };
  }

  const name = cleanText(body.name, 60);
  const email = cleanText(body.email, 120);
  const phone = cleanText(body.phone, 18);
  const comment = cleanText(body.comment, 500);

  if (!name) {
    return {
      isValid: false,
      message: "Please enter your name."
    };
  }

  if (name.length < 2) {
    return {
      isValid: false,
      message: "Name must be at least 2 characters."
    };
  }

  const namePattern = /^[a-zA-Z\s.'-]+$/;
  if (!namePattern.test(name)) {
    return {
      isValid: false,
      message: "Name contains invalid characters."
    };
  }

  if (!email) {
    return {
      isValid: false,
      message: "Please enter your email address."
    };
  }

  const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  if (!emailPattern.test(email)) {
    return {
      isValid: false,
      message: "Enter a valid email address."
    };
  }

  if (!phone) {
    return {
      isValid: false,
      message: "Please enter your phone number."
    };
  }

  const digitsOnly = phone.replace(/\D/g, "");
  let normalizedDigits = digitsOnly;

  if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
    normalizedDigits = digitsOnly.slice(1);
  }

  if (normalizedDigits.length !== 10) {
    return {
      isValid: false,
      message: "Enter a valid 10-digit phone number."
    };
  }

  const areaCode = normalizedDigits.slice(0, 3);
  const centralOffice = normalizedDigits.slice(3, 6);

  if (areaCode[0] === "0" || areaCode[0] === "1") {
    return {
      isValid: false,
      message: "Area code is not valid."
    };
  }

  if (centralOffice[0] === "0" || centralOffice[0] === "1") {
    return {
      isValid: false,
      message: "Phone number is not valid."
    };
  }

  if (/^(\d)\1+$/.test(normalizedDigits)) {
    return {
      isValid: false,
      message: "Phone number cannot be all the same digit."
    };
  }

  if (!comment) {
    return {
      isValid: false,
      message: "Please enter a comment."
    };
  }

  if (comment.length < 10) {
    return {
      isValid: false,
      message: "Comment is too short."
    };
  }

  if (comment.length > 500) {
    return {
      isValid: false,
      message: "Comment is too long."
    };
  }

  return {
    isValid: true,
    contact: {
      name,
      email,
      phone,
      comment
    }
  };
}

function cleanText(value, maxLength) {
  if (typeof value !== "string") {
    return "";
  }

  return value
    .replace(/[\u0000-\u001F\u007F]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, maxLength);
}

async function handleCreateCheckout(request, env) {
  if (request.method !== "POST") {
    return Response.json(
      { error: "Method not allowed." },
      { status: 405 }
    );
  }

  try {
    const body = await request.json();

    const stickOWaxWhiteQty = getValidQuantity(body.stickOWaxWhiteQty);
    const stickOWaxBlackQty = getValidQuantity(body.stickOWaxBlackQty);

    const doublePackWhiteQty = getValidQuantity(body.doublePackWhiteQty);
    const doublePackBlueRedQty = getValidQuantity(body.doublePackBlueRedQty);
    const doublePackYellowQty = getValidQuantity(body.doublePackYellowQty);

    const quantities = [
      stickOWaxWhiteQty,
      stickOWaxBlackQty,
      doublePackWhiteQty,
      doublePackBlueRedQty,
      doublePackYellowQty
    ];

    if (quantities.some((quantity) => quantity === null)) {
      return Response.json(
        { error: "Please select a valid quantity." },
        { status: 400 }
      );
    }

    const stickOWaxTotal = stickOWaxWhiteQty + stickOWaxBlackQty;
    const doublePackTotal = doublePackWhiteQty + doublePackBlueRedQty + doublePackYellowQty;

    if (stickOWaxTotal === 0 && doublePackTotal === 0) {
      return Response.json(
        { error: "Your cart is empty." },
        { status: 400 }
      );
    }

    if (stickOWaxTotal > 5) {
      return Response.json(
        { error: "You can select up to 5 total Stick O Wax per order." },
        { status: 400 }
      );
    }

    if (doublePackTotal > 5) {
      return Response.json(
        { error: "You can select up to 5 total Two Packs per order." },
        { status: 400 }
      );
    }

    const lineItems = [];

    addLineItem(lineItems, STICK_O_WAX_WHITE_VARIATION_ID, stickOWaxWhiteQty);
    addLineItem(lineItems, STICK_O_WAX_BLACK_VARIATION_ID, stickOWaxBlackQty);

    addLineItem(lineItems, DOUBLE_PACK_WHITE_VARIATION_ID, doublePackWhiteQty);
    addLineItem(lineItems, DOUBLE_PACK_BLUE_RED_VARIATION_ID, doublePackBlueRedQty);
    addLineItem(lineItems, DOUBLE_PACK_YELLOW_VARIATION_ID, doublePackYellowQty);

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

function getValidQuantity(value) {
  const quantity = Number(value || 0);

  if (!Number.isInteger(quantity)) {
    return null;
  }

  if (quantity < 0 || quantity > 5) {
    return null;
  }

  return quantity;
}

function addLineItem(lineItems, catalogObjectId, quantity) {
  if (quantity > 0) {
    lineItems.push({
      catalog_object_id: catalogObjectId,
      quantity: String(quantity)
    });
  }
}
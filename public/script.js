/*============================
TURNSTILE HELPERS

The "are you human" widget is optional: the Worker injects it into the forms
only when a Turnstile site key is configured. With no widget on the page both
helpers do nothing, and the request body is byte-for-byte what it was before
(JSON.stringify drops an undefined token).
==============================*/

function glitchwaxTurnstileToken(form) {
    var field = form.querySelector("[name='cf-turnstile-response']");

    return field && field.value ? field.value : undefined;
}

function glitchwaxTurnstileReset(form) {
    var widget = form.querySelector(".cf-turnstile");

    // Every token is single use, so a second submission needs a fresh one.
    if (widget && window.turnstile && typeof window.turnstile.reset === "function") {
        try {
            window.turnstile.reset(widget);
        } catch (error) {
            // Widget not rendered yet; nothing to reset.
        }
    }
}

/*============================
MAIN PAGE GLITCH EFFECT
==============================*/

document.addEventListener("DOMContentLoaded", function () {
    const heroGlitchTarget = document.querySelector(".hero-glitch-target");
    const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    if (prefersReducedMotion || !heroGlitchTarget) {
        return;
    }

    let hasPlayedGlitch = false;

    function playHeroGlitch() {
        if (hasPlayedGlitch) {
            return;
        }

        hasPlayedGlitch = true;

        document.body.classList.remove("play-glitch");
        void document.body.offsetWidth;
        document.body.classList.add("play-glitch");

        window.setTimeout(function () {
            document.body.classList.remove("play-glitch");
        }, 1400);
    }

    if (!("IntersectionObserver" in window)) {
        playHeroGlitch();
        return;
    }

    const heroObserver = new IntersectionObserver(function (entries, observer) {
        entries.forEach(function (entry) {
            if (!entry.isIntersecting) {
                return;
            }

            playHeroGlitch();
            observer.disconnect();
        });
    }, {
        threshold: 0.25
    });

    heroObserver.observe(heroGlitchTarget);
});

/*============================
NAV + FOOTER LINK GLITCH EFFECT
==============================*/

document.addEventListener("DOMContentLoaded", function () {
    // Header nav and footer links share the same glitch (data-text + ::before/::after in CSS).
    const navLinks = document.querySelectorAll(".site-nav a, .footer-links a");

    navLinks.forEach(function (link) {
        link.setAttribute("data-text", link.textContent.trim());

        link.addEventListener("mouseenter", function () {
            link.classList.remove("nav-glitch-active");
            void link.offsetWidth;
            link.classList.add("nav-glitch-active");
        });

        link.addEventListener("animationend", function () {
            link.classList.remove("nav-glitch-active");
        });

        link.addEventListener("touchstart", function () {
            link.classList.remove("nav-glitch-active");
            void link.offsetWidth;
            link.classList.add("nav-glitch-active");
        }, { passive: true });
    });
});

/*============================
LOGO GLITCH EFFECT
==============================*/

document.addEventListener("DOMContentLoaded", function () {
    const logoLink = document.querySelector(".logo");

    if (!logoLink) {
        return;
    }

    logoLink.addEventListener("mouseenter", function () {
        logoLink.classList.remove("logo-glitch-active");
        void logoLink.offsetWidth;
        logoLink.classList.add("logo-glitch-active");
    });

    logoLink.addEventListener("animationend", function () {
        logoLink.classList.remove("logo-glitch-active");
    });

    logoLink.addEventListener("touchstart", function () {
        logoLink.classList.remove("logo-glitch-active");
        void logoLink.offsetWidth;
        logoLink.classList.add("logo-glitch-active");
    }, { passive: true });
});

/*========================================

CONTACT PAGE BRAND CARD GLITCH LOOP

==========================================*/

document.addEventListener("DOMContentLoaded", function () {
    const brandCard = document.querySelector(".brand-card");

    if (!brandCard) {
        return;
    }

    const glitchDuration = 1400;

    function scheduleNextGlitch() {
        const nextDelay = Math.random() * 3000 + 2000;

        window.setTimeout(function () {
            brandCard.classList.remove("brand-glitch-active");
            void brandCard.offsetWidth;
            brandCard.classList.add("brand-glitch-active");

            window.setTimeout(function () {
                brandCard.classList.remove("brand-glitch-active");
            }, glitchDuration);

            scheduleNextGlitch();
        }, nextDelay);
    }

    scheduleNextGlitch();
});

/*========================================

FEATURE VIDEO AUTOPLAY ONCE (SCROLL TRIGGER)

==========================================*/

document.addEventListener("DOMContentLoaded", function () {
    const video = document.querySelector("[data-autoplay-once]");

    if (!video) {
        return;
    }

    let hasPlayed = false;

    const observer = new IntersectionObserver(function (entries) {
        entries.forEach(function (entry) {
            if (entry.isIntersecting && !hasPlayed) {
                hasPlayed = true;

                video.play().catch(function () {
                    // Autoplay might fail silently, so ignore the error.
                });

                observer.disconnect();
            }
        });
    }, {
        threshold: 0.35
    });

    observer.observe(video);
});

/*========================================

EMAIL / SMS SIGNUP (every page)

==========================================*/

document.addEventListener("DOMContentLoaded", function () {
    var form = document.getElementById("signupForm");

    if (!form) {
        return;
    }

    var emailInput = document.getElementById("signupEmail");
    var phoneInput = document.getElementById("signupPhone");
    var smsInput = document.getElementById("signupSms");
    var status = document.getElementById("signupStatus");
    var button = form.querySelector("button[type='submit']");

    function say(message, ok) {
        status.textContent = message;
        status.classList.toggle("field-valid", Boolean(ok));
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        var email = emailInput.value.trim();
        var phone = phoneInput.value.trim();

        if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) {
            emailInput.classList.add("input-error");
            say("Enter a valid email address.", false);
            return;
        }

        emailInput.classList.remove("input-error");

        if (smsInput.checked && !phone) {
            phoneInput.classList.add("input-error");
            say("Add your phone number to get texts, or untick the box.", false);
            return;
        }

        phoneInput.classList.remove("input-error");
        button.disabled = true;
        say("Signing you up...", false);

        try {
            var response = await fetch("/api/subscribe", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    email: email,
                    phone: phone,
                    smsConsent: smsInput.checked,
                    website: form.querySelector(".signup-hp").value,
                    ref: new URLSearchParams(window.location.search).get("ref"),
                    turnstileToken: glitchwaxTurnstileToken(form)
                })
            });

            var result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Signup didn't go through. Please try again.");
            }

            form.reset();
            say(result.message || "You're in.", true);
        } catch (error) {
            say(error.message || "Signup didn't go through. Please try again.", false);
        } finally {
            glitchwaxTurnstileReset(form);
            button.disabled = false;
        }
    });
});

/*========================================

CONTACT + REVIEW FORM LOGIC (/contact; /review redirects here)

==========================================*/

document.addEventListener("DOMContentLoaded", function () {
    const reviewForm = document.getElementById("reviewForm");

    if (!reviewForm) {
        return;
    }

    const params = new URLSearchParams(window.location.search);

    const reviewHeading = document.getElementById("reviewHeading");
    const reviewIntro = document.getElementById("reviewIntro");
    const ratingRow = document.getElementById("ratingRow");
    const ratingLegend = document.getElementById("ratingLegend");
    const ratingMessage = document.getElementById("ratingMessage");
    const waxMeter = reviewForm.querySelector(".wax-meter");
    const meterLabels = Array.from(waxMeter.querySelectorAll("label"));
    const messageInput = document.getElementById("message");
    const messageLabel = document.getElementById("messageLabel");
    const messageMessage = document.getElementById("messageMessage");
    const messageCount = document.getElementById("messageCount");
    const nameInput = document.getElementById("reviewName");
    const nameLabel = document.getElementById("reviewNameLabel");
    const nameMessage = document.getElementById("reviewNameMessage");
    const phoneRow = document.getElementById("phoneRow");
    const phoneInput = document.getElementById("reviewPhone");
    const phoneMessage = document.getElementById("reviewPhoneMessage");
    const orderRow = document.getElementById("orderRow");
    const messageMax = document.getElementById("messageMax");
    const emailInput = document.getElementById("reviewEmail");
    const emailLabel = document.getElementById("reviewEmailLabel");
    const emailMessage = document.getElementById("reviewEmailMessage");
    const orderInput = document.getElementById("orderNumber");
    const publicOkRow = document.getElementById("publicOkRow");
    const publicOkInput = document.getElementById("publicOk");
    const reviewStatus = document.getElementById("reviewStatus");
    const submitButton = reviewForm.querySelector("button[type='submit']");

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

    // A question goes to /api/contact (it emails the owner), which keeps the
    // contact form's 500-character limit; reviews and order problems go to
    // /api/feedback and may run longer.
    function maxMessageLength() {
        return currentKind() === "question" ? 500 : 2000;
    }

    // The order-success page links here with ?order=<Square order id>, the
    // packaging QR code with ?src=qr, and a product page can pass ?product=.
    const prefilledOrder = params.get("order") || params.get("orderId") || "";
    const source = ["order_success", "qr"].includes(params.get("src")) ? params.get("src") : "site_review";

    if (prefilledOrder) {
        orderInput.value = prefilledOrder.slice(0, 64);
    }

    function selectProduct(value) {
        const match = Array.from(reviewForm.querySelectorAll("input[name='product']")).find(function (input) {
            return input.value === value;
        });

        if (match) {
            match.checked = true;
        }
    }

    selectProduct(params.get("product"));

    if (["complaint", "question"].includes(params.get("kind"))) {
        reviewForm.querySelector("input[name='kind'][value='" + params.get("kind") + "']").checked = true;
    }

    const copyByKind = {
        review: {
            heading: "Rate Your Wax",
            intro: "Give it a score and let other skaters know what they are getting.",
            legend: "How did it slide?",
            message: "What did you wax?",
            placeholder: "The spot, the trick, how long it lasted.",
            name: "Name or IG handle",
            email: "Email <span class=\"optional-tag\">(optional)</span>",
            button: "Send Review",
            thanks: "Review received. Thanks for riding Glitch Wax."
        },
        complaint: {
            heading: "Order Problem",
            intro: "Wrong item, busted in shipping, or it just didn't hold up? Tell us what happened and we will make it right.",
            legend: "How did it slide? (optional)",
            message: "What happened?",
            placeholder: "What you ordered, what showed up, and what went wrong.",
            name: "Name",
            email: "Email <span class=\"optional-tag\">(so we can get back to you)</span>",
            button: "Send To Glitch Wax",
            thanks: "Got it. Someone from Glitch Wax will reach out."
        },
        question: {
            heading: "Ask Us Anything",
            intro: "Which wax for which spot, how to apply it, wholesale orders, anything else. Ask and we will answer.",
            legend: "",
            message: "Your question",
            placeholder: "Ask away.",
            name: "Name",
            email: "Email <span class=\"optional-tag\">(so we can get back to you)</span>",
            button: "Send Question",
            thanks: "Question received. Glitch Wax will get back to you soon."
        }
    };

    function currentKind() {
        const checked = reviewForm.querySelector("input[name='kind']:checked");
        return checked ? checked.value : "review";
    }

    function currentRating() {
        const checked = reviewForm.querySelector("input[name='rating']:checked");
        return checked ? Number(checked.value) : null;
    }

    function currentProduct() {
        const checked = reviewForm.querySelector("input[name='product']:checked");
        return checked ? checked.value : "";
    }

    function setInvalid(input, messageElement, message) {
        if (input) {
            input.classList.add("input-error");
        }
        messageElement.textContent = message;
        messageElement.classList.remove("field-valid");
    }

    function clearState(input, messageElement) {
        if (input) {
            input.classList.remove("input-error");
        }
        messageElement.textContent = "";
    }

    /* Wax meter: bars fill up to the picked score, and preview on hover. */
    function paintMeter() {
        const rating = currentRating();

        waxMeter.classList.toggle("is-set", rating !== null);

        meterLabels.forEach(function (label, index) {
            label.classList.toggle("is-on", rating !== null && index < rating);
            label.classList.toggle("is-picked", rating !== null && index === rating - 1);
        });
    }

    meterLabels.forEach(function (label, index) {
        label.addEventListener("mouseenter", function () {
            waxMeter.classList.add("is-previewing");

            meterLabels.forEach(function (other, otherIndex) {
                other.classList.toggle("is-preview", otherIndex <= index);
            });
        });
    });

    waxMeter.addEventListener("mouseleave", function () {
        waxMeter.classList.remove("is-previewing");

        meterLabels.forEach(function (label) {
            label.classList.remove("is-preview");
        });
    });

    reviewForm.querySelectorAll("input[name='rating']").forEach(function (input) {
        input.addEventListener("change", function () {
            clearState(null, ratingMessage);
            paintMeter();
        });
    });

    function applyKind() {
        const kind = currentKind();
        const copy = copyByKind[kind];

        reviewHeading.textContent = copy.heading;
        reviewIntro.textContent = copy.intro;
        ratingRow.hidden = kind === "question";
        publicOkRow.hidden = kind !== "review";
        phoneRow.hidden = kind === "review";
        orderRow.hidden = kind === "question";
        nameLabel.textContent = copy.name;
        messageInput.maxLength = maxMessageLength();
        messageMax.textContent = String(maxMessageLength());
        ratingLegend.textContent = copy.legend;
        messageLabel.textContent = copy.message;
        messageInput.placeholder = copy.placeholder;
        emailLabel.innerHTML = copy.email;
        submitButton.textContent = copy.button;

        clearState(null, ratingMessage);
        clearState(messageInput, messageMessage);
        clearState(emailInput, emailMessage);
        clearState(phoneInput, phoneMessage);
        reviewStatus.textContent = "";
    }

    reviewForm.querySelectorAll("input[name='kind']").forEach(function (input) {
        input.addEventListener("change", applyKind);
    });

    messageInput.addEventListener("input", function () {
        messageCount.textContent = messageInput.value.length;

        if (messageInput.value.length <= maxMessageLength()) {
            clearState(messageInput, messageMessage);
        }
    });

    function validate() {
        const kind = currentKind();
        let isValid = true;

        if (kind === "review" && currentRating() === null) {
            setInvalid(null, ratingMessage, "Pick how it slid.");
            isValid = false;
        }

        const message = messageInput.value.trim();

        if (message.length > maxMessageLength()) {
            setInvalid(messageInput, messageMessage, "That's too long. Keep it under " + maxMessageLength() + " characters.");
            isValid = false;
        } else if (kind !== "review" && message.length < 10) {
            setInvalid(messageInput, messageMessage, "Give us a little more to go on.");
            isValid = false;
        }

        if (!nameInput.value.trim()) {
            setInvalid(nameInput, nameMessage, "Add your name or IG handle.");
            isValid = false;
        } else {
            clearState(nameInput, nameMessage);
        }

        const email = emailInput.value.trim();

        if (email && !emailPattern.test(email)) {
            setInvalid(emailInput, emailMessage, "That email doesn't look right.");
            isValid = false;
        } else if (!email && kind !== "review") {
            setInvalid(emailInput, emailMessage, "We need your email to get back to you.");
            isValid = false;
        } else {
            clearState(emailInput, emailMessage);
        }

        const phoneDigits = phoneInput.value.replace(/\D/g, "");
        const phoneOk = phoneDigits.length === 0 || phoneDigits.length === 10 || (phoneDigits.length === 11 && phoneDigits.startsWith("1"));

        if (kind !== "review" && !phoneOk) {
            setInvalid(phoneInput, phoneMessage, "Enter a 10-digit phone number, or leave it blank.");
            isValid = false;
        } else {
            clearState(phoneInput, phoneMessage);
        }

        return isValid;
    }

    reviewForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        if (!validate()) {
            reviewStatus.textContent = "Fix the highlighted fields and send it again.";
            return;
        }

        const kind = currentKind();
        const buttonText = submitButton.textContent;

        // Questions take the contact route so the owner gets an email with
        // reply-to set; reviews and order problems go to the feedback inbox.
        const endpoint = kind === "question" ? "/api/contact" : "/api/feedback";

        const formData = kind === "question" ? {
            name: nameInput.value.trim(),
            email: emailInput.value.trim(),
            phone: phoneInput.value.trim(),
            comment: messageInput.value.trim(),
            turnstileToken: glitchwaxTurnstileToken(reviewForm)
        } : {
            kind: kind,
            rating: currentRating(),
            product: currentProduct(),
            message: messageInput.value.trim(),
            name: nameInput.value.trim(),
            email: emailInput.value.trim(),
            order: orderInput.value.trim(),
            publicOk: kind === "review" && publicOkInput.checked,
            source: source,
            website: reviewForm.querySelector(".signup-hp").value,
            ref: params.get("ref"),
            turnstileToken: glitchwaxTurnstileToken(reviewForm)
        };

        try {
            submitButton.disabled = true;
            submitButton.textContent = "Sending...";
            reviewStatus.textContent = "";

            const response = await fetch(endpoint, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "That didn't go through. Try again.");
            }

            reviewForm.reset();
            reviewForm.querySelector("input[name='kind'][value='" + kind + "']").checked = true;

            if (prefilledOrder) {
                orderInput.value = prefilledOrder.slice(0, 64);
            }

            messageCount.textContent = "0";
            paintMeter();
            applyKind();
            reviewStatus.textContent = copyByKind[kind].thanks;
        } catch (error) {
            reviewStatus.textContent = error.message || "That didn't go through. Try again.";
        } finally {
            glitchwaxTurnstileReset(reviewForm);
            submitButton.disabled = false;

            if (submitButton.textContent === "Sending...") {
                submitButton.textContent = buttonText;
            }
        }
    });

    paintMeter();
    applyKind();
});

/*============================
PRODUCT GALLERY + LIGHTBOX

Both product pages share the same markup: one main image and a row of
thumbnails. Clicking a thumbnail swaps the main image; clicking the main
image opens a full-screen lightbox with previous/next arrows, keyboard
arrows, swipe on touch, and Escape / backdrop click to close. The lightbox
is built here so the HTML pages stay static.
==============================*/

document.addEventListener("DOMContentLoaded", function () {
    const gallery = document.querySelector(".product-page-gallery");

    if (!gallery) {
        return;
    }

    const mainImage = gallery.querySelector(".product-page-main-image img");
    const thumbs = Array.from(gallery.querySelectorAll(".product-page-thumbnails img"));

    if (!mainImage || thumbs.length === 0) {
        return;
    }

    const images = thumbs.map(function (thumb) {
        return { src: thumb.getAttribute("src"), alt: thumb.getAttribute("alt") || mainImage.alt };
    });

    let current = Math.max(0, images.findIndex(function (image) {
        return image.src === mainImage.getAttribute("src");
    }));

    function showMain(index) {
        current = (index + images.length) % images.length;
        mainImage.src = images[current].src;
        mainImage.alt = images[current].alt;
        thumbs.forEach(function (thumb, i) {
            thumb.classList.toggle("is-active", i === current);
        });
    }

    thumbs.forEach(function (thumb, index) {
        thumb.setAttribute("role", "button");
        thumb.setAttribute("tabindex", "0");
        thumb.addEventListener("click", function () {
            showMain(index);
        });
        thumb.addEventListener("keydown", function (event) {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                showMain(index);
            }
        });
    });

    // ---- lightbox -------------------------------------------------------
    const lightbox = document.createElement("div");
    lightbox.className = "gw-lightbox";
    lightbox.id = "gw-lightbox";
    lightbox.setAttribute("role", "dialog");
    lightbox.setAttribute("aria-modal", "true");
    lightbox.setAttribute("aria-label", "Product photos");
    lightbox.hidden = true;
    lightbox.innerHTML =
        '<button type="button" class="gw-lightbox-close" aria-label="Close">&times;</button>' +
        '<button type="button" class="gw-lightbox-arrow gw-lightbox-prev" aria-label="Previous photo">&#8249;</button>' +
        '<figure class="gw-lightbox-figure"><img class="gw-lightbox-image" alt=""><figcaption class="gw-lightbox-count"></figcaption></figure>' +
        '<button type="button" class="gw-lightbox-arrow gw-lightbox-next" aria-label="Next photo">&#8250;</button>';
    document.body.appendChild(lightbox);

    const lightboxImage = lightbox.querySelector(".gw-lightbox-image");
    const lightboxCount = lightbox.querySelector(".gw-lightbox-count");
    const figure = lightbox.querySelector(".gw-lightbox-figure");
    let lastFocus = null;

    function paintLightbox() {
        lightboxImage.src = images[current].src;
        lightboxImage.alt = images[current].alt;
        lightboxCount.textContent = (current + 1) + " / " + images.length;
    }

    function openLightbox(index) {
        showMain(index);
        paintLightbox();
        lastFocus = document.activeElement;
        lightbox.hidden = false;
        document.body.classList.add("gw-lightbox-open");
        lightbox.querySelector(".gw-lightbox-next").focus();
    }

    function closeLightbox() {
        lightbox.hidden = true;
        document.body.classList.remove("gw-lightbox-open");
        if (lastFocus && typeof lastFocus.focus === "function") {
            lastFocus.focus();
        }
    }

    function step(direction) {
        showMain(current + direction);
        paintLightbox();
    }

    mainImage.setAttribute("role", "button");
    mainImage.setAttribute("tabindex", "0");
    mainImage.setAttribute("aria-label", "Open product photos");
    mainImage.addEventListener("click", function () {
        openLightbox(current);
    });
    mainImage.addEventListener("keydown", function (event) {
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            openLightbox(current);
        }
    });

    lightbox.querySelector(".gw-lightbox-close").addEventListener("click", closeLightbox);
    lightbox.querySelector(".gw-lightbox-prev").addEventListener("click", function () { step(-1); });
    lightbox.querySelector(".gw-lightbox-next").addEventListener("click", function () { step(1); });
    lightbox.addEventListener("click", function (event) {
        // Backdrop click closes; clicks on the photo or the buttons do not.
        if (event.target === lightbox || event.target === figure) {
            closeLightbox();
        }
    });

    document.addEventListener("keydown", function (event) {
        if (lightbox.hidden) {
            return;
        }
        if (event.key === "Escape") {
            closeLightbox();
        } else if (event.key === "ArrowRight") {
            step(1);
        } else if (event.key === "ArrowLeft") {
            step(-1);
        }
    });

    // Swipe left/right on touch screens.
    let touchStartX = null;
    lightbox.addEventListener("touchstart", function (event) {
        touchStartX = event.touches.length === 1 ? event.touches[0].clientX : null;
    }, { passive: true });
    lightbox.addEventListener("touchend", function (event) {
        if (touchStartX === null) {
            return;
        }
        const delta = event.changedTouches[0].clientX - touchStartX;
        touchStartX = null;
        if (Math.abs(delta) > 40) {
            step(delta < 0 ? 1 : -1);
        }
    });

    showMain(current);
});

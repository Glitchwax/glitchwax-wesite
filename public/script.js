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
NAV LINK GLITCH EFFECT
==============================*/

document.addEventListener("DOMContentLoaded", function () {
    const navLinks = document.querySelectorAll(".site-nav a");

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

CONTACT FORM LOGIC

==========================================*/

document.addEventListener("DOMContentLoaded", function () {
    const contactForm = document.getElementById("contactForm");

    if (!contactForm) {
        return;
    }

    const nameInput = document.getElementById("name");
    const emailInput = document.getElementById("email");
    const phoneInput = document.getElementById("phone");
    const commentInput = document.getElementById("comment");

    const nameMessage = document.getElementById("nameMessage");
    const emailMessage = document.getElementById("emailMessage");
    const phoneMessage = document.getElementById("phoneMessage");
    const commentMessage = document.getElementById("commentMessage");
    const formStatus = document.getElementById("formStatus");
    const commentCount = document.getElementById("commentCount");

    const maxCommentLength = 500;

    function setInvalid(input, messageElement, message) {
        input.classList.add("input-error");
        input.classList.remove("input-valid");
        messageElement.textContent = message;
        messageElement.classList.remove("field-valid");
    }

    function setValid(input, messageElement, message) {
        input.classList.remove("input-error");
        input.classList.add("input-valid");
        messageElement.textContent = message;
        messageElement.classList.add("field-valid");
    }

    function clearState(input, messageElement) {
        input.classList.remove("input-error");
        input.classList.remove("input-valid");
        messageElement.textContent = "";
        messageElement.classList.remove("field-valid");
    }

    function validateName() {
        const value = nameInput.value.trim();

        if (!value) {
            setInvalid(nameInput, nameMessage, "Please enter your name.");
            return false;
        }

        if (value.length < 2) {
            setInvalid(nameInput, nameMessage, "Name must be at least 2 characters.");
            return false;
        }

        const namePattern = /^[a-zA-Z\s.'-]+$/;

        if (!namePattern.test(value)) {
            setInvalid(nameInput, nameMessage, "Name contains invalid characters.");
            return false;
        }

        setValid(nameInput, nameMessage, "Looks good.");
        return true;
    }

    function validateEmail() {
        const value = emailInput.value.trim();

        if (!value) {
            setInvalid(emailInput, emailMessage, "Please enter your email address.");
            return false;
        }

        const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

        if (!emailPattern.test(value)) {
            setInvalid(emailInput, emailMessage, "Enter a valid email address.");
            return false;
        }

        setValid(emailInput, emailMessage, "Email format looks correct.");
        return true;
    }

    function validatePhone() {
        const rawValue = phoneInput.value.trim();

        if (!rawValue) {
            setInvalid(phoneInput, phoneMessage, "Please enter your phone number.");
            return false;
        }

        const digitsOnly = rawValue.replace(/\D/g, "");

        if (digitsOnly.length === 11 && digitsOnly.startsWith("1")) {
            return validateNorthAmericanNumber(digitsOnly.slice(1));
        }

        if (digitsOnly.length !== 10) {
            setInvalid(phoneInput, phoneMessage, "Enter a valid 10-digit phone number.");
            return false;
        }

        return validateNorthAmericanNumber(digitsOnly);
    }

    function validateNorthAmericanNumber(digits) {
        const areaCode = digits.slice(0, 3);
        const centralOffice = digits.slice(3, 6);

        if (areaCode[0] === "0" || areaCode[0] === "1") {
            setInvalid(phoneInput, phoneMessage, "Area code is not valid.");
            return false;
        }

        if (centralOffice[0] === "0" || centralOffice[0] === "1") {
            setInvalid(phoneInput, phoneMessage, "Phone number is not valid.");
            return false;
        }

        if (/^(\d)\1+$/.test(digits)) {
            setInvalid(phoneInput, phoneMessage, "Phone number cannot be all the same digit.");
            return false;
        }

        const formatted = formatPhoneNumber(digits);
        phoneInput.value = formatted;
        setValid(phoneInput, phoneMessage, "Phone number format looks valid.");
        return true;
    }

    function formatPhoneNumber(digits) {
        return "(" + digits.slice(0, 3) + ") " + digits.slice(3, 6) + "-" + digits.slice(6);
    }

    function validateComment() {
        const value = commentInput.value.trim();
        const length = value.length;

        commentCount.textContent = commentInput.value.length;

        if (!value) {
            setInvalid(commentInput, commentMessage, "Please enter a comment.");
            return false;
        }

        if (length < 10) {
            setInvalid(commentInput, commentMessage, "Comment is too short.");
            return false;
        }

        if (length > maxCommentLength) {
            setInvalid(commentInput, commentMessage, "Comment is too long.");
            return false;
        }

        setValid(commentInput, commentMessage, "Looks good.");
        return true;
    }

    nameInput.addEventListener("blur", validateName);
    emailInput.addEventListener("blur", validateEmail);
    phoneInput.addEventListener("blur", validatePhone);
    commentInput.addEventListener("blur", validateComment);

    commentInput.addEventListener("input", function () {
        commentCount.textContent = commentInput.value.length;

        if (commentInput.value.length > maxCommentLength) {
            setInvalid(commentInput, commentMessage, "Comment is too long.");
        } else if (commentInput.value.trim().length === 0) {
            clearState(commentInput, commentMessage);
        } else if (commentInput.value.trim().length >= 10) {
            setValid(commentInput, commentMessage, "Looks good.");
        } else {
            setInvalid(commentInput, commentMessage, "Comment is too short.");
        }
    });

    nameInput.addEventListener("input", function () {
        if (!nameInput.value.trim()) {
            clearState(nameInput, nameMessage);
        }
    });

    emailInput.addEventListener("input", function () {
        if (!emailInput.value.trim()) {
            clearState(emailInput, emailMessage);
        }
    });

    phoneInput.addEventListener("input", function () {
        const cleaned = phoneInput.value.replace(/[^\d()-\s]/g, "");

        if (cleaned !== phoneInput.value) {
            phoneInput.value = cleaned;
        }

        if (!phoneInput.value.trim()) {
            clearState(phoneInput, phoneMessage);
        }
    });

    contactForm.addEventListener("submit", async function (event) {
        event.preventDefault();

        const isNameValid = validateName();
        const isEmailValid = validateEmail();
        const isPhoneValid = validatePhone();
        const isCommentValid = validateComment();

        if (!isNameValid || !isEmailValid || !isPhoneValid || !isCommentValid) {
            formStatus.textContent = "Please fix the highlighted fields before submitting.";
            return;
        }

        const submitButton = contactForm.querySelector("button[type='submit']");

        const formData = {
            name: nameInput.value.trim(),
            email: emailInput.value.trim(),
            phone: phoneInput.value.trim(),
            comment: commentInput.value.trim(),
            turnstileToken: glitchwaxTurnstileToken(contactForm)
        };

        try {
            submitButton.disabled = true;
            submitButton.textContent = "Sending...";
            formStatus.textContent = "Sending your message...";

            const response = await fetch("/api/contact", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(formData)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(result.error || "Something went wrong. Please try again.");
            }

            contactForm.reset();

            clearState(nameInput, nameMessage);
            clearState(emailInput, emailMessage);
            clearState(phoneInput, phoneMessage);
            clearState(commentInput, commentMessage);

            commentCount.textContent = "0";
            formStatus.textContent = "Message sent successfully. Glitch Wax will get back to you soon.";
        } catch (error) {
            formStatus.textContent = error.message || "Message could not be sent. Please try again later.";
        } finally {
            glitchwaxTurnstileReset(contactForm);
            submitButton.disabled = false;
            submitButton.textContent = "Send Message";
        }
    });
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

REVIEW PAGE FORM LOGIC (/review)

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
    const nameMessage = document.getElementById("reviewNameMessage");
    const emailInput = document.getElementById("reviewEmail");
    const emailLabel = document.getElementById("reviewEmailLabel");
    const emailMessage = document.getElementById("reviewEmailMessage");
    const orderInput = document.getElementById("orderNumber");
    const publicOkRow = document.getElementById("publicOkRow");
    const publicOkInput = document.getElementById("publicOk");
    const reviewStatus = document.getElementById("reviewStatus");
    const submitButton = reviewForm.querySelector("button[type='submit']");

    const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    const maxMessageLength = 2000;

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
            email: "Email <span class=\"optional-tag\">(so we can get back to you)</span>",
            button: "Send To Glitch Wax",
            thanks: "Got it. Someone from Glitch Wax will reach out."
        },
        question: {
            heading: "Ask Us Anything",
            intro: "Which wax for which spot, how to apply it, wholesale, anything. Ask and we will answer.",
            legend: "",
            message: "Your question",
            placeholder: "Ask away.",
            email: "Email <span class=\"optional-tag\">(so we can get back to you)</span>",
            button: "Send Question",
            thanks: "Question received. We will get back to you soon."
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
        ratingLegend.textContent = copy.legend;
        messageLabel.textContent = copy.message;
        messageInput.placeholder = copy.placeholder;
        emailLabel.innerHTML = copy.email;
        submitButton.textContent = copy.button;

        clearState(null, ratingMessage);
        clearState(messageInput, messageMessage);
        clearState(emailInput, emailMessage);
        reviewStatus.textContent = "";
    }

    reviewForm.querySelectorAll("input[name='kind']").forEach(function (input) {
        input.addEventListener("change", applyKind);
    });

    messageInput.addEventListener("input", function () {
        messageCount.textContent = messageInput.value.length;

        if (messageInput.value.length <= maxMessageLength) {
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

        if (message.length > maxMessageLength) {
            setInvalid(messageInput, messageMessage, "That's too long. Keep it under 2000 characters.");
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

        const formData = {
            kind: kind,
            rating: kind === "question" ? null : currentRating(),
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

            const response = await fetch("/api/feedback", {
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

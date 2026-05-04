/*============================
MAIN PAGE GLITCH EFFECT JAVA
==============================*/
document.addEventListener("DOMContentLoaded", function () {
    const hasSeenGlitch = sessionStorage.getItem("glitchPlayed");
    const heroGlitchTarget = document.querySelector(".hero-glitch-target");

    if (!heroGlitchTarget) {
        return;
    }

    if (!hasSeenGlitch) {
        document.body.classList.add("play-glitch");
        sessionStorage.setItem("glitchPlayed", "true");

        window.setTimeout(function () {
            document.body.classList.remove("play-glitch");
        }, 1400);
    }
});

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


const contactForm = document.getElementById("contactForm");

if (contactForm) {
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

    contactForm.addEventListener("submit", function (event) {
        event.preventDefault();

        const isNameValid = validateName();
        const isEmailValid = validateEmail();
        const isPhoneValid = validatePhone();
        const isCommentValid = validateComment();

        if (!isNameValid || !isEmailValid || !isPhoneValid || !isCommentValid) {
            formStatus.textContent = "Please fix the highlighted fields before submitting.";
            return;
        }

        formStatus.textContent = "Form validation passed. Connect this form to your email service or backend next.";
    });
}


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
                    // autoplay might fail silently, ignore
                });

                observer.disconnect(); // only trigger once
            }
        });
    }, {
        threshold: 0.35
    });

    observer.observe(video);
});